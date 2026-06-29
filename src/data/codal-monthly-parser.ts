import { normalizePersianArabicDigits, parseLocalizedNumber } from '../core/number-utils';
import {
  type CodalExtractedTable,
  type CodalReportDetail,
  isMonthlyActivityReport,
  stripUnsafeHtml
} from './codal-client';

export type PortfolioValueKind =
  | 'listedPortfolioCostValue'
  | 'listedPortfolioMarketValue'
  | 'unlistedPortfolioCostValue'
  | 'unlistedPortfolioEstimatedValue'
  | 'unlistedPortfolioSurplusSuggestion';

export type ParseConfidence = 'high' | 'medium' | 'low';

export interface ExtractedPortfolioValue {
  kind: PortfolioValueKind;
  label: string;
  value: number;
  rawText: string;
  confidence: ParseConfidence;
  sourceTableIndex: number;
  sourceRowIndex?: number;
  sourceColumnIndex?: number;
  reason?: string;
  warning?: string;
}

export interface PortfolioTableCandidate {
  index: number;
  caption?: string;
  rowCount: number;
  columnCount: number;
  matchedLabels: string[];
  confidence: ParseConfidence;
}

export interface ParserTablePreview {
  index: number;
  caption?: string;
  headers: string[];
  rows: string[][];
  textPreview: string;
  detectedLabels: string[];
  warnings: string[];
}

export interface MonthlyActivityParseResult {
  status: 'parsed' | 'no-candidate-table' | 'unsupported-report' | 'ambiguous' | 'empty';
  reportTitle?: string;
  reportPeriod?: string;
  sourceReportUrl?: string;
  tableCandidates: PortfolioTableCandidate[];
  extractedValues: ExtractedPortfolioValue[];
  tablePreviews: ParserTablePreview[];
  warnings: string[];
  parsedAt: string;
}

interface ParsedTable {
  index: number;
  caption?: string;
  rows: string[][];
}

const labelPatterns: Record<PortfolioValueKind, RegExp[]> = {
  listedPortfolioCostValue: [/بهای\s*تمام\s*شده/, /بهای\s*تمام‌شده/, /بهای\s*تمام/, /مبلغ\s*تمام\s*شده/, /مبلغ\s*بهای\s*تمام/],
  listedPortfolioMarketValue: [/ارزش\s*بازار/, /ارزش\s*روز/, /مبلغ\s*بازار/, /مبلغ\s*ارزش\s*بازار/, /مبلغ\s*ارزش\s*روز/],
  unlistedPortfolioCostValue: [/بهای\s*تمام\s*شده/, /بهای\s*تمام‌شده/, /بهای\s*تمام/, /مبلغ\s*تمام\s*شده/, /مبلغ\s*بهای\s*تمام/],
  unlistedPortfolioEstimatedValue: [/ارزش\s*برآوردی/, /ارزش\s*روز/, /ارزش\s*بازار/, /خالص\s*ارزش/, /مبلغ\s*بازار/, /مبلغ\s*ارزش/],
  unlistedPortfolioSurplusSuggestion: [/مازاد/]
};

const listedSignals = [
  /پذیرفته\s*شده\s*در\s*بورس/,
  /بورسی/,
  /پرتفوی\s*بورسی/,
  /سرمایه\s*گذاری\s*در\s*سهام/,
  /سرمایه‌گذاری\s*در\s*سهام/
];

const unlistedSignals = [/خارج\s*از\s*بورس/, /غیر\s*بورسی/, /غیربورسی/, /پرتفوی\s*غیر\s*بورسی/];

const portfolioSignals = [
  ...listedSignals,
  ...unlistedSignals,
  /پرتفوی/,
  /پورتفوی/,
  /سرمایه\s*گذاری/,
  /سرمایه‌گذاری/
];

const totalRowPatterns = [/^جمع$/, /^جمع\s*کل$/, /جمع\s*سرمایه\s*گذاری/, /جمع\s*سرمایه‌گذاری/, /جمع\s*پرتفوی/, /جمع\s*پورتفوی/];
const unitMillionRialPatterns = [/میلیون\s*ریال/, /میلیون\s*ریالی/];

