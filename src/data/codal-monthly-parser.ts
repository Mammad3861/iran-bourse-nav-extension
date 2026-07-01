import { normalizePersianArabicDigits, parseLocalizedNumber } from '../core/number-utils';
import {
  type CodalCellTableReconstructionMetadata,
  type CodalExtractedTable,
  type CodalReportDetail,
  type CodalReportSelectionDiagnostics,
  type CodalSourceStrategyDiagnostics,
  isMonthlyActivityReport,
  reconstructCodalCellTable,
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
  period?: string;
  periodLabel?: string;
  unit?: string;
  unitMultiplier?: number;
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
  detectedUnit?: string;
  source?: CodalExtractedTable['source'];
  reconstruction?: CodalCellTableReconstructionMetadata;
  rawHeaders: string[];
  normalizedHeaders: string[];
  rawRows: string[][];
  normalizedRows: string[][];
  headers: string[];
  rows: string[][];
  textPreview: string;
  detectedLabels: string[];
  warnings: string[];
}

export interface ParserColumnCandidate {
  index: number;
  label: string;
}

export interface ParserTotalRowCandidate {
  rowIndex: number;
  label: string;
  cells: string[];
  exact: boolean;
}

export interface ParserTableDiagnostics {
  tableIndex: number;
  caption?: string;
  detectedUnit?: string;
  source?: CodalExtractedTable['source'];
  reconstruction?: CodalCellTableReconstructionMetadata;
  rawHeaders: string[];
  normalizedHeaders: string[];
  firstRawRows: string[][];
  firstNormalizedRows: string[][];
  firstRows: string[][];
  detectedLabels: string[];
  totalRowCandidates: ParserTotalRowCandidate[];
  costColumnCandidates: ParserColumnCandidate[];
  marketValueColumnCandidates: ParserColumnCandidate[];
  failureReasons: string[];
  textPreview: string;
}

export interface ParserRejectedCandidate {
  tableIndex?: number;
  reason: string;
}

export interface MonthlyActivityParserDiagnostics {
  symbol?: string;
  codalSymbol?: string;
  reportTitle?: string;
  reportDate?: string;
  reportUrl?: string;
  tracingNo?: string;
  reportId?: string;
  reportSelection?: CodalReportSelectionDiagnostics;
  sourceStrategy?: CodalSourceStrategyDiagnostics;
  fetchTimestamp?: string;
  detectedTableCount: number;
  parserStatus: MonthlyActivityParseResult['status'];
  parserWarnings: string[];
  extractedCandidates: ExtractedPortfolioValue[];
  rejectedCandidates: ParserRejectedCandidate[];
  tables: ParserTableDiagnostics[];
}

export interface MonthlyActivityParseResult {
  status: 'parsed' | 'no-candidate-table' | 'unsupported-report' | 'ambiguous' | 'empty';
  reportTitle?: string;
  reportPeriod?: string;
  sourceReportUrl?: string;
  tableCandidates: PortfolioTableCandidate[];
  extractedValues: ExtractedPortfolioValue[];
  tablePreviews: ParserTablePreview[];
  diagnostics: MonthlyActivityParserDiagnostics;
  warnings: string[];
  parsedAt: string;
}

interface ParsedTable {
  index: number;
  caption?: string;
  source?: CodalExtractedTable['source'];
  reconstruction?: CodalCellTableReconstructionMetadata;
  rawRows: string[][];
  rows: string[][];
}

