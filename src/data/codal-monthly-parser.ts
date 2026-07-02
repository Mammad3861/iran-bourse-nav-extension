import { normalizePersianArabicDigits, parseLocalizedNumber } from '../core/number-utils';
import {
  type CodalCellTableReconstructionMetadata,
  type CodalExtractedTable,
  type CodalReportDetail,
  type CodalReportSelectionDiagnostics,
  type CodalSourceStrategyDiagnostics,
  isFinancialStatementReport,
  isMonthlyActivityReport,
  reconstructCodalCellTable,
  stripUnsafeHtml
} from './codal-client';

export type PortfolioValueKind =
  | 'listedPortfolioCostValue'
  | 'listedPortfolioMarketValue'
  | 'unlistedPortfolioCostValue'
  | 'unlistedPortfolioEstimatedValue'
  | 'unlistedPortfolioSurplusSuggestion'
  | 'equitySuggestion'
  | 'totalSharesSuggestion';

export type ParseConfidence = 'high' | 'medium' | 'low';

export interface ExtractedPortfolioValue {
  kind: PortfolioValueKind;
  label: string;
  value: number;
  scaledValue?: number;
  rawText: string;
  rawValue?: number;
  period?: string;
  periodLabel?: string;
  unit?: string;
  unitMultiplier?: number;
  confidence: ParseConfidence;
  sourceTableIndex: number;
  sourceRowIndex?: number;
  sourceColumnIndex?: number;
  sourceTableCaption?: string;
  rowLabel?: string;
  columnLabel?: string;
  rankingScore?: number;
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
  sourceGroup?: string;
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
  sourceGroup?: string;
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
  candidate?: ExtractedPortfolioValue;
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
  primarySuggestions: ExtractedPortfolioValue[];
  secondarySuggestions: ExtractedPortfolioValue[];
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
  unlistedPortfolioSurplusSuggestion: [/مازاد/],
  equitySuggestion: [
    /حقوق\s*صاحبان\s*سهام/,
    /جمع\s*حقوق\s*صاحبان\s*سهام/,
    /جمع\s*حقوق\s*مالکانه/,
    /حقوق\s*مالکانه/,
    /جمع\s*حقوق\s*صاحبان\s*سرمایه/
  ],
  totalSharesSuggestion: [
    /تعداد\s*کل\s*سهام/,
    /تعداد\s*سهام/,
    /سهام\s*منتشره/,
    /سرمایه\s*ثبت\s*شده\s*به\s*تعداد\s*سهام/
  ]
};

const financialStatementSignals = [
  /صورت\s*های\s*مالی/,
  /صورت‌های\s*مالی/,
  /صورت\s*مالی/,
  /اطلاعات\s*و\s*صورت/
];

const invalidFinancialStatementSignals = [
  /توضیحات\s*در\s*خصوص/,
  /شفاف\s*سازی/,
  /شفاف‌سازی/,
  /افشای\s*اطلاعات/
];

const totalSharesRejectSignals = [
  /حجم\s*معاملات/,
  /تعداد\s*معاملات/,
  /ارزش\s*معاملات/,
  /حجم\s*مبنا/,
  /سهام\s*شناور/,
  /تعداد\s*سهامداران/,
  /تعداد\s*خریدار/,
  /تعداد\s*فروشنده/
];

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
    'سرمایه گذاری ها',
    'حقوق صاحبان سهام',
    'جمع حقوق مالکانه',
    'تعداد کل سهام',
    'تعداد سهام'
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

function sourceGroupForTable(table: ParsedTable, parserGroup: 'monthly' | 'financial'): string {
  if (table.source === 'codal-excel') {
    return parserGroup === 'financial' ? 'financial-excel' : 'monthly-excel';
  }
  return parserGroup;
}