function normalizeText(value: string): string {
  return normalizePersianArabicDigits(value)
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&zwnj;/gi, '\u200c')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function textFromHtml(html: string): string {
  return normalizeText(decodeHtmlEntities(stripUnsafeHtml(html).replace(/<[^>]+>/g, ' ')));
}

function cellsFromRow(rowHtml: string): string[] {
  return Array.from(rowHtml.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi))
    .map((match) => textFromHtml(match[1]))
    .filter(Boolean);
}

function tablesFromHtml(html: string): ParsedTable[] {
  return Array.from(stripUnsafeHtml(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)).map(
    (match, index) => {
      const tableHtml = match[1];
      const captionMatch = tableHtml.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
      return {
        index,
        caption: captionMatch ? textFromHtml(captionMatch[1]) : undefined,
        rows: Array.from(tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
          .map((rowMatch) => cellsFromRow(rowMatch[1]))
          .filter((row) => row.length > 0)
      };
    }
  );
}

function tablesFromJson(rawJson: unknown): ParsedTable[] {
  if (!rawJson || typeof rawJson !== 'object') {
    return [];
  }

  const record = rawJson as Record<string, unknown>;
  const candidates = [record.tables, record.Tables, record.sheets, record.Sheets, record.data, record.Data]
    .filter(Array.isArray)
    .flat() as unknown[];

  return candidates
    .map((candidate, index): ParsedTable | undefined => {
      if (!candidate || typeof candidate !== 'object') {
        return undefined;
      }

      const table = candidate as Record<string, unknown>;
      const headers = Array.isArray(table.headers)
        ? table.headers.map(String)
        : Array.isArray(table.Headers)
          ? table.Headers.map(String)
          : [];
      const rows = Array.isArray(table.rows)
        ? table.rows
        : Array.isArray(table.Rows)
          ? table.Rows
          : [];

      return {
        index,
        caption:
          typeof table.title === 'string'
            ? normalizeText(table.title)
            : typeof table.caption === 'string'
              ? normalizeText(table.caption)
              : undefined,
        rows: [
          headers.map(normalizeText),
          ...rows.map((row) => (Array.isArray(row) ? row.map((cell) => normalizeText(String(cell))) : []))
        ].filter((row) => row.length > 0)
      };
    })
    .filter((table): table is ParsedTable => Boolean(table));
}

function tablesFromExtractedTables(tables: CodalExtractedTable[] | undefined): ParsedTable[] {
  return (tables ?? [])
    .map((table): ParsedTable => {
      const rows = table.rows.length > 0 ? table.rows : [table.headers];
      return {
        index: table.index,
        caption: table.caption,
        rows: rows
          .map((row) => row.map((cell) => normalizeText(String(cell))).filter(Boolean))
          .filter((row) => row.length > 0)
      };
    })
    .filter((table) => table.rows.length > 0);
}

function tableText(table: ParsedTable): string {
  return normalizeText(`${table.caption ?? ''} ${table.rows.flat().join(' ')}`);
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function matchedLabels(text: string): string[] {
  const labels = [
    'بهای تمام شده',
    'مبلغ تمام شده',
    'ارزش بازار',
    'ارزش روز',
    'مبلغ بازار',
    'سرمایه گذاری در سهام',
    'پذیرفته شده در بورس',
    'خارج از بورس',
    'پرتفوی بورسی',
    'پرتفوی غیر بورسی',
    'جمع',
    'جمع کل'
  ];
  return labels.filter((label) => normalizeText(text).includes(normalizeText(label)));
}

function classifyTable(table: ParsedTable): PortfolioTableCandidate | undefined {
  const text = tableText(table);
  if (!hasAny(text, portfolioSignals)) {
    return undefined;
  }

  const labels = matchedLabels(text);
  const confidence: ParseConfidence =
    labels.length >= 3 ? 'high' : labels.length >= 1 ? 'medium' : 'low';
  const columnCount = table.rows.reduce((max, row) => Math.max(max, row.length), 0);

  return {
    index: table.index,
    caption: table.caption,
    rowCount: table.rows.length,
    columnCount,
    matchedLabels: labels,
    confidence
  };
}

function tableWarnings(table: ParsedTable): string[] {
  const warnings: string[] = [];
  if (table.rows.length < 2) {
    warnings.push('جدول ردیف کافی برای استخراج مقدار ندارد.');
  }
  if (table.rows.reduce((max, row) => Math.max(max, row.length), 0) < 2) {
    warnings.push('جدول ستون کافی برای استخراج مقدار ندارد.');
  }
  if (!table.rows.some((row) => row.some((cell) => hasAny(normalizeText(cell), totalRowPatterns)))) {
    warnings.push('ردیف جمع یا جمع کل در چند ردیف اول/آخر جدول با اطمینان شناسایی نشد.');
  }
  return warnings;
}

function tablePreview(table: ParsedTable): ParserTablePreview {
  const text = tableText(table);
  return {
    index: table.index,
    caption: table.caption,
    headers: (table.rows[0] ?? []).slice(0, 8),
    rows: table.rows.slice(0, 4).map((row) => row.slice(0, 8)),
    textPreview: text.slice(0, 500),
    detectedLabels: matchedLabels(text),
    warnings: tableWarnings(table)
  };
}

function parseCandidateNumber(value: string): number | undefined {
  const normalized = normalizeText(value);
  const parenthesized = normalized.match(/^\(\s*([^)]+?)\s*\)$/);
  const source = parenthesized ? parenthesized[1] : normalized;
  const numbers = source.match(/[+-]?\d[\d,٬٫.\s]*/g) ?? [];
  if (numbers.length !== 1) {
    return undefined;
  }

  const parsed = parseLocalizedNumber(numbers[0]);
  return parsed === undefined ? undefined : parenthesized ? -Math.abs(parsed) : parsed;
}

function unitMultiplierForTable(table: ParsedTable): number {
  return hasAny(tableText(table), unitMillionRialPatterns) ? 1_000_000 : 1;
}

function findColumnIndexes(rows: string[][], patterns: RegExp[]): number[] {
  const indexes = new Set<number>();
  for (const row of rows.slice(0, 3)) {
    row.forEach((cell, index) => {
      if (hasAny(normalizeText(cell), patterns)) {
        indexes.add(index);
      }
    });
  }
  return [...indexes];
}

function rowLabel(row: string[]): string {
  return normalizeText(row.find((cell) => !parseCandidateNumber(cell)) ?? row[0] ?? '');
}

function totalRows(rows: string[][]): Array<{ row: string[]; rowIndex: number; exact: boolean }> {
  return rows
    .map((row, rowIndex) => ({ row, rowIndex, label: rowLabel(row) }))
    .filter(({ label }) => hasAny(label, totalRowPatterns))
    .map(({ row, rowIndex, label }) => ({
      row,
      rowIndex,
      exact: /^جمع(?:\s*کل)?$/.test(label)
    }));
}

function fallbackNumericRows(rows: string[][], columnIndex: number): Array<{ row: string[]; rowIndex: number; exact: boolean }> {
  return rows
    .map((row, rowIndex) => ({ row, rowIndex, exact: false }))
    .slice(1)
    .filter(({ row }) => parseCandidateNumber(row[columnIndex] ?? '') !== undefined);
}

function confidenceForValue(options: {
  tableConfidence: ParseConfidence;
  exactTotalRow: boolean;
  exactColumnMatch: boolean;
  ambiguous: boolean;
}): ParseConfidence {
  if (options.ambiguous) return 'low';
  if (options.tableConfidence === 'high' && options.exactTotalRow && options.exactColumnMatch) return 'high';
  if (options.tableConfidence !== 'low' && options.exactColumnMatch) return 'medium';
  return 'low';
}

function valueLabel(kind: PortfolioValueKind): string {
  if (kind === 'listedPortfolioCostValue') return 'بهای تمام شده پرتفوی بورسی';
  if (kind === 'listedPortfolioMarketValue') return 'ارزش بازار پرتفوی بورسی';
  if (kind === 'unlistedPortfolioCostValue') return 'بهای تمام شده پرتفوی غیربورسی';
  if (kind === 'unlistedPortfolioEstimatedValue') return 'ارزش برآوردی پرتفوی غیربورسی';
  return 'مازاد پیشنهادی پرتفوی غیربورسی';
}

function extractionReason(options: {
  table: ParsedTable;
  rowIndex: number;
  columnIndex: number;
  confidence: ParseConfidence;
  usedTotalRow: boolean;
  unitMultiplier: number;
}): string {
  const rowName = options.usedTotalRow ? 'ردیف جمع/جمع کل' : `ردیف ${options.rowIndex + 1}`;
  const unit = options.unitMultiplier === 1_000_000 ? '؛ واحد جدول میلیون ریال تشخیص داده شد' : '';
  return `جدول ${options.table.index}، ستون ${options.columnIndex + 1}، ${rowName} (${options.confidence})${unit}`;
}

function extractValuesFromTable(
  table: ParsedTable,
  kind: PortfolioValueKind,
  tableScope: 'listed' | 'unlisted',
  tableConfidence: ParseConfidence
): ExtractedPortfolioValue[] {
  const columnIndexes = findColumnIndexes(table.rows, labelPatterns[kind]);
  if (columnIndexes.length === 0) {
    return [];
  }

  const multiplier = unitMultiplierForTable(table);
  const extracted: ExtractedPortfolioValue[] = [];
  for (const columnIndex of columnIndexes) {
    const rows = totalRows(table.rows);
    const candidateRows = rows.length > 0 ? rows : fallbackNumericRows(table.rows, columnIndex);
    const numericRows = candidateRows
      .map((candidate) => ({
        ...candidate,
        rawText: candidate.row[columnIndex] ?? '',
        value: parseCandidateNumber(candidate.row[columnIndex] ?? '')
      }))
      .filter((candidate) => candidate.value !== undefined);

    const ambiguous = columnIndexes.length > 1 || numericRows.length !== 1;
    for (const numericRow of numericRows) {
      const confidence = confidenceForValue({
        tableConfidence,
        exactTotalRow: numericRow.exact,
        exactColumnMatch: true,
        ambiguous
      });
      extracted.push({
        kind,
        label: valueLabel(kind),
        value: numericRow.value! * multiplier,
        rawText: numericRow.rawText,
        confidence: tableScope === 'unlisted' && confidence === 'high' ? 'medium' : confidence,
        sourceTableIndex: table.index,
        sourceRowIndex: numericRow.rowIndex,
        sourceColumnIndex: columnIndex,
        reason: extractionReason({
          table,
          rowIndex: numericRow.rowIndex,
          columnIndex,
          confidence,
          usedTotalRow: rows.length > 0,
          unitMultiplier: multiplier
        }),
        warning:
          confidence === 'low'
            ? 'این مقدار نیاز به بررسی دستی دارد؛ ردیف یا ستون استخراج مبهم است.'
            : undefined
      });
    }
  }
  return extracted;
}

function extractReportPeriod(detail: CodalReportDetail): string | undefined {
  const source = normalizeText(`${detail.title ?? ''} ${detail.plainTextPreview ?? ''}`);
  return source.match(/\d{4}\/\d{1,2}\/\d{1,2}/)?.[0];
}

function downgradeDuplicateKinds(values: ExtractedPortfolioValue[]): ExtractedPortfolioValue[] {
  const counts = values.reduce<Record<string, number>>((accumulator, value) => {
    accumulator[value.kind] = (accumulator[value.kind] ?? 0) + 1;
    return accumulator;
  }, {});

  return values.map((value) =>
    counts[value.kind] > 1
      ? {
          ...value,
          confidence: 'low',
          warning: value.warning ?? 'چند کاندید برای این نوع مقدار پیدا شد؛ این مقدار نیاز به بررسی دستی دارد.'
        }
      : value
  );
}

export function parseMonthlyActivityReport(detail: CodalReportDetail): MonthlyActivityParseResult {
  const warnings: string[] = [];
  const parsedAt = new Date().toISOString();
  const title = detail.title ?? '';

  if (title && !isMonthlyActivityReport(title)) {
    return {
      status: 'unsupported-report',
      reportTitle: detail.title,
      reportPeriod: extractReportPeriod(detail),
      sourceReportUrl: detail.sourceUrl,
      tableCandidates: [],
      extractedValues: [],
      tablePreviews: [],
      warnings: ['عنوان گزارش شبیه گزارش فعالیت ماهانه نیست.'],
      parsedAt
    };
  }

  const tables = [
    ...tablesFromExtractedTables(detail.extractedTables),
    ...(detail.extractedTables?.length ? [] : detail.rawHtml ? tablesFromHtml(detail.rawHtml) : []),
    ...(detail.extractedTables?.length ? [] : detail.rawJson ? tablesFromJson(detail.rawJson) : [])
  ];
  const tablePreviews = tables.map(tablePreview);

  if (tables.length === 0) {
    return {
      status: 'empty',
      reportTitle: detail.title,
      reportPeriod: extractReportPeriod(detail),
      sourceReportUrl: detail.sourceUrl,
      tableCandidates: [],
      extractedValues: [],
      tablePreviews: [],
      warnings: ['هیچ جدول قابل بررسی در گزارش پیدا نشد.'],
      parsedAt
    };
  }

  const candidates = tables.map(classifyTable).filter((item): item is PortfolioTableCandidate => Boolean(item));
  if (candidates.length === 0) {
    return {
      status: 'no-candidate-table',
      reportTitle: detail.title,
      reportPeriod: extractReportPeriod(detail),
      sourceReportUrl: detail.sourceUrl,
      tableCandidates: [],
      extractedValues: [],
      tablePreviews,
      warnings: ['جدول پرتفوی بورسی یا غیربورسی با اطمینان کافی پیدا نشد.'],
      parsedAt
    };
  }

  const extractedValues: ExtractedPortfolioValue[] = [];
  for (const candidate of candidates) {
    const table = tables.find((item) => item.index === candidate.index);
    if (!table) {
      continue;
    }

    const text = tableText(table);
    const isListed = hasAny(text, listedSignals);
    const isUnlisted = hasAny(text, unlistedSignals);
    if (isListed) {
      extractedValues.push(
        ...extractValuesFromTable(table, 'listedPortfolioCostValue', 'listed', candidate.confidence),
        ...extractValuesFromTable(table, 'listedPortfolioMarketValue', 'listed', candidate.confidence)
      );
    }
    if (isUnlisted) {
      const costValues = extractValuesFromTable(table, 'unlistedPortfolioCostValue', 'unlisted', candidate.confidence);
      const estimatedValues = extractValuesFromTable(
        table,
        'unlistedPortfolioEstimatedValue',
        'unlisted',
        candidate.confidence
      );
      extractedValues.push(...costValues, ...estimatedValues);
      const cost = costValues.length === 1 ? costValues[0] : undefined;
      const estimated = estimatedValues.length === 1 ? estimatedValues[0] : undefined;
      if (cost?.value !== undefined && estimated?.value !== undefined) {
        extractedValues.push({
          kind: 'unlistedPortfolioSurplusSuggestion',
          label: valueLabel('unlistedPortfolioSurplusSuggestion'),
          value: estimated.value - cost.value,
          rawText: `${estimated.rawText} - ${cost.rawText}`,
          confidence: 'low',
          sourceTableIndex: table.index,
          sourceRowIndex: estimated.sourceRowIndex,
          reason: `اختلاف ارزش برآوردی و بهای تمام شده از جدول ${table.index}`,
          warning: 'این مقدار از اختلاف ارزش برآوردی و بهای تمام شده ساخته شده و باید دستی بررسی شود.'
        });
      }
    }
  }

  const safeExtractedValues = downgradeDuplicateKinds(extractedValues);
  const duplicateKinds = safeExtractedValues
    .map((value) => value.kind)
    .filter((kind, index, all) => all.indexOf(kind) !== index);
  if (duplicateKinds.length > 0) {
    warnings.push('چند کاندید برای یک نوع داده پیدا شد؛ نتیجه نیاز به بررسی دستی دارد.');
  }

  if (safeExtractedValues.length === 0) {
    warnings.push('جدول مرتبط پیدا شد، اما مقدار عددی قابل اتکا استخراج نشد. پیش‌نمایش جدول‌ها را برای برچسب‌ها و ردیف‌های جمع بررسی کنید.');
  }

  return {
    status: duplicateKinds.length > 0 ? 'ambiguous' : safeExtractedValues.length > 0 ? 'parsed' : 'ambiguous',
    reportTitle: detail.title,
    reportPeriod: extractReportPeriod(detail),
    sourceReportUrl: detail.sourceUrl,
    tableCandidates: candidates,
    extractedValues: safeExtractedValues,
    tablePreviews,
    warnings,
    parsedAt
  };
}