const labelPatterns: Record<PortfolioValueKind, RegExp[]> = {
  listedPortfolioCostValue: [
    /بهای\s*تمام\s*شده/,
    /بهای\s*تمام‌شده/,
    /بهای\s*تمام/,
    /مبلغ\s*تمام\s*شده/,
    /مبلغ\s*تمام‌شده/,
    /مبلغ\s*بهای\s*تمام/
  ],
  listedPortfolioMarketValue: [
    /ارزش\s*بازار/,
    /ارزش\s*روز/,
    /مبلغ\s*بازار/,
    /مبلغ\s*ارزش\s*بازار/,
    /مبلغ\s*ارزش\s*روز/
  ],
  unlistedPortfolioCostValue: [
    /بهای\s*تمام\s*شده/,
    /بهای\s*تمام‌شده/,
    /بهای\s*تمام/,
    /مبلغ\s*تمام\s*شده/,
    /مبلغ\s*تمام‌شده/,
    /مبلغ\s*بهای\s*تمام/
  ],
  unlistedPortfolioEstimatedValue: [
    /ارزش\s*برآوردی/,
    /ارزش\s*روز/,
    /ارزش\s*بازار/,
    /خالص\s*ارزش/,
    /مبلغ\s*بازار/,
    /مبلغ\s*ارزش/
  ],
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

const totalRowPatterns = [
  /^جمع$/,
  /^جمع\s*کل$/,
  /^مجموع$/,
  /جمع\s*سرمایه\s*گذاری/,
  /جمع\s*سرمایه‌گذاری/,
  /مجموع\s*سرمایه\s*گذاری/,
  /مجموع\s*سرمایه‌گذاری/,
  /جمع\s*پرتفوی/,
  /جمع\s*پورتفوی/,
  /مانده\s*پایان\s*دوره/,
  /سرمایه\s*گذاری\s*ها/,
  /سرمایه‌گذاری\s*ها/
];

interface UnitInfo {
  unit: 'ریال' | 'هزار ریال' | 'میلیون ریال' | 'میلیون تومان' | 'نامشخص';
  multiplier: number;
  clear: boolean;
  warning?: string;
}

interface ColumnContext {
  index: number;
  periodLabel?: string;
  measureLabel?: string;
  isCurrentPeriod: boolean;
  isPriorPeriod: boolean;
}

interface CandidateRejection {
  tableIndex: number;
  reason: string;
}

function normalizeText(value: string): string {
  return normalizePersianArabicDigits(value)
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRow(row: string[]): string[] {
  return row.map((cell) => normalizeText(String(cell)));
}

function parsedTableFromRows(
  index: number,
  rawRows: string[][],
  caption?: string,
  source?: CodalExtractedTable['source'],
  reconstruction?: CodalCellTableReconstructionMetadata
): ParsedTable {
  const normalizedCaption = caption ? normalizeText(caption) : undefined;
  return {
    index,
    caption: normalizedCaption,
    source,
    reconstruction,
    rawRows: rawRows.map((row) => row.map((cell) => String(cell))),
    rows: rawRows.map(normalizeRow).filter((row) => row.some(Boolean))
  };
}

function normalizedHeaderKey(value: string): string {
  return normalizeText(value).toLowerCase();
}

function recordsFromTechnicalCellRows(rows: string[][]): Record<string, unknown>[] {
  const headers = rows[0] ?? [];
  const normalizedHeaders = headers.map(normalizedHeaderKey);
  const hasCellModelHeaders =
    normalizedHeaders.includes('metatableid') &&
    normalizedHeaders.includes('metatablecode') &&
    normalizedHeaders.includes('address') &&
    normalizedHeaders.includes('value') &&
    (normalizedHeaders.includes('rowsequence') || normalizedHeaders.includes('columnsequence'));

  if (!hasCellModelHeaders) {
    return [];
  }

  return rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, row[index] ?? '']).filter(([header]) => String(header).trim())
      )
    );
}

function reconstructExtractedCellModelTable(table: CodalExtractedTable): ParsedTable | undefined {
  if (table.source === 'codal-cell-model') {
    return undefined;
  }

  const rows = table.rows.length > 0 ? table.rows : [table.headers];
  const records = recordsFromTechnicalCellRows(rows);
  if (records.length === 0) {
    return undefined;
  }

  const reconstructed = reconstructCodalCellTable(records, table.index);
  if (!reconstructed) {
    return undefined;
  }

  return parsedTableFromRows(
    table.index,
    reconstructed.rows.map((row) => row.map((cell) => String(cell))),
    table.caption ?? reconstructed.caption,
    reconstructed.source,
    reconstructed.reconstruction
  );
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

function rawTextFromHtml(html: string): string {
  return decodeHtmlEntities(stripUnsafeHtml(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function cellsFromRow(rowHtml: string): string[] {
  return Array.from(rowHtml.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi))
    .map((match) => rawTextFromHtml(match[1]));
}

function tablesFromHtml(html: string): ParsedTable[] {
  return Array.from(stripUnsafeHtml(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)).map(
    (match, index) => {
      const tableHtml = match[1];
      const captionMatch = tableHtml.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
      const rawRows = Array.from(tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
        .map((rowMatch) => cellsFromRow(rowMatch[1]))
        .filter((row) => row.length > 0);
      return parsedTableFromRows(index, rawRows, captionMatch ? rawTextFromHtml(captionMatch[1]) : undefined, 'html-table');
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

      return parsedTableFromRows(
        index,
        [headers, ...rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell)) : []))].filter(
          (row) => row.length > 0
        ),
        typeof table.title === 'string' ? table.title : typeof table.caption === 'string' ? table.caption : undefined,
        'json'
      );
    })
    .filter((table): table is ParsedTable => Boolean(table));
}