function tablePreview(table: ParsedTable, parserGroup: 'monthly' | 'financial' = 'monthly'): ParserTablePreview {
  const text = tableText(table);
  const rawHeaders = (table.rawRows[0] ?? []).slice(0, 12);
  const normalizedHeaders = (table.rows[0] ?? []).slice(0, 12);
  const rawRows = table.rawRows.slice(0, 10).map((row) => row.slice(0, 12));
  const normalizedRows = table.rows.slice(0, 10).map((row) => row.slice(0, 12));
  return {
    index: table.index,
    caption: table.caption,
    sourceGroup: sourceGroupForTable(table, parserGroup),
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
  if (kind === 'equitySuggestion') return 'حقوق صاحبان سهام';
  if (kind === 'totalSharesSuggestion') return 'تعداد کل سهام';
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
        scaledValue: numericRow.value! * unitInfo.multiplier,
        rawText: numericRow.rawText,
        rawValue: numericRow.value,
        period: context.isCurrentPeriod ? reportPeriod : undefined,
        periodLabel: context.periodLabel,
        unit: unitInfo.unit,
        unitMultiplier: unitInfo.multiplier,
        confidence: tableScope === 'unlisted' && confidence === 'high' ? 'medium' : confidence,
        sourceTableIndex: table.index,
        sourceRowIndex: numericRow.rowIndex,
        sourceColumnIndex: columnIndex,
        sourceTableCaption: table.caption,
        rowLabel: rowLabel(numericRow.row),
        columnLabel: context.measureLabel ?? table.rows.slice(0, 6).map((row) => row[columnIndex]).filter(Boolean).join(' / '),
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
          reason: value.reason?.replace(/\((high|medium|low)\)/, '(low)'),
          warning: value.warning ?? 'چند کاندید برای این نوع مقدار پیدا شد؛ این مقدار نیاز به بررسی دستی دارد.'
        }
      : value
  );
}

function isCompactUserFacingRejection(rejection: CandidateRejection): boolean {
  return rejection.reason.includes('دوره قبلی') || rejection.reason.includes('دوره قبل');
}

function adjustedSourceStrategyForParser(
  detail: CodalReportDetail,
  primaryValues: ExtractedPortfolioValue[],
  secondaryValues: ExtractedPortfolioValue[],
  splitWarnings: string[]
): CodalReportDetail['sourceStrategy'] {
  const strategy = detail.sourceStrategy;
  if (!strategy) return undefined;

  const hasPrimaryMarket = primaryValues.some((value) => value.kind === 'listedPortfolioMarketValue');
  const hasSecondaryMarket = secondaryValues.some((value) => value.kind === 'listedPortfolioMarketValue');
  const marketAmbiguous = hasSecondaryMarket || splitWarnings.some((warning) => warning.includes('چند مقدار محتمل'));
  const marketValueStatus: NonNullable<CodalReportDetail['sourceStrategy']>['marketValueStatus'] = hasPrimaryMarket
    ? 'found'
    : marketAmbiguous
      ? 'ambiguous'
      : strategy.excel.status === 'fetched' || strategy.marketValueStatus === 'not-found'
        ? 'not-found'
        : 'unavailable';
  const messages = strategy.messages.filter((message) => {
    if (marketValueStatus === 'ambiguous') {
      return !message.includes('پیدا نشد') && !message.includes('پیدا شد.');
    }
    if (marketValueStatus === 'found') {
      return !message.includes('پیدا نشد');
    }
    return true;
  });

  if (marketValueStatus === 'ambiguous') {
    messages.push('ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.');
  }

  return {
    ...strategy,
    marketValueStatus,
    messages: [...new Set(messages)]
  };
}

function confidenceRank(confidence: ParseConfidence): number {
  if (confidence === 'high') return 100;
  if (confidence === 'medium') return 65;
  return 25;
}

function exactTotalLabel(label: string | undefined): boolean {
  const normalized = normalizeText(label ?? '');
  return normalized === 'جمع' || normalized === 'جمع کل' || normalized === 'مجموع';
}

function tableForValue(tables: ParsedTable[], value: ExtractedPortfolioValue): ParsedTable | undefined {
  return tables.find((table) => table.index === value.sourceTableIndex);
}

