import { normalizePersianArabicDigits } from '../core/number-utils';
import { getLocalValue, setLocalValue } from './cache-store';

export type CodalReportKind = 'monthly-activity' | 'financial-statement' | 'unknown';
export type CodalDiscoveryStatus = 'found' | 'not-found' | 'failed';
export type CodalReportDetailStatus =
  | 'fetched'
  | 'unavailable'
  | 'unsupported-format'
  | 'network-error'
  | 'timeout';

export interface CodalReportReference {
  symbol: string;
  title: string;
  companyName?: string;
  publishedAt?: string;
  tracingNo?: string;
  reportId?: string;
  letterCode?: string;
  url?: string;
  excelUrl?: string;
  raw?: unknown;
  selectionDiagnostics?: CodalReportSelectionDiagnostics;
}

export interface CodalReportSelectionCandidate {
  report: CodalReportReference;
  score: number;
  selected: boolean;
  reasons: string[];
  warnings: string[];
  rejectedReasons: string[];
}

export interface CodalReportSelectionDiagnostics {
  requestedSymbol: string;
  requestedIssuerName?: string;
  reportKind: CodalReportKind;
  selectedReport?: CodalReportReference;
  selectedConfidence: 'high' | 'medium' | 'low' | 'none';
  selectedWarnings: string[];
  candidates: CodalReportSelectionCandidate[];
}

export interface CodalDiscoveryDiagnostics {
  requestedSymbol: string;
  requestedIssuerName?: string;
  monthlyActivity?: CodalReportSelectionDiagnostics;
  financialStatement?: CodalReportSelectionDiagnostics;
}

export interface CodalReportDiscoveryResult {
  status: CodalDiscoveryStatus;
  symbol: string;
  monthlyActivityReport?: CodalReportReference;
  financialStatementReport?: CodalReportReference;
  diagnostics?: CodalDiscoveryDiagnostics;
  errorMessage?: string;
  sourceVerified: false;
  checkedAt: string;
}

export interface CodalTableMetadata {
  index: number;
  rowCount: number;
  columnCount: number;
  headers: string[];
  caption?: string;
  source?: CodalExtractedTable['source'];
  headersPreview?: string[];
  reconstruction?: CodalCellTableReconstructionMetadata;
}

export interface CodalCellTableReconstructionMetadata {
  kind: 'codal-cell-model';
  metaTableCode?: string;
  metaTableId?: string;
  alias?: string;
  rawCellCount: number;
  rowCount: number;
  columnCount: number;
  warnings: string[];
}

export interface CodalExtractedTable {
  index: number;
  source: 'html-table' | 'html-row-structure' | 'script-json' | 'json' | 'codal-cell-model' | 'codal-excel';
  caption?: string;
  headers: string[];
  rows: string[][];
  reconstruction?: CodalCellTableReconstructionMetadata;
}

export interface CodalExcelDiagnostics {
  url?: string;
  status:
    | 'not-requested'
    | 'unavailable'
    | 'fetched'
    | 'unsupported-format'
    | 'network-error'
    | 'timeout'
    | 'cors-blocked'
    | 'excel-unavailable';
  contentType?: string;
  tableCount: number;
  errorCode?: 'cors-blocked' | 'excel-unavailable' | 'network-error' | 'timeout' | 'unsupported-format';
  errorMessage?: string;
  fetchedAt?: string;
}

export interface CodalSourceStrategyDiagnostics {
  htmlDetailChecked: boolean;
  reconstructedTableChecked: boolean;
  excel: CodalExcelDiagnostics;
  alternativeReportsChecked: boolean;
  marketValueStatus: 'found' | 'not-found' | 'not-checked';
  messages: string[];
}

export interface CodalReportDetail {
  sourceUrl: string;
  symbol?: string;
  title?: string;
  publishedAt?: string;
  tracingNo?: string;
  reportId?: string;
  selectionDiagnostics?: CodalReportSelectionDiagnostics;
  contentType: 'html' | 'json' | 'unknown';
  rawHtml?: string;
  rawJson?: unknown;
  excelUrl?: string;
  excelDiagnostics?: CodalExcelDiagnostics;
  sourceStrategy?: CodalSourceStrategyDiagnostics;
  plainTextPreview: string;
  tables: CodalTableMetadata[];
  extractedTables: CodalExtractedTable[];
  parserWarnings: string[];
  fetchedAt: string;
}

export interface CodalReportDetailResult {
  status: CodalReportDetailStatus;
  detail?: CodalReportDetail;
  errorMessage?: string;
}

export interface CodalSearchOptions {
  limit?: number;
  timeoutMs?: number;
  retryLimit?: number;
  cacheTtlMs?: number;
  requestedIssuerName?: string;
  fetchImpl?: typeof fetch;
}

interface CodalCacheRecord {
  createdAt: string;
  reports: CodalReportReference[];
}

interface CodalDetailCacheRecord {
  createdAt: string;
  result: CodalReportDetailResult;
}

const CODAL_SEARCH_ENDPOINT = 'https://search.codal.ir/api/search/v2/q';
const CODAL_ORIGIN = 'https://www.codal.ir';
const DEFAULT_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_LIMIT = 2;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1_000;

const monthlyActivityPatterns = [
  /فعالیت\s*ماهانه/,
  /گزارش\s*فعالیت\s*ماهانه/,
  /صورت\s*وضعیت\s*پرتفوی/,
  /صورت\s*وضعیت\s*پورتفوی/
];
const financialStatementPatterns = [/صورت\s*های\s*مالی/, /صورت‌های\s*مالی/, /صورت\s*مالی/];

function codalCacheKey(symbol: string, kind: CodalReportKind | 'all'): string {
  return `codal-search:${kind}:${symbol}`;
}

function codalDetailCacheKey(key: string): string {
  return `codal-detail:${key}`;
}

async function getCachedReports(
  symbol: string,
  kind: CodalReportKind | 'all',
  cacheTtlMs: number
): Promise<CodalReportReference[] | undefined> {
  const key = codalCacheKey(symbol, kind);
  const record = await getLocalValue<CodalCacheRecord>(key);

  if (!record) {
    return undefined;
  }

  const ageMs = Date.now() - Date.parse(record.createdAt);
  return ageMs >= 0 && ageMs <= cacheTtlMs ? record.reports : undefined;
}

async function setCachedReports(
  symbol: string,
  kind: CodalReportKind | 'all',
  reports: CodalReportReference[]
): Promise<void> {
  await setLocalValue(codalCacheKey(symbol, kind), {
      createdAt: new Date().toISOString(),
      reports
    } satisfies CodalCacheRecord);
}

async function getCachedDetail(
  key: string,
  cacheTtlMs: number
): Promise<CodalReportDetailResult | undefined> {
  const record = await getLocalValue<CodalDetailCacheRecord>(codalDetailCacheKey(key));
  if (!record) {
    return undefined;
  }

  const ageMs = Date.now() - Date.parse(record.createdAt);
  return ageMs >= 0 && ageMs <= cacheTtlMs ? record.result : undefined;
}