function tablesFromExtractedTables(tables: CodalExtractedTable[] | undefined): ParsedTable[] {
  return (tables ?? [])
    .map((table): ParsedTable => {
      const reconstructed = reconstructExtractedCellModelTable(table);
      if (reconstructed) {
        return reconstructed;
      }

      const rows = table.rows.length > 0 ? table.rows : [table.headers];
      return parsedTableFromRows(
        table.index,
        rows.map((row) => row.map((cell) => String(cell))),
        table.caption,
        table.source,
        table.reconstruction
      );
    })
    .filter((table) => table.rows.length > 0);
}

function tableText(table: ParsedTable): string {
  return normalizeText(`${table.caption ?? ''} ${table.rows.flat().join(' ')}`);
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isReconstructedSummaryInvestmentTable(table: ParsedTable): boolean {
  const metaTableCode = table.reconstruction?.metaTableCode;
  const source = normalizeText(`${table.caption ?? ''} ${table.reconstruction?.alias ?? ''}`);
  return metaTableCode === '2570' || /SummaryOfCompanyInvestments/i.test(source);
}

function matchedLabels(text: string): string[] {
  const labels = [
    'بهای تمام شده',
    'مبلغ تمام شده',
    'ارزش بازار',
    'ارزش روز',
    'مبلغ بازار',
    'افزایش/کاهش',
    'سرمایه گذاری در سهام',
    'پذیرفته شده در بورس',
    'خارج از بورس',
    'پرتفوی بورسی',
    'پرتفوی غیر بورسی',
    'جمع',
    'جمع کل',
    'مجموع',
    'مانده پایان دوره',
    'سرمایه گذاری ها'
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
    warnings.push('ردیف جمع، مجموع، مانده پایان دوره یا سرمایه گذاری ها با اطمینان شناسایی نشد.');
  }
  return warnings;
}

function unitInfoForText(text: string): UnitInfo {
  if (/میلیون\s*تومان/.test(text)) {
    return { unit: 'میلیون تومان', multiplier: 10_000_000, clear: true };
  }
  if (/میلیون\s*ریال|میلیون\s*ریالی/.test(text)) {
    return { unit: 'میلیون ریال', multiplier: 1_000_000, clear: true };
  }
  if (/هزار\s*ریال/.test(text)) {
    return { unit: 'هزار ریال', multiplier: 1_000, clear: true };
  }
  if (/(^|\s)ریال(\s|$)|مبالغ\s*به\s*ریال/.test(text)) {
    return { unit: 'ریال', multiplier: 1, clear: true };
  }

  return {
    unit: 'نامشخص',
    multiplier: 1,
    clear: false,
    warning: 'واحد جدول با اطمینان تشخیص داده نشد؛ مقدار خام بدون مقیاس‌گذاری پیشنهاد شده است.'
  };
}

function tablePreview(table: ParsedTable): ParserTablePreview {
  const text = tableText(table);
  const rawHeaders = (table.rawRows[0] ?? []).slice(0, 12);
  const normalizedHeaders = (table.rows[0] ?? []).slice(0, 12);
  const rawRows = table.rawRows.slice(0, 10).map((row) => row.slice(0, 12));
  const normalizedRows = table.rows.slice(0, 10).map((row) => row.slice(0, 12));
  return {
    index: table.index,
    caption: table.caption,
    detectedUnit: unitInfoForText(text).unit,
    source: table.source,
    reconstruction: table.reconstruction,
    rawHeaders,
    normalizedHeaders,
    rawRows,
    normalizedRows,
    headers: normalizedHeaders,
    rows: normalizedRows,
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

function unitInfoForTable(table: ParsedTable): UnitInfo {
  return unitInfoForText(tableText(table));
}

function findColumnIndexes(rows: string[][], patterns: RegExp[]): number[] {
  const indexes = new Set<number>();
  for (const row of rows.slice(0, 6)) {
    row.forEach((cell, index) => {
      if (hasAny(normalizeText(cell), patterns)) {
        indexes.add(index);
      }
    });
  }
  return [...indexes];
}

function findColumnCandidates(rows: string[][], patterns: RegExp[]): ParserColumnCandidate[] {
  return findColumnIndexes(rows, patterns).map((index) => ({
    index,
    label: rows
      .slice(0, 6)
      .map((row) => row[index])
      .find((cell) => cell && hasAny(normalizeText(cell), patterns)) ?? ''
  }));
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
      exact: /^(جمع(?:\s*کل)?|مجموع|مانده\s*پایان\s*دوره|سرمایه\s*گذاری\s*ها|سرمایه‌گذاری\s*ها)$/.test(label)
    }));
}