function scoreExtractedValue(value: ExtractedPortfolioValue, tables: ParsedTable[]): number {
  const table = tableForValue(tables, value);
  const text = table ? tableText(table) : '';
  let score = confidenceRank(value.confidence);

  if (value.kind === 'listedPortfolioCostValue' && table?.source !== 'codal-excel') score += 35;
  if (value.kind === 'listedPortfolioMarketValue' && table?.source === 'codal-excel') score += 10;
  if (value.kind.startsWith('unlistedPortfolio')) score += 20;
  if (value.kind === 'equitySuggestion') score += hasAny(text, labelPatterns.equitySuggestion) ? 35 : 0;
  if (value.kind === 'totalSharesSuggestion') score += hasAny(text, labelPatterns.totalSharesSuggestion) ? 30 : 0;
  if (table?.reconstruction) score += 20;
  if (hasAny(text, listedSignals)) score += 20;
  if (/پذیرفته\s*شده|بورسی|بازار\s*سرمایه|صورت\s*وضعیت\s*پرتفوی|پورتفوی/.test(text)) score += 15;
  if (value.kind === 'equitySuggestion' && hasAny(text, financialStatementSignals)) score += 25;
  if (exactTotalLabel(value.rowLabel)) score += 25;
  if (value.period) score += 12;
  if (value.unit === 'نامشخص') score -= 20;
  if ((value.unitMultiplier ?? 1) > 1) score -= 8;
  if ((value.rawValue ?? value.value) === 0) score -= 140;
  if (value.value < 0 || (value.rawValue ?? 0) < 0) score -= 160;
  if (Math.abs(value.rawValue ?? value.value) > 0 && Math.abs(value.rawValue ?? value.value) < 10) score -= 80;
  if (!value.rowLabel || !value.columnLabel) score -= 20;

  return score;
}

function qualityRejectionReason(value: ExtractedPortfolioValue, tables: ParsedTable[]): string | undefined {
  const raw = value.rawValue ?? value.value;
  const table = tableForValue(tables, value);
  if (raw === 0) return 'کاندید صفر از فهرست اصلی حذف شد.';
  if (raw < 0 || value.value < 0) return 'کاندید منفی از فهرست اصلی حذف شد.';
  if (Math.abs(raw) > 0 && Math.abs(raw) < 10 && (table?.source === 'codal-excel' || (value.unitMultiplier ?? 1) === 1)) {
    return 'کاندید بسیار کوچک از فهرست اصلی حذف شد.';
  }
  return undefined;
}