async function setCachedDetail(key: string, result: CodalReportDetailResult): Promise<void> {
  await setLocalValue(codalDetailCacheKey(key), {
    createdAt: new Date().toISOString(),
    result
  } satisfies CodalDetailCacheRecord);
}

function buildSearchUrl(symbol: string, limit: number): string {
  const url = new URL(CODAL_SEARCH_ENDPOINT);
  void limit;
  url.searchParams.set('search', 'true');
  url.searchParams.set('Symbol', symbol);
  url.searchParams.set('PageNumber', '1');
  // Codal's Length parameter is a period-length filter, not a page-size limit.
  // -1 keeps discovery broad while still requesting only the first result page.
  url.searchParams.set('Length', '-1');
  url.searchParams.set('LetterType', '-1');
  url.searchParams.set('Category', '-1');
  url.searchParams.set('CompanyType', '-1');
  return url.toString();
}

function codalSymbolVariants(symbol: string): string[] {
  const normalized = normalizePersianArabicDigits(symbol).trim();
  const variants = [
    normalized,
    normalized.replace(/ی/g, 'ي').replace(/ک/g, 'ك'),
    normalized.replace(/ي/g, 'ی').replace(/ك/g, 'ک')
  ];

  return [...new Set(variants.filter(Boolean))];
}

function absoluteCodalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  try {
    return new URL(value, CODAL_ORIGIN).toString();
  } catch {
    return undefined;
  }
}

function reportUrlFromTracingNo(tracingNo: string): string {
  const url = new URL('/Reports/Decision.aspx', CODAL_ORIGIN);
  url.searchParams.set('LetterSerial', tracingNo);
  return url.toString();
}

function reportUrlFromReference(report: CodalReportReference): string | undefined {
  return report.url ?? (report.reportId ? reportUrlFromTracingNo(report.reportId) : undefined) ??
    (report.tracingNo ? reportUrlFromTracingNo(report.tracingNo) : undefined);
}

function getString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }

  return undefined;
}

function normalizeReport(raw: unknown, fallbackSymbol: string): CodalReportReference | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const title = getString(record, ['Title', 'title', 'LetterTitle', 'letterTitle']);
  if (!title) {
    return undefined;
  }

  return {
    symbol: getString(record, ['Symbol', 'symbol']) ?? fallbackSymbol,
    title,
    companyName: getString(record, ['CompanyName', 'companyName', 'Name', 'name']),
    publishedAt: getString(record, ['PublishDateTime', 'publishDateTime', 'PublishDate', 'SentDateTime']),
    tracingNo: getString(record, ['TracingNo', 'tracingNo']),
    reportId: getString(record, ['LetterSerial', 'letterSerial', 'ReportId', 'reportId', 'Id', 'id']),
    letterCode: getString(record, ['LetterCode', 'letterCode']),
    url: absoluteCodalUrl(getString(record, ['Url', 'url', 'ReportUrl', 'reportUrl', 'Link', 'link'])),
    excelUrl: absoluteCodalUrl(getString(record, ['ExcelUrl', 'excelUrl', 'ExcelURL', 'excelURL', 'ExportUrl', 'exportUrl'])),
    raw
  };
}