function preferredAggregateRows(rows: string[][]): Array<{ row: string[]; rowIndex: number; exact: boolean }> {
  const candidates = totalRows(rows);
  const exactRows = candidates.filter((candidate) => candidate.exact);
  if (exactRows.length > 0) {
    return exactRows;
  }
  return candidates;
}

function totalRowCandidatesForDiagnostics(rows: string[][]): ParserTotalRowCandidate[] {
  return totalRows(rows).map((candidate) => ({
    rowIndex: candidate.rowIndex,
    label: rowLabel(candidate.row),
    cells: candidate.row,
    exact: candidate.exact
  }));
}

function fallbackNumericRows(rows: string[][], columnIndex: number): Array<{ row: string[]; rowIndex: number; exact: boolean }> {
  return rows
    .map((row, rowIndex) => ({ row, rowIndex, exact: false }))
    .slice(1)
    .filter(({ row }) => parseCandidateNumber(row[columnIndex] ?? '') !== undefined);
}

function dateFromText(value: string): string | undefined {
  return normalizeText(value).match(/\d{4}\/\d{1,2}\/\d{1,2}/)?.[0];
}

function columnContextFor(rows: string[][], columnIndex: number, reportPeriod?: string): ColumnContext {
  const headerCells = rows.slice(0, 6).map((row) => normalizeText(row[columnIndex] ?? '')).filter(Boolean);
  const periodLabel = headerCells.find((cell) => dateFromText(cell));
  const measureLabel = headerCells.find((cell) =>
    hasAny(cell, [...labelPatterns.listedPortfolioCostValue, ...labelPatterns.listedPortfolioMarketValue])
  );
  const periodDate = periodLabel ? dateFromText(periodLabel) : undefined;

  return {
    index: columnIndex,
    periodLabel,
    measureLabel,
    isCurrentPeriod: Boolean(reportPeriod && periodDate === reportPeriod),
    isPriorPeriod: Boolean(reportPeriod && periodDate && periodDate !== reportPeriod)
  };
}

function rankColumnContext(context: ColumnContext): number {
  if (context.isPriorPeriod) return -100;
  if (context.isCurrentPeriod) return 100;
  if (!context.periodLabel) return 20;
  return 0;
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
  periodLabel?: string;
}): string {
  const rowName = options.usedTotalRow ? 'ردیف جمع/جمع کل' : `ردیف ${options.rowIndex + 1}`;
  const period = options.periodLabel ? `، دوره: ${options.periodLabel}` : '';
  const unit =
    options.unitMultiplier === 10_000_000
      ? '؛ واحد جدول میلیون تومان تشخیص داده شد'
      : options.unitMultiplier === 1_000_000
        ? '؛ واحد جدول میلیون ریال تشخیص داده شد'
        : options.unitMultiplier === 1_000
          ? '؛ واحد جدول هزار ریال تشخیص داده شد'
          : '';
  return `جدول ${options.table.index}، ستون ${options.columnIndex + 1}، ${rowName}${period} (${options.confidence})${unit}`;
}