function splitPrimarySuggestions(
  values: ExtractedPortfolioValue[],
  tables: ParsedTable[]
): {
  primary: ExtractedPortfolioValue[];
  secondary: ExtractedPortfolioValue[];
  rejections: ParserRejectedCandidate[];
  warnings: string[];
} {
  const primary: ExtractedPortfolioValue[] = [];
  const secondary: ExtractedPortfolioValue[] = [];
  const rejections: ParserRejectedCandidate[] = [];
  const warnings: string[] = [];
  const byKind = new Map<PortfolioValueKind, ExtractedPortfolioValue[]>();

  for (const value of values) {
    const scored = {
      ...value,
      rankingScore: scoreExtractedValue(value, tables)
    };
    const list = byKind.get(scored.kind) ?? [];
    list.push(scored);
    byKind.set(scored.kind, list);
  }

  for (const [kind, candidates] of byKind.entries()) {
    const ranked = [...candidates].sort((left, right) => (right.rankingScore ?? 0) - (left.rankingScore ?? 0));
    const usable = ranked.filter((candidate) => !qualityRejectionReason(candidate, tables) && (candidate.rankingScore ?? 0) >= 55);
    const rejected = ranked.filter((candidate) => !usable.includes(candidate));
    secondary.push(...rejected);
    rejections.push(
      ...rejected.map((candidate) => ({
        tableIndex: candidate.sourceTableIndex,
        candidate,
        reason: qualityRejectionReason(candidate, tables) ?? 'کاندید به دلیل رتبه پایین فقط در تشخیص Parser نگهداری شد.'
      }))
    );

    if (usable.length === 0) {
      if (kind === 'listedPortfolioMarketValue' && ranked.length > 1) {
        warnings.push('چند کاندید کم‌اطمینان برای ارزش روز پیدا شد؛ جزئیات را بررسی کنید.');
      }
      continue;
    }

    const [best, second] = usable;
    if (kind === 'listedPortfolioMarketValue' && second && (best.rankingScore ?? 0) - (second.rankingScore ?? 0) < 20) {
      secondary.push(...usable);
      rejections.push(
        ...usable.map((candidate) => ({
          tableIndex: candidate.sourceTableIndex,
          candidate,
          reason: 'ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.'
        }))
      );
      warnings.push('ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.');
      continue;
    }

    primary.push({
      ...best,
      reason: `${best.reason ?? ''}${best.rankingScore !== undefined ? `؛ امتیاز رتبه‌بندی: ${best.rankingScore}` : ''}`.trim()
    });
    secondary.push(...usable.slice(1));
  }

  return { primary, secondary, rejections, warnings };
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

function tableDiagnostics(table: ParsedTable, parserGroup: 'monthly' | 'financial' = 'monthly'): ParserTableDiagnostics {
  const text = tableText(table);
  const unitInfo = unitInfoForTable(table);
  const rawHeaders = table.rawRows[0] ?? [];
  const normalizedHeaders = table.rows[0] ?? [];

  return {
    tableIndex: table.index,
    caption: table.caption,
    sourceGroup: sourceGroupForTable(table, parserGroup),
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
  extraRejectedCandidates?: ParserRejectedCandidate[];
  parserGroup?: 'monthly' | 'financial';
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
    rejectedCandidates: [
      ...rejectedCandidatesForDiagnostics(options.tables, options.extractedValues, options.warnings),
      ...(options.extraRejectedCandidates ?? [])
    ],
    tables: options.tables.map((table) => tableDiagnostics(table, options.parserGroup ?? 'monthly'))
  };
}

function allTablesFromDetail(detail: CodalReportDetail): ParsedTable[] {
  return [
    ...tablesFromExtractedTables(detail.extractedTables),
    ...(detail.extractedTables?.length ? [] : detail.rawHtml ? tablesFromHtml(detail.rawHtml) : []),
    ...(detail.extractedTables?.length ? [] : detail.rawJson ? tablesFromJson(detail.rawJson) : [])
  ];
}

function financialStatementValidity(detail: CodalReportDetail): string | undefined {
  const title = normalizeText(detail.title ?? '');
  const selection = detail.selectionDiagnostics;
  const selectedCandidate = selection?.candidates.find((candidate) => candidate.selected);
  if (!isFinancialStatementReport(title) || !hasAny(title, financialStatementSignals) || hasAny(title, invalidFinancialStatementSignals)) {
    return 'حقوق صاحبان سهام از کدال قابل استخراج نبود؛ صورت مالی معتبر برای ناشر پیدا نشد.';
  }
  if (
    selection &&
    (selection.selectedConfidence === 'low' ||
      selection.selectedConfidence === 'none' ||
      (selectedCandidate?.score !== undefined && selectedCandidate.score < 50) ||
      selection.selectedWarnings.length > 0 ||
      (selectedCandidate?.rejectedReasons.length ?? 0) > 0)
  ) {
    return 'حقوق صاحبان سهام از کدال قابل استخراج نبود؛ صورت مالی معتبر برای ناشر پیدا نشد.';
  }
  return undefined;
}

function isConsolidatedFinancialStatement(detail: CodalReportDetail): boolean {
  return /تلفیقی/.test(normalizeText(`${detail.title ?? ''} ${detail.plainTextPreview ?? ''}`));
}

function rowMatchesAny(row: string[], patterns: RegExp[]): boolean {
  return row.some((cell) => hasAny(normalizeText(cell), patterns));
}

function normalizeEquityLabel(value: string | undefined): string {
  return normalizeText(value ?? '')
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrongEquityTotalRow(row: string[]): boolean {
  const label = normalizeEquityLabel(rowLabel(row));
  const compact = label.replace(/\s+/g, '');
  const strong =
    compact === 'جمعحقوقمالکانه' ||
    compact === 'جمعحقوقصاحبانسهام' ||
    compact === 'جمعحقوقصاحبانسهامشرکتاصلی' ||
    compact === 'جمعحقوقصاحبانسهاماصلی' ||
    compact === 'حقوقمالکانه' ||
    compact === 'حقوقصاحبانسهام';
  if (!strong) {
    return false;
  }

  const componentSignals = [
    /انتقال\s*از\s*سایر\s*اقلام/,
    /سود\s*\(?زیان\)?\s*انباشته/,
    /صرف\s*\(?کسر\)?\s*سهام/,
    /کسر\s*سهام\s*خزانه/,
    /اندوخته/,
    /^سرمایه$/
  ];
  return !componentSignals.some((pattern) => pattern.test(label));
}

function bestNumericCellInRow(
  table: ParsedTable,
  row: string[],
  reportPeriod?: string
): { columnIndex: number; rawText: string; rawValue: number; context: ColumnContext } | undefined {
  const numericCells = row
    .map((cell, columnIndex) => ({
      columnIndex,
      rawText: cell,
      rawValue: parseCandidateNumber(cell),
      context: columnContextFor(table.rows, columnIndex, reportPeriod)
    }))
    .filter((candidate): candidate is { columnIndex: number; rawText: string; rawValue: number; context: ColumnContext } => {
      if (candidate.rawValue === undefined || candidate.context.isPriorPeriod) return false;
      return Math.abs(candidate.rawValue) > 0;
    })
    .sort((left, right) => rankColumnContext(right.context) - rankColumnContext(left.context));

  return numericCells[0];
}

function extractStandaloneFinancialValue(options: {
  detail: CodalReportDetail;
  table: ParsedTable;
  kind: 'equitySuggestion' | 'totalSharesSuggestion';
  rowPatterns: RegExp[];
  reportPeriod?: string;
  unitInfo: UnitInfo;
  warning?: string;
}): ExtractedPortfolioValue[] {
  const extracted: ExtractedPortfolioValue[] = [];
  const consolidated = isConsolidatedFinancialStatement(options.detail);
  const rows = options.table.rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => rowMatchesAny(row, options.rowPatterns));

  for (const { row, rowIndex } of rows) {
    if (options.kind === 'totalSharesSuggestion' && rowMatchesAny(row, totalSharesRejectSignals)) {
      continue;
    }
    if (options.kind === 'equitySuggestion' && !isStrongEquityTotalRow(row)) {
      continue;
    }

    const numeric = bestNumericCellInRow(options.table, row, options.reportPeriod);
    if (!numeric) continue;

    const multiplier = options.kind === 'totalSharesSuggestion' ? 1 : options.unitInfo.multiplier;
    const confidence: ParseConfidence =
      options.kind === 'equitySuggestion'
        ? consolidated
          ? 'low'
          : !options.unitInfo.clear
          ? 'medium'
          : 'high'
        : 'medium';
    const consolidatedWarning =
      options.kind === 'equitySuggestion' && consolidated
        ? 'این مقدار از صورت مالی تلفیقی استخراج شده و نیازمند بررسی دستی است.'
        : undefined;
    extracted.push({
      kind: options.kind,
      label: valueLabel(options.kind),
      value: numeric.rawValue * multiplier,
      scaledValue: numeric.rawValue * multiplier,
      rawText: numeric.rawText,
      rawValue: numeric.rawValue,
      period: numeric.context.isCurrentPeriod ? options.reportPeriod : undefined,
      periodLabel: numeric.context.periodLabel,
      unit: options.kind === 'totalSharesSuggestion' ? 'سهم' : options.unitInfo.unit,
      unitMultiplier: multiplier,
      confidence,
      sourceTableIndex: options.table.index,
      sourceRowIndex: rowIndex,
      sourceColumnIndex: numeric.columnIndex,
      sourceTableCaption: options.table.caption,
      rowLabel: rowLabel(row),
      columnLabel:
        numeric.context.measureLabel ??
        options.table.rows
          .slice(0, 6)
          .map((headerRow) => headerRow[numeric.columnIndex])
          .filter(Boolean)
          .join(' / '),
      reason: `جدول ${options.table.index}، ردیف ${rowIndex + 1}، ستون ${numeric.columnIndex + 1} (${confidence})`,
      warning: consolidatedWarning ?? options.warning ?? (!options.unitInfo.clear && options.kind === 'equitySuggestion' ? options.unitInfo.warning : undefined)
    });
  }

  return extracted;
}

export function parseFinancialStatementReport(detail: CodalReportDetail): MonthlyActivityParseResult {
  const parsedAt = new Date().toISOString();
  const reportPeriod = extractReportPeriod(detail);
  const invalidReason = financialStatementValidity(detail);
  const tables = invalidReason ? [] : allTablesFromDetail(detail);
  const tablePreviews = tables.map((table) => tablePreview(table, 'financial'));

  if (invalidReason) {
    const status: MonthlyActivityParseResult['status'] = 'unsupported-report';
    return {
      status,
      reportTitle: detail.title,
      reportPeriod,
      sourceReportUrl: detail.sourceUrl,
      tableCandidates: [],
      extractedValues: [],
      primarySuggestions: [],
      secondarySuggestions: [],
      tablePreviews: [],
      diagnostics: buildDiagnostics({ detail, status, tables: [], warnings: [invalidReason], extractedValues: [], parserGroup: 'financial' }),
      warnings: [invalidReason],
      parsedAt
    };
  }

  if (tables.length === 0) {
    const status: MonthlyActivityParseResult['status'] = 'empty';
    const warnings = ['حقوق صاحبان سهام از کدال قابل استخراج نبود؛ جدول قابل بررسی در صورت مالی پیدا نشد.'];
    return {
      status,
      reportTitle: detail.title,
      reportPeriod,
      sourceReportUrl: detail.sourceUrl,
      tableCandidates: [],
      extractedValues: [],
      primarySuggestions: [],
      secondarySuggestions: [],
      tablePreviews,
      diagnostics: buildDiagnostics({ detail, status, tables, warnings, extractedValues: [], parserGroup: 'financial' }),
      warnings,
      parsedAt
    };
  }

  const extractedValues = tables.flatMap((table) => {
    const unitInfo = unitInfoForTable(table);
    return [
      ...extractStandaloneFinancialValue({
        detail,
        table,
        kind: 'equitySuggestion',
        rowPatterns: labelPatterns.equitySuggestion,
        reportPeriod,
        unitInfo
      }),
      ...extractStandaloneFinancialValue({
        detail,
        table,
        kind: 'totalSharesSuggestion',
        rowPatterns: labelPatterns.totalSharesSuggestion,
        reportPeriod,
        unitInfo: { unit: 'ریال', multiplier: 1, clear: true }
      })
    ];
  });
  const split = splitPrimarySuggestions(downgradeDuplicateKinds(extractedValues), tables);
  const warnings = [...split.warnings];
  if (!split.primary.some((value) => value.kind === 'equitySuggestion')) {
    warnings.push('حقوق صاحبان سهام از کدال قابل استخراج نبود؛ ردیف جمع حقوق صاحبان سهام پیدا نشد.');
  }
  if (!split.primary.some((value) => value.kind === 'totalSharesSuggestion')) {
    warnings.push('تعداد کل سهام از کدال قابل استخراج نبود؛ فقط در صورت وجود برچسب صریح پیشنهاد می‌شود.');
  }

  const status: MonthlyActivityParseResult['status'] = split.primary.length > 0 ? 'parsed' : 'ambiguous';
  const candidates: PortfolioTableCandidate[] = tables
    .filter((table) => hasAny(tableText(table), [...labelPatterns.equitySuggestion, ...labelPatterns.totalSharesSuggestion]))
    .map((table) => ({
      index: table.index,
      caption: table.caption,
      rowCount: table.rows.length,
      columnCount: table.rows.reduce((max, row) => Math.max(max, row.length), 0),
      matchedLabels: matchedLabels(tableText(table)),
      confidence: 'medium'
    }));

  return {
    status,
    reportTitle: detail.title,
    reportPeriod,
    sourceReportUrl: detail.sourceUrl,
    tableCandidates: candidates,
    extractedValues: split.primary,
    primarySuggestions: split.primary,
    secondarySuggestions: split.secondary,
    tablePreviews,
    diagnostics: buildDiagnostics({
      detail,
      status,
      tables,
      warnings,
      extractedValues,
      extraRejectedCandidates: split.rejections,
      parserGroup: 'financial'
    }),
    warnings,
    parsedAt
  };
}

export function mergeMonthlyActivityParseResults(results: MonthlyActivityParseResult[]): MonthlyActivityParseResult {
  const available = results.filter(Boolean);
  const base = available[0];
  if (!base) {
    const parsedAt = new Date().toISOString();
    return {
      status: 'empty',
      tableCandidates: [],
      extractedValues: [],
      primarySuggestions: [],
      secondarySuggestions: [],
      tablePreviews: [],
      diagnostics: {
        detectedTableCount: 0,
        parserStatus: 'empty',
        parserWarnings: [],
        extractedCandidates: [],
        rejectedCandidates: [],
        tables: []
      },
      warnings: [],
      parsedAt
    };
  }

  const extractedValues = available.flatMap((result) => result.extractedValues);
  const secondarySuggestions = available.flatMap((result) => result.secondarySuggestions);
  const warnings = [...new Set(available.flatMap((result) => result.warnings))];
  const diagnostics: MonthlyActivityParserDiagnostics = {
    ...base.diagnostics,
    detectedTableCount: available.reduce((sum, result) => sum + result.diagnostics.detectedTableCount, 0),
    parserStatus: extractedValues.length > 0 ? (warnings.length ? 'ambiguous' : 'parsed') : 'ambiguous',
    parserWarnings: warnings,
    extractedCandidates: available.flatMap((result) => result.diagnostics.extractedCandidates),
    rejectedCandidates: available.flatMap((result) => result.diagnostics.rejectedCandidates),
    tables: available.flatMap((result) => result.diagnostics.tables)
  };

  return {
    ...base,
    status: diagnostics.parserStatus,
    reportTitle: available.map((result) => result.reportTitle).filter(Boolean).join(' + ') || base.reportTitle,
    tableCandidates: available.flatMap((result) => result.tableCandidates),
    extractedValues,
    primarySuggestions: extractedValues,
    secondarySuggestions,
    tablePreviews: available.flatMap((result) => result.tablePreviews),
    diagnostics,
    warnings,
    parsedAt: new Date().toISOString()
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
      primarySuggestions: [],
      secondarySuggestions: [],
      tablePreviews: [],
      diagnostics: buildDiagnostics({ detail, status, tables: [], warnings: resultWarnings, extractedValues: [] }),
      warnings: resultWarnings,
      parsedAt
    };
  }

  const tables = allTablesFromDetail(detail);
  const tablePreviews = tables.map((table) => tablePreview(table, 'monthly'));

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
      primarySuggestions: [],
      secondarySuggestions: [],
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
      primarySuggestions: [],
      secondarySuggestions: [],
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
    const isUnlisted = hasAny(text, unlistedSignals);
    const isListed = !isUnlisted && (hasAny(text, listedSignals) || isReconstructedSummaryInvestmentTable(table));
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
          scaledValue: estimated.value - cost.value,
          rawText: `${estimated.rawText} - ${cost.rawText}`,
          rawValue: estimated.value - cost.value,
          confidence: 'low',
          unit: estimated.unit,
          unitMultiplier: estimated.unitMultiplier,
          sourceTableIndex: table.index,
          sourceRowIndex: estimated.sourceRowIndex,
          sourceColumnIndex: estimated.sourceColumnIndex,
          sourceTableCaption: table.caption,
          rowLabel: estimated.rowLabel,
          columnLabel: `${estimated.columnLabel ?? ''} - ${cost.columnLabel ?? ''}`.trim(),
          reason: `اختلاف ارزش برآوردی و بهای تمام شده از جدول ${table.index}`,
          warning: 'این مقدار از اختلاف ارزش برآوردی و بهای تمام شده ساخته شده و باید دستی بررسی شود.'
        });
      }
    }
  }

  const allExtractedValues = downgradeDuplicateKinds(extractedValues);
  const split = splitPrimarySuggestions(allExtractedValues, tables);
  const safeExtractedValues = split.primary;
  const duplicateKinds = allExtractedValues
    .map((value) => value.kind)
    .filter((kind, index, all) => all.indexOf(kind) !== index);
  warnings.push(...rejectedCandidateWarnings.filter(isCompactUserFacingRejection).map((rejection) => rejection.reason));
  warnings.push(...split.warnings);
  warnings.push(...partialExtractionWarnings(candidates, tables, safeExtractedValues));
  if (!safeExtractedValues.some((value) => value.kind === 'listedPortfolioMarketValue')) {
    const excelStatus = detail.sourceStrategy?.excel.status;
    const hasSecondaryMarket = split.secondary.some((value) => value.kind === 'listedPortfolioMarketValue');
    if (excelStatus === 'fetched') {
      if (!hasSecondaryMarket) {
        warnings.push('ارزش روز پرتفوی بورسی در Excel گزارش نیز پیدا نشد.');
      }
    } else if (excelStatus === 'unavailable') {
      warnings.push('ExcelUrl برای بررسی ارزش روز پرتفوی بورسی در متادیتای گزارش وجود نداشت.');
    } else if (excelStatus) {
      warnings.push(`بررسی ExcelUrl برای ارزش روز پرتفوی بورسی ناموفق بود: ${detail.sourceStrategy?.excel.errorMessage ?? excelStatus}`);
    }
  }
  if (duplicateKinds.length > 0 && split.warnings.length === 0) {
    warnings.push('چند کاندید برای یک نوع داده پیدا شد؛ نتیجه نیاز به بررسی دستی دارد.');
  }

  if (safeExtractedValues.length === 0) {
    warnings.push(...extractionFailureWarnings(candidates, tables));
    warnings.push('جدول مرتبط پیدا شد، اما مقدار عددی قابل اتکا استخراج نشد. پیش‌نمایش جدول‌ها را برای برچسب‌ها و ردیف‌های جمع بررسی کنید.');
  }

  const status: MonthlyActivityParseResult['status'] =
    split.warnings.length > 0 ? 'ambiguous' : safeExtractedValues.length > 0 ? 'parsed' : 'ambiguous';
  const diagnosticsDetail: CodalReportDetail = {
    ...detail,
    sourceStrategy: adjustedSourceStrategyForParser(detail, safeExtractedValues, split.secondary, split.warnings)
  };

  return {
    status,
    reportTitle: detail.title,
    reportPeriod,
    sourceReportUrl: detail.sourceUrl,
    tableCandidates: candidates,
    extractedValues: safeExtractedValues,
    primarySuggestions: safeExtractedValues,
    secondarySuggestions: split.secondary,
    tablePreviews,
    diagnostics: buildDiagnostics({
      detail: diagnosticsDetail,
      status,
      tables,
      warnings,
      extractedValues: allExtractedValues,
      extraRejectedCandidates: [
        ...rejectedCandidateWarnings.map((rejection) => ({
          tableIndex: rejection.tableIndex,
          reason: rejection.reason
        })),
        ...split.rejections
      ]
    }),
    warnings,
    parsedAt
  };
}