function extractReports(payload: unknown, symbol: string): CodalReportReference[] {
  const candidates =
    payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).Letters ??
        (payload as Record<string, unknown>).letters ??
        (payload as Record<string, unknown>).Data ??
        (payload as Record<string, unknown>).data ??
        payload)
      : payload;

  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates
    .map((item) => normalizeReport(item, symbol))
    .filter((item): item is CodalReportReference => Boolean(item));
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Codal search request failed with HTTP ${response.status}.`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Codal search request timed out after ${timeoutMs} ms.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchTextOrJsonWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<{ contentType: string; body: string | unknown }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Codal report detail request failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers?.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return { contentType, body: await response.json() };
    }

    return { contentType, body: await response.text() };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Codal report detail request timed out after ${timeoutMs} ms.`, {
        cause: error
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithRetry(
  url: string,
  options: Required<Pick<CodalSearchOptions, 'timeoutMs' | 'retryLimit' | 'fetchImpl'>>
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retryLimit; attempt += 1) {
    try {
      return await fetchJsonWithTimeout(url, options.timeoutMs, options.fetchImpl);
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Unknown Codal search error.';
  throw new Error(`Codal search failed after ${options.retryLimit + 1} attempt(s): ${message}`, {
    cause: lastError
  });
}

function sortReportsNewestFirst(reports: CodalReportReference[]): CodalReportReference[] {
  return [...reports].sort((a, b) => {
    const left = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const right = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return right - left;
  });
}

function normalizeIssuerText(value: string | undefined): string {
  return normalizePersianArabicDigits(value ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/[()（）[\]{}«»"']/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactIssuerText(value: string | undefined): string {
  return normalizeIssuerText(value).replace(/\s+/g, '');
}

function normalizedSymbol(value: string | undefined): string {
  return compactIssuerText(value);
}

function issuerStronglyMatches(report: CodalReportReference, requestedIssuerName: string | undefined): boolean {
  const requested = compactIssuerText(requestedIssuerName);
  if (!requested) {
    return false;
  }

  const company = compactIssuerText(report.companyName);
  const title = compactIssuerText(report.title);
  return Boolean(
    (company && (company.includes(requested) || requested.includes(company))) ||
      (title && (title.includes(requested) || requested.includes(title)))
  );
}

function titleParentheticalSegments(title: string): string[] {
  return Array.from(title.matchAll(/[([]([^()[\]]+)[)\]]/g)).map((match) => normalizeIssuerText(match[1]));
}

function publishTime(report: CodalReportReference): number {
  const parsed = report.publishedAt ? Date.parse(normalizePersianArabicDigits(report.publishedAt)) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportKindPatterns(kind: CodalReportKind): RegExp[] {
  if (kind === 'monthly-activity') {
    return monthlyActivityPatterns;
  }
  if (kind === 'financial-statement') {
    return financialStatementPatterns;
  }
  return [];
}

function scoreReportCandidate(options: {
  report: CodalReportReference;
  requestedSymbol: string;
  requestedIssuerName?: string;
  kind: CodalReportKind;
}): Omit<CodalReportSelectionCandidate, 'selected'> {
  const { report, requestedSymbol, requestedIssuerName, kind } = options;
  const requestedSymbolNormalized = normalizedSymbol(requestedSymbol);
  const reportSymbolNormalized = normalizedSymbol(report.symbol);
  const title = normalizeIssuerText(report.title);
  const company = normalizeIssuerText(report.companyName);
  const parentheticals = titleParentheticalSegments(report.title);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const rejectedReasons: string[] = [];
  let score = 0;

  if (reportSymbolNormalized === requestedSymbolNormalized) {
    score += 80;
    reasons.push('نماد گزارش دقیقاً با نماد درخواست‌شده تطبیق دارد.');
  } else if (reportSymbolNormalized) {
    score -= 160;
    rejectedReasons.push('نماد گزارش با نماد درخواست‌شده تطبیق ندارد.');
  } else {
    score -= 35;
    warnings.push('نماد گزارش در متادیتای کدال موجود نیست.');
  }

  if (requestedIssuerName) {
    if (issuerStronglyMatches(report, requestedIssuerName)) {
      score += 35;
      reasons.push('نام ناشر/شرکت با ناشر درخواست‌شده تطبیق قوی دارد.');
    } else if (company) {
      score -= 45;
      warnings.push('نام شرکت گزارش با ناشر تشخیص‌داده‌شده از TSETMC تطبیق قوی ندارد.');
    } else {
      score -= 15;
      warnings.push('نام شرکت گزارش برای تطبیق ناشر موجود نیست.');
    }
  }

  if (titleMatches(report.title, reportKindPatterns(kind))) {
    score += kind === 'monthly-activity' ? 35 : 30;
    reasons.push('عنوان گزارش با نوع گزارش مورد انتظار تطبیق دارد.');
  } else {
    score -= 120;
    rejectedReasons.push('عنوان گزارش با نوع گزارش مورد انتظار تطبیق ندارد.');
  }

  if (kind === 'monthly-activity' && /دوره\s*1\s*ماهه|دوره\s*یک\s*ماهه|1\s*ماهه/.test(title)) {
    score += 12;
    reasons.push('گزارش ماهانه دوره 1 ماهه است.');
  }

  for (const segment of parentheticals) {
    const compactSegment = compactIssuerText(segment);
    const requestedIssuer = compactIssuerText(requestedIssuerName);
    const segmentMatchesRequested =
      requestedIssuer && (compactSegment.includes(requestedIssuer) || requestedIssuer.includes(compactSegment));
    const segmentMentionsDifferentCompany =
      compactSegment.length > 5 &&
      !segmentMatchesRequested &&
      !compactSegment.includes(requestedSymbolNormalized) &&
      /(شرکت|صنعتی|بازرگانی|تولیدی|سرمایهگذاری|هلدینگ)/.test(compactSegment);
    if (segmentMentionsDifferentCompany) {
      score -= 70;
      warnings.push('عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند.');
    }
  }

  if (/شفاف\s*سازی|شفاف‌سازی|اطلاعیه|توضیحات/.test(title)) {
    score -= kind === 'financial-statement' ? 55 : 65;
    warnings.push('عنوان گزارش شبیه اطلاعیه/شفاف‌سازی است و منبع اصلی مالی محسوب نمی‌شود.');
  }

  score += Math.min(20, Math.max(0, publishTime(report) / 86_400_000_000));

  return {
    report,
    score,
    reasons,
    warnings,
    rejectedReasons
  };
}

function selectedConfidence(score: number, warnings: string[]): CodalReportSelectionDiagnostics['selectedConfidence'] {
  if (warnings.some((warning) => warning.includes('شفاف‌سازی') || warning.includes('اطلاعیه'))) return 'low';
  if (score >= 120 && warnings.length === 0) return 'high';
  if (score >= 90) return 'medium';
  if (score >= 70) return 'low';
  return 'none';
}

function selectReportByRank(
  reports: CodalReportReference[],
  requestedSymbol: string,
  kind: CodalReportKind,
  requestedIssuerName?: string
): CodalReportSelectionDiagnostics {
  const scored = reports
    .map((report) => scoreReportCandidate({ report, requestedSymbol, requestedIssuerName, kind }))
    .sort((left, right) => right.score - left.score || publishTime(right.report) - publishTime(left.report));
  const selected = scored.find((candidate) => candidate.rejectedReasons.length === 0 && candidate.score >= 70);
  const confidence = selected ? selectedConfidence(selected.score, selected.warnings) : 'none';
  const diagnostics: CodalReportSelectionDiagnostics = {
    requestedSymbol,
    requestedIssuerName,
    reportKind: kind,
    selectedReport: selected && confidence !== 'none' ? { ...selected.report, selectionDiagnostics: undefined } : undefined,
    selectedConfidence: confidence,
    selectedWarnings: selected?.warnings ?? [],
    candidates: scored.map((candidate) => ({
      ...candidate,
      selected: candidate === selected && confidence !== 'none'
    }))
  };

  return diagnostics;
}

function reportFromSelectionDiagnostics(
  diagnostics: CodalReportSelectionDiagnostics
): CodalReportReference | undefined {
  return diagnostics.selectedReport
    ? {
        ...diagnostics.selectedReport,
        selectionDiagnostics: diagnostics
      }
    : undefined;
}

function titleMatches(title: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(title));
}

export function stripUnsafeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
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
  return normalizePersianArabicDigits(decodeHtmlEntities(stripUnsafeHtml(html).replace(/<[^>]+>/g, ' ')))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tableCells(rowHtml: string, tagName: 'th' | 'td'): string[] {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  return Array.from(rowHtml.matchAll(pattern)).map((match) => textFromHtml(match[1]));
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return normalizePersianArabicDigits(String(value))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPrimitiveCell(value: unknown): boolean {
  return ['string', 'number', 'boolean'].includes(typeof value) || value === null;
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  return keys.map((key) => record[key]).find((value) => value !== undefined && value !== null);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  const normalized = normalizeCell(firstDefined(record, keys));
  return normalized || undefined;
}

function numericCoordinate(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const normalized = normalizeCell(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function columnIndexFromAddress(address: string): number | undefined {
  const match = normalizeCell(address).match(/^([A-Z]+)\d+$/i);
  if (!match) {
    return undefined;
  }

  return [...match[1].toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function rowIndexFromAddress(address: string): number | undefined {
  const match = normalizeCell(address).match(/^[A-Z]+(\d+)$/i);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed - 1 : undefined;
}

function isCodalCellModelRecord(record: Record<string, unknown>): boolean {
  return (
    firstDefined(record, ['value', 'Value', 'text', 'Text', 'cellValue', 'CellValue']) !== undefined &&
    firstDefined(record, ['address', 'Address', 'rowSequence', 'RowSequence', 'columnSequence', 'ColumnSequence']) !==
      undefined &&
    firstDefined(record, ['cellGroupName', 'CellGroupName', 'metaTableCode', 'MetaTableCode', 'metaTableId', 'MetaTableId']) !==
      undefined
  );
}

function headerRowFromMatrix(rows: string[][]): string[] {
  return rows.find((row) => row.filter(Boolean).length >= 2) ?? rows[0] ?? [];
}

function captionFromCellGroup(cells: Record<string, unknown>[]): string | undefined {
  const aliases = [
    ...new Set(
      cells
        .map((cell) =>
          firstString(cell, [
            'alias',
            'Alias',
            'title',
            'Title',
            'tableTitle',
            'TableTitle',
            'metaTableTitle',
            'MetaTableTitle',
            'cellGroupName',
            'CellGroupName'
          ])
        )
        .filter((value): value is string => Boolean(value))
    )
  ];
  return aliases.join(' - ') || undefined;
}

export function groupCellsByMetaTableCode(cells: unknown[]): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const cell of cells) {
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) {
      continue;
    }

    const record = cell as Record<string, unknown>;
    if (!isCodalCellModelRecord(record)) {
      continue;
    }

    const metaTableCode = firstString(record, ['metaTableCode', 'MetaTableCode']);
    const metaTableId = firstString(record, ['metaTableId', 'MetaTableId']);
    const key = `${metaTableCode ?? 'unknown-code'}:${metaTableId ?? 'unknown-id'}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return groups;
}

export function reconstructCodalCellTable(
  cells: Record<string, unknown>[],
  index = 0
): CodalExtractedTable | undefined {
  if (cells.length === 0) {
    return undefined;
  }

  const warnings: string[] = [];
  const rowCoordinates = new Map<Record<string, unknown>, number>();
  const columnCoordinates = new Map<Record<string, unknown>, number>();
  const rowValues = new Set<number>();
  const columnValues = new Set<number>();
  let missingCoordinateCount = 0;

  for (const cell of cells) {
    const address = firstString(cell, ['address', 'Address']);
    const row =
      numericCoordinate(firstDefined(cell, ['rowSequence', 'RowSequence', 'row', 'Row', 'rowIndex', 'RowIndex'])) ??
      (address ? rowIndexFromAddress(address) : undefined);
    const column =
      numericCoordinate(
        firstDefined(cell, ['columnSequence', 'ColumnSequence', 'column', 'Column', 'columnIndex', 'ColumnIndex'])
      ) ?? (address ? columnIndexFromAddress(address) : undefined);

    if (row === undefined || column === undefined) {
      missingCoordinateCount += 1;
      continue;
    }

    rowCoordinates.set(cell, row);
    columnCoordinates.set(cell, column);
    rowValues.add(row);
    columnValues.add(column);
  }

  if (rowValues.size === 0 || columnValues.size === 0) {
    return undefined;
  }

  if (missingCoordinateCount > 0) {
    warnings.push(`${missingCoordinateCount} Codal cell(s) were skipped because row/column coordinates were missing.`);
  }

  const sortedRows = [...rowValues].sort((left, right) => left - right);
  const sortedColumns = [...columnValues].sort((left, right) => left - right);
  const rowIndexByCoordinate = new Map(sortedRows.map((coordinate, rowIndex) => [coordinate, rowIndex]));
  const columnIndexByCoordinate = new Map(sortedColumns.map((coordinate, columnIndex) => [coordinate, columnIndex]));
  const matrix = Array.from({ length: sortedRows.length }, () => Array.from({ length: sortedColumns.length }, () => ''));
  const duplicateCoordinates: string[] = [];

  for (const cell of cells) {
    const row = rowCoordinates.get(cell);
    const column = columnCoordinates.get(cell);
    if (row === undefined || column === undefined) {
      continue;
    }

    const rowIndex = rowIndexByCoordinate.get(row);
    const columnIndex = columnIndexByCoordinate.get(column);
    if (rowIndex === undefined || columnIndex === undefined) {
      continue;
    }

    const value = normalizeCell(firstDefined(cell, ['value', 'Value', 'text', 'Text', 'cellValue', 'CellValue']));
    if (matrix[rowIndex][columnIndex] && value) {
      duplicateCoordinates.push(`${row}:${column}`);
      matrix[rowIndex][columnIndex] = `${matrix[rowIndex][columnIndex]} ${value}`.trim();
    } else {
      matrix[rowIndex][columnIndex] = value;
    }
  }

  if (duplicateCoordinates.length > 0) {
    warnings.push(`Duplicate Codal cell coordinate(s) were merged: ${[...new Set(duplicateCoordinates)].join(', ')}.`);
  }

  const rows = matrix.filter((row) => row.some(Boolean));
  if (rows.length === 0) {
    return undefined;
  }

  const firstCell = cells[0] ?? {};
  const metaTableCode = firstString(firstCell, ['metaTableCode', 'MetaTableCode']);
  const metaTableId = firstString(firstCell, ['metaTableId', 'MetaTableId']);
  const alias = captionFromCellGroup(cells);
  const headers = headerRowFromMatrix(rows);
  const reconstruction: CodalCellTableReconstructionMetadata = {
    kind: 'codal-cell-model',
    metaTableCode,
    metaTableId,
    alias,
    rawCellCount: cells.length,
    rowCount: rows.length,
    columnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
    warnings
  };
  const fallbackCaption = [metaTableCode ? `metaTableCode ${metaTableCode}` : undefined, metaTableId ? `metaTableId ${metaTableId}` : undefined]
    .filter(Boolean)
    .join(' / ');

  return {
    index,
    source: 'codal-cell-model',
    caption: alias ?? fallbackCaption,
    headers,
    rows,
    reconstruction
  };
}

function reconstructCodalCellTables(cells: unknown[], startIndex: number): CodalExtractedTable[] {
  return [...groupCellsByMetaTableCode(cells).values()]
    .map((group, offset) => reconstructCodalCellTable(group, startIndex + offset))
    .filter((table): table is CodalExtractedTable => Boolean(table));
}

function rowsFromHtmlTable(tableHtml: string): string[][] {
  return Array.from(tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((row) => {
      const headers = tableCells(row[1], 'th');
      const cells = tableCells(row[1], 'td');
      return headers.length > 0 ? headers : cells;
    })
    .filter((row) => row.some(Boolean));
}

function tableMetadataFromExtractedTables(tables: CodalExtractedTable[]): CodalTableMetadata[] {
  return tables.map((table) => ({
    index: table.index,
    rowCount: table.rows.length,
    columnCount: table.rows.reduce((max, row) => Math.max(max, row.length), table.headers.length),
    headers: table.headers,
    caption: table.caption,
    source: table.source,
    headersPreview: table.headers.slice(0, 6),
    reconstruction: table.reconstruction
  }));
}

function extractHtmlTableObjects(html: string): CodalExtractedTable[] {
  const safeHtml = stripUnsafeHtml(html);
  const tableMatches = Array.from(safeHtml.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi));

  return tableMatches.map((match, index) => {
    const tableHtml = match[1];
    const captionMatch = tableHtml.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    const rows = rowsFromHtmlTable(tableHtml);
    const headers = rows.find((row) => row.length > 0) ?? [];

    return {
      index,
      source: 'html-table',
      headers,
      rows,
      caption: captionMatch ? textFromHtml(captionMatch[1]) : undefined
    };
  });
}

function extractRepeatedHtmlRowStructures(html: string, startIndex: number): CodalExtractedTable[] {
  const safeHtml = stripUnsafeHtml(html);
  const rowMatches = Array.from(
    safeHtml.matchAll(/<(?:div|li|section)\b[^>]*(?:class|role)=["'][^"']*(?:row|tr|TableRow|rayanDynamicStatement)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li|section)>/gi)
  );
  const rows = rowMatches
    .map((match) => {
      const cellMatches = Array.from(
        match[1].matchAll(/<(?:span|div|label|p|td|th)\b[^>]*(?:class|role)=["'][^"']*(?:cell|td|th|column|value|caption)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|label|p|td|th)>/gi)
      );
      const cells = cellMatches.map((cell) => textFromHtml(cell[1])).filter(Boolean);
      return cells.length > 1 ? cells : [];
    })
    .filter((row) => row.length > 1);

  if (rows.length < 2) {
    return [];
  }

  return [
    {
      index: startIndex,
      source: 'html-row-structure',
      headers: rows[0],
      rows
    }
  ];
}

function primitiveRowsFromArray(items: unknown[]): string[][] {
  if (reconstructCodalCellTables(items, 0).length > 0) {
    return [];
  }

  if (items.every(Array.isArray)) {
    return items
      .map((row) => (row as unknown[]).filter(isPrimitiveCell).map(normalizeCell))
      .filter((row) => row.some(Boolean));
  }

  if (items.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
    const keys = [
      ...new Set(
        items.flatMap((item) =>
          Object.keys(item as Record<string, unknown>).filter(
            (key) => isPrimitiveCell((item as Record<string, unknown>)[key])
          )
        )
      )
    ];

    if (keys.length === 0) {
      return [];
    }

    return [
      keys.map(normalizeCell),
      ...items.map((item) => keys.map((key) => normalizeCell((item as Record<string, unknown>)[key])))
    ].filter((row) => row.some(Boolean));
  }

  return [];
}

function rowsFromCells(cells: unknown[]): string[][] {
  const normalizedCells = cells
    .map((cell) => (cell && typeof cell === 'object' ? (cell as Record<string, unknown>) : undefined))
    .filter((cell): cell is Record<string, unknown> => Boolean(cell));
  if (normalizedCells.length === 0) {
    return [];
  }

  const rowKeys = ['row', 'Row', 'rowIndex', 'RowIndex', 'r', 'R'];
  const colKeys = ['column', 'Column', 'columnIndex', 'ColumnIndex', 'col', 'Col', 'c', 'C'];
  const valueKeys = ['value', 'Value', 'text', 'Text', 'title', 'Title', 'cellValue', 'CellValue'];
  const rows = new Map<number, Map<number, string>>();

  for (const cell of normalizedCells) {
    const row = rowKeys.map((key) => cell[key]).find((value) => value !== undefined);
    const column = colKeys.map((key) => cell[key]).find((value) => value !== undefined);
    const value = valueKeys.map((key) => cell[key]).find((candidate) => candidate !== undefined);
    const rowIndex = Number(row);
    const columnIndex = Number(column);
    if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) {
      continue;
    }

    const rowCells = rows.get(rowIndex) ?? new Map<number, string>();
    rowCells.set(columnIndex, normalizeCell(value));
    rows.set(rowIndex, rowCells);
  }

  return [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, row]) => {
      const maxColumn = Math.max(...row.keys());
      return Array.from({ length: maxColumn + 1 }, (_, index) => row.get(index) ?? '');
    })
    .filter((row) => row.some(Boolean));
}

function rowsFromTableRecord(record: Record<string, unknown>): string[][] {
  const directRows = (Array.isArray(record.rows) ? record.rows : Array.isArray(record.Rows) ? record.Rows : undefined) as
    | unknown[]
    | undefined;
  const headers = (Array.isArray(record.headers)
    ? record.headers
    : Array.isArray(record.Headers)
      ? record.Headers
      : Array.isArray(record.header)
        ? record.header
        : Array.isArray(record.Header)
          ? record.Header
          : []) as unknown[];

  if (directRows) {
    const rows = primitiveRowsFromArray(directRows);
    return [headers.map(normalizeCell), ...rows].filter((row) => row.some(Boolean));
  }

  const cells = (Array.isArray(record.cells) ? record.cells : Array.isArray(record.Cells) ? record.Cells : undefined) as
    | unknown[]
    | undefined;
  if (cells) {
    if (reconstructCodalCellTables(cells, 0).length > 0) {
      return [];
    }
    return rowsFromCells(cells);
  }

  return [];
}

function tableCaptionFromRecord(record: Record<string, unknown>): string | undefined {
  return getString(record, ['caption', 'Caption', 'title', 'Title', 'name', 'Name', 'sheetName', 'SheetName']);
}

function extractJsonTableObjects(payload: unknown, source: CodalExtractedTable['source'] = 'json'): CodalExtractedTable[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const tables: CodalExtractedTable[] = [];
  const seen = new Set<unknown>();

  function visit(value: unknown, depth: number, caption?: string): void {
    if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const reconstructedTables = reconstructCodalCellTables(value, tables.length);
      if (reconstructedTables.length > 0) {
        tables.push(...reconstructedTables.map((table, offset) => ({ ...table, index: tables.length + offset })));
        return;
      }

      const rows = primitiveRowsFromArray(value);
      if (rows.length >= 2 && rows.reduce((max, row) => Math.max(max, row.length), 0) >= 2) {
        tables.push({
          index: tables.length,
          source,
          caption,
          headers: rows[0],
          rows
        });
      }

      for (const item of value) {
        visit(item, depth + 1, caption);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    const tableCaption = tableCaptionFromRecord(record) ?? caption;
    const rows = rowsFromTableRecord(record);
    if (rows.length >= 2 && rows.reduce((max, row) => Math.max(max, row.length), 0) >= 2) {
      tables.push({
        index: tables.length,
        source,
        caption: tableCaption,
        headers: rows[0],
        rows
      });
    }

    for (const key of ['tables', 'Tables', 'sheets', 'Sheets', 'data', 'Data', 'rows', 'Rows', 'cells', 'Cells']) {
      if (key in record) {
        visit(record[key], depth + 1, tableCaption);
      }
    }
  }

  visit(payload, 0);
  return dedupeTables(tables);
}

function decodeScriptString(value: string): string {
  return value.replace(/\\u([\dA-Fa-f]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function extractBalancedJsonCandidate(source: string, startIndex: number): string | undefined {
  const opener = source[startIndex];
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : undefined;
  if (!closer) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
    } else if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
}

function parseJsonCandidate(candidate: string): unknown | undefined {
  const normalized = decodeScriptString(candidate.trim())
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"');

  try {
    return JSON.parse(normalized);
  } catch {
    return undefined;
  }
}

function extractScriptJsonTables(html: string, startIndex: number): CodalExtractedTable[] {
  const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)).map((match) =>
    decodeHtmlEntities(match[1])
  );
  const tables: CodalExtractedTable[] = [];

  for (const script of scripts) {
    if (!/(table|sheet|cell|row|سرمایه|پرتفوی|پورتفوی|ارزش|بهای)/i.test(script)) {
      continue;
    }

    const jsonParseMatches = Array.from(script.matchAll(/JSON\.parse\(\s*(['"])([\s\S]*?)\1\s*\)/gi));
    for (const match of jsonParseMatches) {
      const payload = parseJsonCandidate(decodeScriptString(match[2]));
      tables.push(...extractJsonTableObjects(payload, 'script-json'));
    }

    for (let index = 0; index < script.length; index += 1) {
      if (script[index] !== '{' && script[index] !== '[') {
        continue;
      }
      const candidate = extractBalancedJsonCandidate(script, index);
      if (!candidate || candidate.length < 20 || candidate.length > 250_000) {
        continue;
      }
      const payload = parseJsonCandidate(candidate);
      tables.push(...extractJsonTableObjects(payload, 'script-json'));
      index += candidate.length - 1;
    }
  }

  return dedupeTables(tables).map((table, offset) => ({ ...table, index: startIndex + offset }));
}

function dedupeTables(tables: CodalExtractedTable[]): CodalExtractedTable[] {
  const seen = new Set<string>();
  return tables
    .filter((table) => table.rows.length > 0)
    .filter((table) => {
      const key = `${table.source}:${table.caption ?? ''}:${table.rows
        .slice(0, 5)
        .map((row) => row.join('|'))
        .join('~')}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((table, index) => ({ ...table, index }));
}

export function extractTablesFromHtml(html: string): CodalExtractedTable[] {
  const htmlTables = extractHtmlTableObjects(html);
  const rowTables = extractRepeatedHtmlRowStructures(html, htmlTables.length);
  const scriptTables = extractScriptJsonTables(html, htmlTables.length + rowTables.length);
  return dedupeTables([...htmlTables, ...rowTables, ...scriptTables]);
}

function parseDelimitedRows(text: string): string[][] {
  const delimiter = text.includes('\t') ? '\t' : text.includes(';') ? ';' : ',';
  return text
    .split(/\r?\n/)
    .map((line) => line.split(delimiter).map((cell) => normalizeCell(cell.replace(/^"|"$/g, ''))))
    .filter((row) => row.some(Boolean));
}

function extractDelimitedTables(text: string): CodalExtractedTable[] {
  const rows = parseDelimitedRows(text);
  if (rows.length < 2 || rows.reduce((max, row) => Math.max(max, row.length), 0) < 2) {
    return [];
  }

  return [
    {
      index: 0,
      source: 'codal-excel',
      caption: 'Codal ExcelUrl',
      headers: rows[0],
      rows
    }
  ];
}

function markExcelTables(tables: CodalExtractedTable[], startIndex: number): CodalExtractedTable[] {
  return tables.map((table, offset) => ({
    ...table,
    index: startIndex + offset,
    source: 'codal-excel',
    caption: table.caption ?? 'Codal ExcelUrl'
  }));
}

function extractTablesFromExcelResponse(body: string | unknown, contentType: string, startIndex: number): CodalExtractedTable[] {
  if (typeof body !== 'string') {
    return markExcelTables(extractJsonTableObjects(body, 'codal-excel'), startIndex);
  }

  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith('PK\u0003\u0004') || trimmed.startsWith('%PDF')) {
    return [];
  }

  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = parseJsonCandidate(trimmed);
    return parsed ? markExcelTables(extractJsonTableObjects(parsed, 'codal-excel'), startIndex) : [];
  }

  if (/<table|<html|<body/i.test(trimmed)) {
    return markExcelTables(extractTablesFromHtml(trimmed), startIndex);
  }

  if (contentType.includes('csv') || contentType.includes('text/plain') || /[\t,;]/.test(trimmed)) {
    return markExcelTables(extractDelimitedTables(trimmed), startIndex);
  }

  return [];
}

export function extractTableMetadataFromHtml(html: string): CodalTableMetadata[] {
  return tableMetadataFromExtractedTables(extractTablesFromHtml(html));
}

function jsonPreview(payload: unknown): string {
  return normalizePersianArabicDigits(JSON.stringify(payload))
    .replace(/\s+/g, ' ')
    .slice(0, 700);
}

function detectedContentType(contentType: string, body: string | unknown): CodalReportDetail['contentType'] {
  if (contentType.includes('application/json') || typeof body !== 'string') {
    return 'json';
  }
  if (contentType.includes('text/html') || /<html|<body|<table|<script/i.test(body)) {
    return 'html';
  }
  return 'unknown';
}

function detailWarningsFor(
  contentType: CodalReportDetail['contentType'],
  body: string | unknown,
  extractedTables: CodalExtractedTable[]
): string[] {
  if (extractedTables.length > 0) {
    return [];
  }

  if (typeof body === 'string' && body.trim().startsWith('%PDF')) {
    return ['گزارش شبیه PDF یا پیوست مستقیم است و Parser فعلی آن را پشتیبانی نمی‌کند.'];
  }
  if (contentType === 'html') {
    return ['هیچ جدول HTML یا داده جدولی قابل پشتیبانی در اسکریپت‌های گزارش شناسایی نشد.'];
  }
  if (contentType === 'json') {
    return ['ساختار JSON گزارش هنوز در Parser پشتیبانی نمی‌شود.'];
  }
  return ['نوع محتوای گزارش ناشناخته است یا پاسخ خالی/مسدود شده است.'];
}

function hasMarketValueColumn(tables: CodalExtractedTable[]): boolean {
  return tables.some((table) =>
    table.rows
      .slice(0, 8)
      .flat()
      .some((cell) => /ارزش\s*بازار|ارزش\s*روز|مبلغ\s*بازار|ارزش\s*روز\s*بازار/.test(normalizeCell(cell)))
  );
}

function buildSourceStrategyDiagnostics(options: {
  detailTables: CodalExtractedTable[];
  excelDiagnostics: CodalExcelDiagnostics;
}): CodalSourceStrategyDiagnostics {
  const reconstructedTableChecked = options.detailTables.some((table) => table.source === 'codal-cell-model');
  const excelChecked = options.excelDiagnostics.status === 'fetched';
  const allTables = options.detailTables;
  const marketValueStatus = hasMarketValueColumn(allTables) ? 'found' : 'not-found';
  const messages = [
    'جزئیات HTML/JSON گزارش بررسی شد.',
    reconstructedTableChecked ? 'جدول‌های بازسازی‌شده از مدل سلولی کدال بررسی شد.' : 'جدول بازسازی‌شده از مدل سلولی کدال در این جزئیات وجود نداشت.',
    options.excelDiagnostics.status === 'fetched'
      ? `ExcelUrl بررسی شد؛ ${options.excelDiagnostics.tableCount} جدول قابل بررسی پیدا شد.`
      : options.excelDiagnostics.status === 'unavailable'
        ? 'ExcelUrl برای گزارش انتخاب‌شده در متادیتا وجود نداشت.'
        : options.excelDiagnostics.errorCode === 'cors-blocked'
          ? 'ExcelUrl به‌دلیل محدودیت CORS/دسترسی افزونه قابل بررسی نبود.'
        : `ExcelUrl قابل استفاده نبود: ${options.excelDiagnostics.errorMessage ?? options.excelDiagnostics.status}.`,
    marketValueStatus === 'found'
      ? 'ستون ارزش روز/ارزش بازار در منابع بررسی‌شده پیدا شد.'
      : excelChecked
        ? 'ارزش روز پرتفوی بورسی در Excel گزارش نیز پیدا نشد.'
        : 'ارزش روز پرتفوی بورسی در جزئیات گزارش پیدا نشد و ExcelUrl قابل بررسی نبود.'
  ];

  return {
    htmlDetailChecked: true,
    reconstructedTableChecked,
    excel: options.excelDiagnostics,
    alternativeReportsChecked: false,
    marketValueStatus,
    messages
  };
}

async function fetchExcelTablesForReport(
  report: CodalReportReference | undefined,
  options: CodalSearchOptions,
  startIndex: number
): Promise<{ tables: CodalExtractedTable[]; diagnostics: CodalExcelDiagnostics }> {
  const excelUrl = absoluteCodalUrl(report?.excelUrl);
  if (!excelUrl) {
    return {
      tables: [],
      diagnostics: {
        url: report?.excelUrl,
        status: 'unavailable',
        tableCount: 0,
        errorMessage: 'ExcelUrl برای این گزارش در متادیتای کدال وجود ندارد.'
      }
    };
  }

  try {
    const response = await fetchTextOrJsonWithTimeout(
      excelUrl,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.fetchImpl ?? fetch
    );
    const tables = extractTablesFromExcelResponse(response.body, response.contentType, startIndex);
    return {
      tables,
      diagnostics: {
        url: excelUrl,
        status: tables.length > 0 ? 'fetched' : 'unsupported-format',
        contentType: response.contentType,
        tableCount: tables.length,
        errorMessage: tables.length > 0 ? undefined : 'ExcelUrl دریافت شد اما جدول قابل پشتیبانی در آن پیدا نشد.',
        fetchedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Codal ExcelUrl fetch failed.';
    const isTimeout = message.includes('timed out');
    const isCorsLike =
      error instanceof TypeError ||
      /Failed to fetch|CORS|Access-Control-Allow-Origin|NetworkError/i.test(message);
    return {
      tables: [],
      diagnostics: {
        url: excelUrl,
        status: isTimeout ? 'timeout' : isCorsLike ? 'cors-blocked' : 'network-error',
        tableCount: 0,
        errorCode: isTimeout ? 'timeout' : isCorsLike ? 'cors-blocked' : 'network-error',
        errorMessage: isCorsLike
          ? 'ExcelUrl به‌دلیل محدودیت CORS/دسترسی افزونه قابل بررسی نبود.'
          : message,
        fetchedAt: new Date().toISOString()
      }
    };
  }
}

async function enrichDetailWithExcel(
  result: CodalReportDetailResult,
  report: CodalReportReference | undefined,
  options: CodalSearchOptions
): Promise<CodalReportDetailResult> {
  if (!result.detail) {
    return result;
  }

  const existingTables = result.detail.extractedTables;
  const excel = await fetchExcelTablesForReport(report, options, existingTables.length);
  const extractedTables = [...existingTables, ...excel.tables];
  const tables = tableMetadataFromExtractedTables(extractedTables);
  const sourceStrategy = buildSourceStrategyDiagnostics({
    detailTables: extractedTables,
    excelDiagnostics: excel.diagnostics
  });

  return {
    ...result,
    detail: {
      ...result.detail,
      excelUrl: report?.excelUrl,
      excelDiagnostics: excel.diagnostics,
      sourceStrategy,
      extractedTables,
      tables,
      parserWarnings: [...result.detail.parserWarnings, ...sourceStrategy.messages.filter((message) => message.includes('پیدا نشد'))]
    }
  };
}

export function isMonthlyActivityReport(title: string): boolean {
  return titleMatches(title, monthlyActivityPatterns);
}

export function isFinancialStatementReport(title: string): boolean {
  return titleMatches(title, financialStatementPatterns);
}

export function isPortfolioReport(title: string): boolean {
  return /پرتفوی|پورتفوی|سرمایه\s*گذاری|سرمایه‌گذاری|portfolio/i.test(title);
}

function getLatestMatchingReport(
  reports: CodalReportReference[],
  kind: CodalReportKind,
  requestedSymbol: string,
  requestedIssuerName?: string
): CodalReportReference | undefined {
  return reportFromSelectionDiagnostics(selectReportByRank(reports, requestedSymbol, kind, requestedIssuerName));
}

async function getReportsByKind(
  symbol: string,
  kind: CodalReportKind,
  patterns: RegExp[],
  options: CodalSearchOptions = {}
): Promise<CodalReportReference | undefined> {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cached = await getCachedReports(symbol, kind, cacheTtlMs);
  if (cached) {
    return cached[0];
  }

  const reports = await searchReportsBySymbol(symbol, options);
  const matching = sortReportsNewestFirst(reports.filter((report) => titleMatches(report.title, patterns)));
  const selected = getLatestMatchingReport(matching, kind, symbol, options.requestedIssuerName);
  await setCachedReports(symbol, kind, selected ? [selected] : []);
  return selected;
}

export async function searchReportsBySymbol(
  symbol: string,
  options: CodalSearchOptions = {}
): Promise<CodalReportReference[]> {
  const normalizedSymbol = normalizePersianArabicDigits(symbol).trim();
  if (!normalizedSymbol) {
    throw new Error('Codal search requires a non-empty symbol.');
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryLimit = options.retryLimit ?? DEFAULT_RETRY_LIMIT;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const cached = await getCachedReports(normalizedSymbol, 'all', cacheTtlMs);
  if (cached) {
    return cached;
  }

  let reports: CodalReportReference[] = [];
  for (const variant of codalSymbolVariants(normalizedSymbol)) {
    const payload = await fetchWithRetry(buildSearchUrl(variant, limit), {
      timeoutMs,
      retryLimit,
      fetchImpl
    });
    reports = extractReports(payload, normalizedSymbol);
    if (reports.length > 0) {
      break;
    }
  }

  reports = sortReportsNewestFirst(reports);
  await setCachedReports(normalizedSymbol, 'all', reports);
  return reports;
}

export async function getLatestMonthlyActivityReport(
  symbol: string,
  options?: CodalSearchOptions
): Promise<CodalReportReference | undefined> {
  return getReportsByKind(symbol, 'monthly-activity', monthlyActivityPatterns, options);
}

export async function getLatestFinancialStatement(
  symbol: string,
  options?: CodalSearchOptions
): Promise<CodalReportReference | undefined> {
  return getReportsByKind(symbol, 'financial-statement', financialStatementPatterns, options);
}

export async function discoverLatestCodalReports(
  symbol: string,
  options: CodalSearchOptions = {}
): Promise<CodalReportDiscoveryResult> {
  const normalizedSymbol = symbol.trim();
  const checkedAt = new Date().toISOString();

  if (!normalizedSymbol || normalizedSymbol === 'نماد نامشخص' || normalizedSymbol.startsWith('InsCode:')) {
    return {
      status: 'not-found',
      symbol: normalizedSymbol,
      sourceVerified: false,
      checkedAt
    };
  }

  try {
    const reports = await searchReportsBySymbol(normalizedSymbol, options);
    const monthlyDiagnostics = selectReportByRank(
      reports,
      normalizedSymbol,
      'monthly-activity',
      options.requestedIssuerName
    );
    const financialDiagnostics = selectReportByRank(
      reports,
      normalizedSymbol,
      'financial-statement',
      options.requestedIssuerName
    );
    const monthlyActivityReport = reportFromSelectionDiagnostics(monthlyDiagnostics);
    const financialStatementReport = reportFromSelectionDiagnostics(financialDiagnostics);
    const diagnostics: CodalDiscoveryDiagnostics = {
      requestedSymbol: normalizedSymbol,
      requestedIssuerName: options.requestedIssuerName,
      monthlyActivity: monthlyDiagnostics,
      financialStatement: financialDiagnostics
    };

    return {
      status: monthlyActivityReport || financialStatementReport ? 'found' : 'not-found',
      symbol: normalizedSymbol,
      monthlyActivityReport,
      financialStatementReport,
      diagnostics,
      errorMessage:
        monthlyActivityReport || financialStatementReport
          ? undefined
          : 'برای این نماد گزارش قابل اتکایی با تطبیق نماد/ناشر پیدا نشد.',
      sourceVerified: false,
      checkedAt
    };
  } catch (error) {
    return {
      status: 'failed',
      symbol: normalizedSymbol,
      errorMessage: error instanceof Error ? error.message : 'Codal discovery failed.',
      sourceVerified: false,
      checkedAt
    };
  }
}

function normalizeDetailFromBody(
  sourceUrl: string,
  body: string | unknown,
  contentType: string,
  report?: CodalReportReference
): CodalReportDetailResult {
  const fetchedAt = new Date().toISOString();
  const normalizedContentType = detectedContentType(contentType, body);

  if (typeof body === 'string') {
    const plainTextPreview = textFromHtml(body).slice(0, 700);
    const extractedTables = extractTablesFromHtml(body);
    const tables = tableMetadataFromExtractedTables(extractedTables);
    const parserWarnings = detailWarningsFor(normalizedContentType, body, extractedTables);
    const isAttachmentLike = body.trim().startsWith('%PDF') || contentType.includes('application/pdf');

    return {
      status: isAttachmentLike ? 'unsupported-format' : plainTextPreview || tables.length > 0 ? 'fetched' : 'unsupported-format',
      detail: {
        sourceUrl,
        symbol: report?.symbol,
        title: report?.title,
        publishedAt: report?.publishedAt,
        tracingNo: report?.tracingNo,
        reportId: report?.reportId,
        selectionDiagnostics: report?.selectionDiagnostics,
        contentType: normalizedContentType,
        rawHtml: body,
        plainTextPreview,
        tables,
        extractedTables,
        parserWarnings,
        fetchedAt
      },
      errorMessage:
        plainTextPreview || tables.length > 0
          ? tables.length > 0
            ? undefined
            : parserWarnings[0]
          : 'Report detail HTML had no readable content.'
    };
  }

  const extractedTables = extractJsonTableObjects(body, 'json');
  const tables = tableMetadataFromExtractedTables(extractedTables);
  const plainTextPreview = jsonPreview(body);
  const parserWarnings = detailWarningsFor(normalizedContentType, body, extractedTables);

  return {
    status:
      contentType.includes('application/json') || tables.length > 0 || plainTextPreview
        ? 'fetched'
        : 'unsupported-format',
    detail: {
      sourceUrl,
      symbol: report?.symbol,
      title: report?.title,
        publishedAt: report?.publishedAt,
        tracingNo: report?.tracingNo,
        reportId: report?.reportId,
        selectionDiagnostics: report?.selectionDiagnostics,
        contentType: normalizedContentType,
        rawJson: body,
        plainTextPreview,
        tables,
        extractedTables,
        parserWarnings,
        fetchedAt
    },
    errorMessage: tables.length > 0 ? undefined : parserWarnings[0]
  };
}

export async function getReportDetailByUrl(
  url: string,
  options: CodalSearchOptions = {},
  report?: CodalReportReference
): Promise<CodalReportDetailResult> {
  const sourceUrl = absoluteCodalUrl(url);
  if (!sourceUrl) {
    return {
      status: 'unavailable',
      errorMessage: 'Codal report detail URL is unavailable or invalid.'
    };
  }

  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cached = await getCachedDetail(sourceUrl, cacheTtlMs);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetchTextOrJsonWithTimeout(
      sourceUrl,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.fetchImpl ?? fetch
    );
    const result = await enrichDetailWithExcel(
      normalizeDetailFromBody(sourceUrl, response.body, response.contentType, report),
      report,
      options
    );
    await setCachedDetail(sourceUrl, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Codal report detail fetch failed.';
    return {
      status: message.includes('timed out') ? 'timeout' : 'network-error',
      errorMessage: message
    };
  }
}

export async function getReportDetailByTracingNo(
  tracingNo: string,
  options: CodalSearchOptions = {}
): Promise<CodalReportDetailResult> {
  const normalizedTracingNo = tracingNo.trim();
  if (!normalizedTracingNo) {
    return {
      status: 'unavailable',
      errorMessage: 'Codal tracing number is unavailable.'
    };
  }

  return getReportDetailByUrl(reportUrlFromTracingNo(normalizedTracingNo), options, {
    symbol: '',
    title: '',
    tracingNo: normalizedTracingNo
  });
}

export async function getReportDetail(
  report: CodalReportReference,
  options: CodalSearchOptions = {}
): Promise<CodalReportDetailResult> {
  const sourceUrl = reportUrlFromReference(report);
  if (!sourceUrl) {
    return {
      status: 'unavailable',
      errorMessage: 'Codal report has no URL, report id, or tracing number.'
    };
  }

  return getReportDetailByUrl(sourceUrl, options, report);
}