function extractValuesFromTable(
  table: ParsedTable,
  kind: PortfolioValueKind,
  tableScope: 'listed' | 'unlisted',
  tableConfidence: ParseConfidence,
  reportPeriod?: string,
  rejections: CandidateRejection[] = []
): ExtractedPortfolioValue[] {
  const columnIndexes = findColumnIndexes(table.rows, labelPatterns[kind]);
  if (columnIndexes.length === 0) {
    return [];
  }

  const columnContexts = columnIndexes
    .map((index) => columnContextFor(table.rows, index, reportPeriod))
    .sort((left, right) => rankColumnContext(right) - rankColumnContext(left));
  const usableColumnContexts = columnContexts.filter((context) => !context.isPriorPeriod);
  const selectedColumnContexts = usableColumnContexts.length > 0 ? usableColumnContexts : [];
  for (const context of columnContexts.filter((item) => item.isPriorPeriod)) {
    rejections.push({
      tableIndex: table.index,
      reason: `کاندید ستون ${context.index + 1} رد شد چون مربوط به دوره قبلی ${context.periodLabel ?? ''} است.`
    });
  }

  const unitInfo = unitInfoForTable(table);
  const extracted: ExtractedPortfolioValue[] = [];
  for (const context of selectedColumnContexts) {
    const columnIndex = context.index;
    const rows = preferredAggregateRows(table.rows);
    const candidateRows = rows.length > 0 ? rows : fallbackNumericRows(table.rows, columnIndex);
    const numericRowsBeforeZeroFilter = candidateRows
      .map((candidate) => ({
        ...candidate,
        rawText: candidate.row[columnIndex] ?? '',
        value: parseCandidateNumber(candidate.row[columnIndex] ?? '')
      }))
      .filter((candidate) => candidate.value !== undefined);
    const hasNonZero = numericRowsBeforeZeroFilter.some((candidate) => candidate.value !== 0);
    const nonZeroFilteredRows = hasNonZero
      ? numericRowsBeforeZeroFilter.filter((candidate) => {
          if (candidate.value === 0) {
            rejections.push({
              tableIndex: table.index,
              reason: `کاندید صفر در ردیف ${candidate.rowIndex + 1} ستون ${columnIndex + 1} رد شد چون مقدار غیرصفر قابل اتکاتری وجود دارد.`
            });
            return false;
          }
          return true;
        })
      : numericRowsBeforeZeroFilter;
    const numericRows =
      nonZeroFilteredRows.length > 1 && nonZeroFilteredRows.every((candidate) => candidate.exact)
        ? nonZeroFilteredRows.filter((candidate, index) => {
            const keep = index === nonZeroFilteredRows.length - 1;
            if (!keep) {
              rejections.push({
                tableIndex: table.index,
                reason: `کاندید ردیف ${candidate.rowIndex + 1} رد شد چون ردیف جمع دقیق‌تری در انتهای بخش وجود دارد.`
              });
            }
            return keep;
          })
        : nonZeroFilteredRows;

    const ambiguous =
      selectedColumnContexts.length > 1 ||
      numericRows.length !== 1 ||
      Boolean(reportPeriod && context.periodLabel && !context.isCurrentPeriod);
    for (const numericRow of numericRows) {
      const baseConfidence = confidenceForValue({
        tableConfidence,
        exactTotalRow: numericRow.exact,
        exactColumnMatch: true,
        ambiguous
      });
      const confidence = !unitInfo.clear && baseConfidence === 'high' ? 'medium' : baseConfidence;
      extracted.push({
        kind,
        label: valueLabel(kind),
        value: numericRow.value! * unitInfo.multiplier,
        rawText: numericRow.rawText,
        period: context.isCurrentPeriod ? reportPeriod : undefined,
        periodLabel: context.periodLabel,
        unit: unitInfo.unit,
        unitMultiplier: unitInfo.multiplier,
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
          unitMultiplier: unitInfo.multiplier,
          periodLabel: context.periodLabel
        }),
        warning:
          unitInfo.warning ??
          (confidence === 'low'
            ? 'این مقدار نیاز به بررسی دستی دارد؛ ردیف یا ستون استخراج مبهم است.'
            : undefined)
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

function extractionFailureWarnings(candidates: PortfolioTableCandidate[], tables: ParsedTable[]): string[] {
  const warnings = new Set<string>();
  for (const candidate of candidates) {
    const table = tables.find((item) => item.index === candidate.index);
    if (!table) continue;

    const rows = totalRows(table.rows);
    if (rows.length === 0) {
      warnings.add(`جدول ${table.index}: ردیف جمع، مجموع، مانده پایان دوره یا سرمایه گذاری ها پیدا نشد.`);
    }
    if (rows.length > 1) {
      warnings.add(`جدول ${table.index}: چند ردیف جمع/مجموع پیدا شد و نتیجه مبهم است.`);
    }

    const costColumns = findColumnIndexes(table.rows, labelPatterns.listedPortfolioCostValue);
    const marketColumns = findColumnIndexes(table.rows, labelPatterns.listedPortfolioMarketValue);
    if (costColumns.length === 0) {
      warnings.add(`جدول ${table.index}: ستون بهای تمام شده یا مبلغ تمام شده پیدا نشد.`);
    }
    if (marketColumns.length === 0) {
      warnings.add(
        table.reconstruction
          ? `جدول ${table.index}: ستون ارزش بازار در جدول بازسازی‌شده پیدا نشد.`
          : `جدول ${table.index}: ستون ارزش بازار، ارزش روز یا مبلغ بازار پیدا نشد.`
      );
    }

    const unitInfo = unitInfoForTable(table);
    if (!unitInfo.clear) {
      warnings.add(`جدول ${table.index}: واحد گزارش مشخص نیست؛ مقدار خام بدون مقیاس‌گذاری قابل بررسی است.`);
    }
  }

  return [...warnings];
}

function partialExtractionWarnings(
  candidates: PortfolioTableCandidate[],
  tables: ParsedTable[],
  values: ExtractedPortfolioValue[]
): string[] {
  const warnings = new Set<string>();
  const extractedKindsByTable = new Map<number, Set<PortfolioValueKind>>();
  for (const value of values) {
    const kinds = extractedKindsByTable.get(value.sourceTableIndex) ?? new Set<PortfolioValueKind>();
    kinds.add(value.kind);
    extractedKindsByTable.set(value.sourceTableIndex, kinds);
  }

  for (const candidate of candidates) {
    const table = tables.find((item) => item.index === candidate.index);
    const kinds = extractedKindsByTable.get(candidate.index);
    if (!table || !kinds?.has('listedPortfolioCostValue') || kinds.has('listedPortfolioMarketValue')) {
      continue;
    }

    if (findColumnIndexes(table.rows, labelPatterns.listedPortfolioMarketValue).length === 0) {
      warnings.add(
        table.reconstruction
          ? `جدول ${table.index}: ستون ارزش بازار در جدول بازسازی‌شده پیدا نشد.`
          : `جدول ${table.index}: ستون ارزش بازار، ارزش روز یا مبلغ بازار پیدا نشد.`
      );
    }
  }

  return [...warnings];
}

function tableFailureReasons(table: ParsedTable): string[] {
  const reasons = new Set<string>(tableWarnings(table));
  const rows = totalRows(table.rows);
  const costColumns = findColumnIndexes(table.rows, labelPatterns.listedPortfolioCostValue);
  const marketColumns = findColumnIndexes(table.rows, labelPatterns.listedPortfolioMarketValue);
  const unitInfo = unitInfoForTable(table);

  if (!hasAny(tableText(table), portfolioSignals)) {
    reasons.add('این جدول برچسب پرتفوی یا سرمایه گذاری کافی ندارد.');
  }
  if (rows.length === 0) {
    reasons.add('ردیف جمع، مجموع، مانده پایان دوره یا سرمایه گذاری ها پیدا نشد.');
  }
  if (rows.length > 1) {
    reasons.add('چند ردیف جمع/مجموع پیدا شد و نتیجه ممکن است مبهم باشد.');
  }
  if (costColumns.length === 0) {
    reasons.add('ستون بهای تمام شده یا مبلغ تمام شده پیدا نشد.');
  }
  if (marketColumns.length === 0) {
    reasons.add(
      table.reconstruction
        ? 'ستون ارزش بازار در جدول بازسازی‌شده پیدا نشد.'
        : 'ستون ارزش بازار، ارزش روز یا مبلغ بازار پیدا نشد.'
    );
  }
  if (!unitInfo.clear) {
    reasons.add('واحد گزارش مشخص نیست؛ مقدار خام فقط برای بررسی دستی مناسب است.');
  }

  return [...reasons];
}

function tableDiagnostics(table: ParsedTable): ParserTableDiagnostics {
  const text = tableText(table);
  const unitInfo = unitInfoForTable(table);
  const rawHeaders = table.rawRows[0] ?? [];
  const normalizedHeaders = table.rows[0] ?? [];

  return {
    tableIndex: table.index,
    caption: table.caption,
    detectedUnit: unitInfo.unit,
    source: table.source,
    reconstruction: table.reconstruction,
    rawHeaders,
    normalizedHeaders,
    firstRawRows: table.rawRows.slice(0, 10).map((row) => row.slice(0, 12)),
    firstNormalizedRows: table.rows.slice(0, 10).map((row) => row.slice(0, 12)),
    firstRows: table.rows.slice(0, 10).map((row) => row.slice(0, 12)),
    detectedLabels: matchedLabels(text),
    totalRowCandidates: totalRowCandidatesForDiagnostics(table.rows).map((candidate) => ({
      ...candidate,
      cells: candidate.cells.slice(0, 12)
    })),
    costColumnCandidates: findColumnCandidates(table.rows, labelPatterns.listedPortfolioCostValue),
    marketValueColumnCandidates: findColumnCandidates(table.rows, labelPatterns.listedPortfolioMarketValue),
    failureReasons: tableFailureReasons(table),
    textPreview: text.slice(0, 700)
  };
}

function rejectedCandidatesForDiagnostics(
  tables: ParsedTable[],
  extractedValues: ExtractedPortfolioValue[],
  warnings: string[]
): ParserRejectedCandidate[] {
  const extractedTableIndexes = new Set(extractedValues.map((value) => value.sourceTableIndex));
  const rejected: ParserRejectedCandidate[] = [];

  for (const table of tables) {
    const reasons = tableFailureReasons(table);
    if (!extractedTableIndexes.has(table.index) || reasons.length > 0) {
      rejected.push(
        ...reasons.map((reason) => ({
          tableIndex: table.index,
          reason
        }))
      );
    }
  }

  rejected.push(...warnings.map((reason) => ({ reason })));
  return rejected;
}

function buildDiagnostics(options: {
  detail: CodalReportDetail;
  status: MonthlyActivityParseResult['status'];
  tables: ParsedTable[];
  warnings: string[];
  extractedValues: ExtractedPortfolioValue[];
}): MonthlyActivityParserDiagnostics {
  return {
    symbol: options.detail.symbol,
    codalSymbol: options.detail.symbol,
    reportTitle: options.detail.title,
    reportDate: options.detail.publishedAt ?? extractReportPeriod(options.detail),
    reportUrl: options.detail.sourceUrl,
    tracingNo: options.detail.tracingNo,
    reportId: options.detail.reportId,
    reportSelection: options.detail.selectionDiagnostics,
    sourceStrategy: options.detail.sourceStrategy,
    fetchTimestamp: options.detail.fetchedAt,
    detectedTableCount: options.tables.length,
    parserStatus: options.status,
    parserWarnings: options.warnings,
    extractedCandidates: options.extractedValues,
    rejectedCandidates: rejectedCandidatesForDiagnostics(options.tables, options.extractedValues, options.warnings),
    tables: options.tables.map(tableDiagnostics)
  };
}

export function parseMonthlyActivityReport(detail: CodalReportDetail): MonthlyActivityParseResult {
  const warnings: string[] = [];
  const parsedAt = new Date().toISOString();
  const title = detail.title ?? '';
  const reportPeriod = extractReportPeriod(detail);

  if (title && !isMonthlyActivityReport(title)) {
    const status: MonthlyActivityParseResult['status'] = 'unsupported-report';
    const resultWarnings = ['عنوان گزارش شبیه گزارش فعالیت ماهانه نیست.'];
    return {
      status,
      reportTitle: detail.title,
      reportPeriod,
      sourceReportUrl: detail.sourceUrl,
      tableCandidates: [],
      extractedValues: [],
      tablePreviews: [],
      diagnostics: buildDiagnostics({ detail, status, tables: [], warnings: resultWarnings, extractedValues: [] }),
      warnings: resultWarnings,
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
    const status: MonthlyActivityParseResult['status'] = 'empty';
    const resultWarnings = ['هیچ جدول قابل بررسی در گزارش پیدا نشد.'];
    return {
      status,
      reportTitle: detail.title,
      reportPeriod,
      sourceReportUrl: detail.sourceUrl,
      tableCandidates: [],
      extractedValues: [],
      tablePreviews: [],
      diagnostics: buildDiagnostics({ detail, status, tables, warnings: resultWarnings, extractedValues: [] }),
      warnings: resultWarnings,
      parsedAt
    };
  }

  const candidates = tables.map(classifyTable).filter((item): item is PortfolioTableCandidate => Boolean(item));
  if (candidates.length === 0) {
    const status: MonthlyActivityParseResult['status'] = 'no-candidate-table';
    const resultWarnings = ['جدول پرتفوی بورسی یا غیربورسی با اطمینان کافی پیدا نشد.'];
    return {
      status,
      reportTitle: detail.title,
      reportPeriod,
      sourceReportUrl: detail.sourceUrl,
      tableCandidates: [],
      extractedValues: [],
      tablePreviews,
      diagnostics: buildDiagnostics({ detail, status, tables, warnings: resultWarnings, extractedValues: [] }),
      warnings: resultWarnings,
      parsedAt
    };
  }

  const extractedValues: ExtractedPortfolioValue[] = [];
  const rejectedCandidateWarnings: CandidateRejection[] = [];
  for (const candidate of candidates) {
    const table = tables.find((item) => item.index === candidate.index);
    if (!table) {
      continue;
    }

    const text = tableText(table);
    const isListed = hasAny(text, listedSignals) || isReconstructedSummaryInvestmentTable(table);
    const isUnlisted = hasAny(text, unlistedSignals);
    if (isListed) {
      extractedValues.push(
        ...extractValuesFromTable(
          table,
          'listedPortfolioCostValue',
          'listed',
          candidate.confidence,
          reportPeriod,
          rejectedCandidateWarnings
        ),
        ...extractValuesFromTable(
          table,
          'listedPortfolioMarketValue',
          'listed',
          candidate.confidence,
          reportPeriod,
          rejectedCandidateWarnings
        )
      );
    }
    if (isUnlisted) {
      const costValues = extractValuesFromTable(
        table,
        'unlistedPortfolioCostValue',
        'unlisted',
        candidate.confidence,
        reportPeriod,
        rejectedCandidateWarnings
      );
      const estimatedValues = extractValuesFromTable(
        table,
        'unlistedPortfolioEstimatedValue',
        'unlisted',
        candidate.confidence,
        reportPeriod,
        rejectedCandidateWarnings
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
  warnings.push(...rejectedCandidateWarnings.map((rejection) => rejection.reason));
  warnings.push(...partialExtractionWarnings(candidates, tables, safeExtractedValues));
  if (!safeExtractedValues.some((value) => value.kind === 'listedPortfolioMarketValue')) {
    const excelStatus = detail.sourceStrategy?.excel.status;
    if (excelStatus === 'fetched') {
      warnings.push('ارزش روز پرتفوی بورسی در Excel گزارش نیز پیدا نشد.');
    } else if (excelStatus === 'unavailable') {
      warnings.push('ExcelUrl برای بررسی ارزش روز پرتفوی بورسی در متادیتای گزارش وجود نداشت.');
    } else if (excelStatus) {
      warnings.push(`بررسی ExcelUrl برای ارزش روز پرتفوی بورسی ناموفق بود: ${detail.sourceStrategy?.excel.errorMessage ?? excelStatus}`);
    }
  }
  if (duplicateKinds.length > 0) {
    warnings.push('چند کاندید برای یک نوع داده پیدا شد؛ نتیجه نیاز به بررسی دستی دارد.');
  }

  if (safeExtractedValues.length === 0) {
    warnings.push(...extractionFailureWarnings(candidates, tables));
    warnings.push('جدول مرتبط پیدا شد، اما مقدار عددی قابل اتکا استخراج نشد. پیش‌نمایش جدول‌ها را برای برچسب‌ها و ردیف‌های جمع بررسی کنید.');
  }

  const status: MonthlyActivityParseResult['status'] =
    duplicateKinds.length > 0 ? 'ambiguous' : safeExtractedValues.length > 0 ? 'parsed' : 'ambiguous';

  return {
    status,
    reportTitle: detail.title,
    reportPeriod,
    sourceReportUrl: detail.sourceUrl,
    tableCandidates: candidates,
    extractedValues: safeExtractedValues,
    tablePreviews,
    diagnostics: buildDiagnostics({ detail, status, tables, warnings, extractedValues: safeExtractedValues }),
    warnings,
    parsedAt
  };
}
