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
  raw?: unknown;
}

export interface CodalReportDiscoveryResult {
  status: CodalDiscoveryStatus;
  symbol: string;
  monthlyActivityReport?: CodalReportReference;
  financialStatementReport?: CodalReportReference;
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
}

export interface CodalReportDetail {
  sourceUrl: string;
  symbol?: string;
  title?: string;
  publishedAt?: string;
  tracingNo?: string;
  reportId?: string;
  rawHtml?: string;
  rawJson?: unknown;
  plainTextPreview: string;
  tables: CodalTableMetadata[];
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

const monthlyActivityPatterns = [/فعالیت\s*ماهانه/, /گزارش\s*فعالیت/];
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
  url.searchParams.set('search', 'true');
  url.searchParams.set('Symbol', symbol);
  url.searchParams.set('PageNumber', '1');
  url.searchParams.set('Length', String(limit));
  url.searchParams.set('LetterType', '-1');
  url.searchParams.set('Category', '-1');
  url.searchParams.set('CompanyType', '-1');
  return url.toString();
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
    .replace(/\s+/g, ' ')
    .trim();
}

function tableCells(rowHtml: string, tagName: 'th' | 'td'): string[] {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  return Array.from(rowHtml.matchAll(pattern)).map((match) => textFromHtml(match[1]));
}

export function extractTableMetadataFromHtml(html: string): CodalTableMetadata[] {
  const safeHtml = stripUnsafeHtml(html);
  const tableMatches = Array.from(safeHtml.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi));

  return tableMatches.map((match, index) => {
    const tableHtml = match[1];
    const captionMatch = tableHtml.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    const rowMatches = Array.from(tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
    const rows = rowMatches.map((row) => {
      const headers = tableCells(row[1], 'th');
      const cells = tableCells(row[1], 'td');
      return headers.length > 0 ? headers : cells;
    });
    const headers = rows.find((row) => row.length > 0) ?? [];
    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

    return {
      index,
      rowCount: rows.length,
      columnCount,
      headers,
      caption: captionMatch ? textFromHtml(captionMatch[1]) : undefined
    };
  });
}

function extractJsonTables(payload: unknown): CodalTableMetadata[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.tables, record.Tables, record.sheets, record.Sheets, record.data, record.Data]
    .filter(Array.isArray)
    .flat() as unknown[];

  return candidates
    .map((table, index): CodalTableMetadata | undefined => {
      if (!table || typeof table !== 'object') {
        return undefined;
      }
      const tableRecord = table as Record<string, unknown>;
      const rows = Array.isArray(tableRecord.rows)
        ? tableRecord.rows
        : Array.isArray(tableRecord.Rows)
          ? tableRecord.Rows
          : [];
      const headers = Array.isArray(tableRecord.headers)
        ? tableRecord.headers.map(String)
        : Array.isArray(tableRecord.Headers)
          ? tableRecord.Headers.map(String)
          : [];
      const firstRow = Array.isArray(rows[0]) ? (rows[0] as unknown[]) : [];
      const columnCount = Math.max(headers.length, firstRow.length);

      return {
        index,
        rowCount: rows.length,
        columnCount,
        headers,
        caption: getString(tableRecord, ['caption', 'Caption', 'title', 'Title'])
      };
    })
    .filter((table): table is CodalTableMetadata => Boolean(table));
}

function jsonPreview(payload: unknown): string {
  return normalizePersianArabicDigits(JSON.stringify(payload))
    .replace(/\s+/g, ' ')
    .slice(0, 700);
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
  patterns: RegExp[]
): CodalReportReference | undefined {
  return sortReportsNewestFirst(reports.filter((report) => titleMatches(report.title, patterns)))[0];
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
  await setCachedReports(symbol, kind, matching);
  return matching[0];
}

export async function searchReportsBySymbol(
  symbol: string,
  options: CodalSearchOptions = {}
): Promise<CodalReportReference[]> {
  const normalizedSymbol = symbol.trim();
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

  const payload = await fetchWithRetry(buildSearchUrl(normalizedSymbol, limit), {
    timeoutMs,
    retryLimit,
    fetchImpl
  });
  const reports = sortReportsNewestFirst(extractReports(payload, normalizedSymbol));
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
    const monthlyActivityReport = getLatestMatchingReport(reports, monthlyActivityPatterns);
    const financialStatementReport = getLatestMatchingReport(reports, financialStatementPatterns);

    return {
      status: monthlyActivityReport || financialStatementReport ? 'found' : 'not-found',
      symbol: normalizedSymbol,
      monthlyActivityReport,
      financialStatementReport,
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

  if (typeof body === 'string') {
    const plainTextPreview = textFromHtml(body).slice(0, 700);
    const tables = extractTableMetadataFromHtml(body);

    return {
      status: plainTextPreview || tables.length > 0 ? 'fetched' : 'unsupported-format',
      detail: {
        sourceUrl,
        symbol: report?.symbol,
        title: report?.title,
        publishedAt: report?.publishedAt,
        tracingNo: report?.tracingNo,
        reportId: report?.reportId,
        rawHtml: body,
        plainTextPreview,
        tables,
        fetchedAt
      },
      errorMessage: plainTextPreview || tables.length > 0 ? undefined : 'Report detail HTML had no readable content.'
    };
  }

  const tables = extractJsonTables(body);
  const plainTextPreview = jsonPreview(body);

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
      rawJson: body,
      plainTextPreview,
      tables,
      fetchedAt
    }
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
    const result = normalizeDetailFromBody(sourceUrl, response.body, response.contentType, report);
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
