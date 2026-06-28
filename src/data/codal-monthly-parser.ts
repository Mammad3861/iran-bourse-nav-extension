import { normalizePersianArabicDigits, parseLocalizedNumber } from '../core/number-utils';
import {
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

export interface MonthlyActivityParseResult {
  status: 'parsed' | 'no-candidate-table' | 'unsupported-report' | 'ambiguous' | 'empty';
  reportTitle?: string;
  reportPeriod?: string;
  sourceReportUrl?: string;
  tableCandidates: PortfolioTableCandidate[];
  extractedValues: ExtractedPortfolioValue[];
  warnings: string[];
  parsedAt: string;
}

interface ParsedTable {
  index: number;
  caption?: string;
  rows: string[][];
}

const labelPatterns: Record<PortfolioValueKind, RegExp[]> = {
  listedPortfolioCostValue: [/بهای\s*تمام\s*شده/, /بهای\s*تمام‌شده/, /بهای\s*تمام/],
  listedPortfolioMarketValue: [/ارزش\s*بازار/, /ارزش\s*روز/],
  unlistedPortfolioCostValue: [/بهای\s*تمام\s*شده/, /بهای\s*تمام‌شده/, /بهای\s*تمام/],
  unlistedPortfolioEstimatedValue: [/ارزش\s*برآوردی/, /ارزش\s*روز/, /ارزش\s*بازار/, /خالص\s*ارزش/],
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

function tableText(table: ParsedTable): string {
  return normalizeText(`${table.caption ?? ''} ${table.rows.flat().join(' ')}`);
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function matchedLabels(text: string): string[] {
  const labels = [
    'بهای تمام شده',
    'ارزش بازار',
    'ارزش روز',
    'سرمایه گذاری در سهام',
    'پذیرفته شده در بورس',
    'خارج از بورس',
    'پرتفوی بورسی',
    'پرتفوی غیر بورسی'
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

function parseCandidateNumber(value: string): number | undefined {
  const normalized = normalizeText(value);
  const numbers = normalized.match(/[+-]?\d[\d,٬٫.]*/g) ?? [];
  if (numbers.length !== 1) {
    return undefined;
  }

  return parseLocalizedNumber(numbers[0]);
}

function findColumnIndex(rows: string[][], patterns: RegExp[]): number | undefined {
  for (const row of rows.slice(0, 3)) {
    const index = row.findIndex((cell) => hasAny(normalizeText(cell), patterns));
    if (index >= 0) {
      return index;
    }
  }
  return undefined;
}

function firstNumericValueInColumn(rows: string[][], columnIndex: number | undefined): {
  value?: number;
  rawText?: string;
  ambiguous: boolean;
} {
  if (columnIndex === undefined) {
    return { ambiguous: true };
  }

  const parsed = rows
    .slice(1)
    .map((row) => ({ rawText: row[columnIndex] ?? '', value: parseCandidateNumber(row[columnIndex] ?? '') }))
    .filter((item) => item.value !== undefined);

  if (parsed.length !== 1) {
    return { ambiguous: parsed.length > 1 };
  }

  return { value: parsed[0].value, rawText: parsed[0].rawText, ambiguous: false };
}

function extractValueFromTable(
  table: ParsedTable,
  kind: PortfolioValueKind,
  tableScope: 'listed' | 'unlisted'
): ExtractedPortfolioValue | undefined {
  const columnIndex = findColumnIndex(table.rows, labelPatterns[kind]);
  const parsed = firstNumericValueInColumn(table.rows, columnIndex);
  if (parsed.value === undefined || !parsed.rawText) {
    return undefined;
  }

  const confidence: ParseConfidence = parsed.ambiguous ? 'low' : tableScope === 'listed' ? 'high' : 'medium';

  return {
    kind,
    label:
      kind === 'listedPortfolioCostValue'
        ? 'بهای تمام شده پرتفوی بورسی'
        : kind === 'listedPortfolioMarketValue'
          ? 'ارزش بازار پرتفوی بورسی'
          : kind === 'unlistedPortfolioCostValue'
            ? 'بهای تمام شده پرتفوی غیربورسی'
            : 'ارزش برآوردی پرتفوی غیربورسی',
    value: parsed.value,
    rawText: parsed.rawText,
    confidence,
    sourceTableIndex: table.index,
    warning: confidence === 'low' ? 'چند مقدار عددی یا برچسب مبهم در جدول دیده شد.' : undefined
  };
}

function extractReportPeriod(detail: CodalReportDetail): string | undefined {
  const source = normalizeText(`${detail.title ?? ''} ${detail.plainTextPreview ?? ''}`);
  return source.match(/\d{4}\/\d{1,2}\/\d{1,2}/)?.[0];
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
      warnings: ['عنوان گزارش شبیه گزارش فعالیت ماهانه نیست.'],
      parsedAt
    };
  }

  const tables = [
    ...(detail.rawHtml ? tablesFromHtml(detail.rawHtml) : []),
    ...(detail.rawJson ? tablesFromJson(detail.rawJson) : [])
  ];

  if (tables.length === 0) {
    return {
      status: 'empty',
      reportTitle: detail.title,
      reportPeriod: extractReportPeriod(detail),
      sourceReportUrl: detail.sourceUrl,
      tableCandidates: [],
      extractedValues: [],
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
      const cost = extractValueFromTable(table, 'listedPortfolioCostValue', 'listed');
      const market = extractValueFromTable(table, 'listedPortfolioMarketValue', 'listed');
      if (cost) extractedValues.push(cost);
      if (market) extractedValues.push(market);
    }
    if (isUnlisted) {
      const cost = extractValueFromTable(table, 'unlistedPortfolioCostValue', 'unlisted');
      const estimated = extractValueFromTable(table, 'unlistedPortfolioEstimatedValue', 'unlisted');
      if (cost) extractedValues.push(cost);
      if (estimated) extractedValues.push(estimated);
      if (cost?.value !== undefined && estimated?.value !== undefined) {
        extractedValues.push({
          kind: 'unlistedPortfolioSurplusSuggestion',
          label: 'مازاد پیشنهادی پرتفوی غیربورسی',
          value: estimated.value - cost.value,
          rawText: `${estimated.rawText} - ${cost.rawText}`,
          confidence: 'low',
          sourceTableIndex: table.index,
          warning: 'این مقدار از اختلاف ارزش برآوردی و بهای تمام شده ساخته شده و باید دستی بررسی شود.'
        });
      }
    }
  }

  const duplicateKinds = extractedValues
    .map((value) => value.kind)
    .filter((kind, index, all) => all.indexOf(kind) !== index);
  if (duplicateKinds.length > 0) {
    warnings.push('چند مقدار برای یک نوع داده پیدا شد؛ نتیجه نیاز به بررسی دستی دارد.');
  }

  if (extractedValues.length === 0) {
    warnings.push('جدول مرتبط پیدا شد، اما مقدار عددی قابل اتکا استخراج نشد.');
  }

  return {
    status: duplicateKinds.length > 0 ? 'ambiguous' : extractedValues.length > 0 ? 'parsed' : 'ambiguous',
    reportTitle: detail.title,
    reportPeriod: extractReportPeriod(detail),
    sourceReportUrl: detail.sourceUrl,
    tableCandidates: candidates,
    extractedValues,
    warnings,
    parsedAt
  };
}
