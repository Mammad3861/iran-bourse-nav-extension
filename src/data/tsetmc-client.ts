import { parseLocalizedNumber } from '../core/number-utils';
import { detectSymbolFromDocument, detectSymbolFromUrl, type SymbolDetectionResult } from '../core/symbol-utils';

export interface TsetmcSearchResult {
  insCode: string;
  symbol: string;
  name?: string;
  isin?: string;
  market?: string;
  raw?: unknown;
}

export interface TsetmcInstrumentInfo {
  insCode: string;
  symbol?: string;
  name?: string;
  isin?: string;
  market?: string;
  groupName?: string;
  totalShares?: number;
  raw?: unknown;
}

export interface TsetmcPriceInfo {
  insCode: string;
  lastTradePrice?: number;
  closingPrice?: number;
  yesterdayPrice?: number;
  tradeDate?: string;
  source: 'api' | 'dom';
  raw?: unknown;
}

export interface TsetmcClientOptions {
  timeoutMs?: number;
  retryLimit?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
}

export interface TsetmcPriceOptions extends TsetmcClientOptions {
  fallbackDocument?: Document;
}

export interface TsetmcPageSnapshot {
  symbol?: string;
  symbolSource: SymbolDetectionResult['source'];
  currentPrice?: number;
  capturedAt: string;
}

interface TsetmcCacheRecord<T> {
  createdAt: string;
  value: T;
}

const TSETMC_API_BASE = 'https://cdn.tsetmc.com/api';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_LIMIT = 1;
const DEFAULT_CACHE_TTL_MS = 30 * 1_000;

const priceSelectors = [
  '[data-current-price]',
  '#d02',
  '#last-price',
  '.last-price',
  '.price:last-child'
];

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

function cacheKey(parts: string[]): string {
  return `tsetmc:${parts.join(':')}`;
}

async function getCachedValue<T>(key: string, cacheTtlMs: number): Promise<T | undefined> {
  if (!hasChromeStorage()) {
    return undefined;
  }

  const record = (await chrome.storage.local.get(key))[key] as TsetmcCacheRecord<T> | undefined;
  if (!record) {
    return undefined;
  }

  const ageMs = Date.now() - Date.parse(record.createdAt);
  return ageMs >= 0 && ageMs <= cacheTtlMs ? record.value : undefined;
}

async function setCachedValue<T>(key: string, value: T): Promise<void> {
  if (!hasChromeStorage()) {
    return;
  }

  await chrome.storage.local.set({
    [key]: {
      createdAt: new Date().toISOString(),
      value
    } satisfies TsetmcCacheRecord<T>
  });
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

function getNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = parseLocalizedNumber(record[key] as string | number | null | undefined);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function unwrapObject(payload: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }

  return record;
}

function unwrapArray(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function normalizeSearchResult(raw: unknown): TsetmcSearchResult | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const insCode = getString(record, ['insCode', 'InsCode', 'instrumentId', 'id']);
  const symbol = getString(record, ['lVal18AFC', 'symbol', 'Symbol', 'instrumentName']);

  if (!insCode || !symbol) {
    return undefined;
  }

  return {
    insCode,
    symbol,
    name: getString(record, ['lVal30', 'name', 'Name', 'companyName']),
    isin: getString(record, ['cIsin', 'isin', 'ISIN']),
    market: getString(record, ['marketName', 'MarketName', 'flowTitle']),
    raw
  };
}

function normalizeInstrumentInfo(raw: unknown, insCode: string): TsetmcInstrumentInfo | undefined {
  const record = unwrapObject(raw, ['instrumentInfo', 'InstrumentInfo', 'data']);
  if (!record) {
    return undefined;
  }

  return {
    insCode: getString(record, ['insCode', 'InsCode']) ?? insCode,
    symbol: getString(record, ['lVal18AFC', 'symbol', 'Symbol']),
    name: getString(record, ['lVal30', 'name', 'Name']),
    isin: getString(record, ['cIsin', 'isin', 'ISIN']),
    market: getString(record, ['marketName', 'MarketName', 'flowTitle']),
    groupName: getString(record, ['sectorName', 'SectorName', 'groupName']),
    totalShares: getNumber(record, ['zTitad', 'totalShares', 'TotalShares']),
    raw
  };
}

function normalizePriceInfo(raw: unknown, insCode: string): TsetmcPriceInfo | undefined {
  const record = unwrapObject(raw, ['closingPriceInfo', 'ClosingPriceInfo', 'data']);
  if (!record) {
    return undefined;
  }

  const lastTradePrice = getNumber(record, ['pDrCotVal', 'lastTradePrice', 'LastTradePrice']);
  const closingPrice = getNumber(record, ['pClosing', 'closingPrice', 'ClosingPrice']);

  if (lastTradePrice === undefined && closingPrice === undefined) {
    return undefined;
  }

  return {
    insCode: getString(record, ['insCode', 'InsCode']) ?? insCode,
    lastTradePrice,
    closingPrice,
    yesterdayPrice: getNumber(record, ['priceYesterday', 'PriceYesterday', 'pYesterday']),
    tradeDate: getString(record, ['dEven', 'tradeDate', 'TradeDate']),
    source: 'api',
    raw
  };
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
      throw new Error(`TSETMC request failed with HTTP ${response.status}.`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`TSETMC request timed out after ${timeoutMs} ms.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithRetry(
  url: string,
  options: Required<Pick<TsetmcClientOptions, 'timeoutMs' | 'retryLimit' | 'fetchImpl'>>
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retryLimit; attempt += 1) {
    try {
      return await fetchJsonWithTimeout(url, options.timeoutMs, options.fetchImpl);
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Unknown TSETMC error.';
  throw new Error(`TSETMC request failed after ${options.retryLimit + 1} attempt(s): ${message}`, {
    cause: lastError
  });
}

function clientOptions(options: TsetmcClientOptions) {
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryLimit: options.retryLimit ?? DEFAULT_RETRY_LIMIT,
    cacheTtlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    fetchImpl: options.fetchImpl ?? fetch
  };
}

export async function searchSymbols(
  query: string,
  options: TsetmcClientOptions = {}
): Promise<TsetmcSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new Error('TSETMC symbol search requires a non-empty query.');
  }

  const resolved = clientOptions(options);
  const key = cacheKey(['search', normalizedQuery]);
  const cached = await getCachedValue<TsetmcSearchResult[]>(key, resolved.cacheTtlMs);
  if (cached) {
    return cached;
  }

  const url = `${TSETMC_API_BASE}/Instrument/GetInstrumentSearch/${encodeURIComponent(normalizedQuery)}`;
  const payload = await fetchWithRetry(url, resolved);
  const results = unwrapArray(payload, ['instrumentSearch', 'InstrumentSearch', 'data'])
    .map(normalizeSearchResult)
    .filter((item): item is TsetmcSearchResult => Boolean(item));

  await setCachedValue(key, results);
  return results;
}

export async function getInstrumentInfoByInsCode(
  insCode: string,
  options: TsetmcClientOptions = {}
): Promise<TsetmcInstrumentInfo> {
  const normalizedInsCode = insCode.trim();
  if (!normalizedInsCode) {
    throw new Error('TSETMC instrument info requires a non-empty InsCode.');
  }

  const resolved = clientOptions(options);
  const key = cacheKey(['instrument-info', normalizedInsCode]);
  const cached = await getCachedValue<TsetmcInstrumentInfo>(key, resolved.cacheTtlMs);
  if (cached) {
    return cached;
  }

  const url = `${TSETMC_API_BASE}/Instrument/GetInstrumentInfo/${encodeURIComponent(normalizedInsCode)}`;
  const payload = await fetchWithRetry(url, resolved);
  const info = normalizeInstrumentInfo(payload, normalizedInsCode);
  if (!info) {
    throw new Error(`TSETMC instrument info response did not include instrument data for ${normalizedInsCode}.`);
  }

  await setCachedValue(key, info);
  return info;
}

export async function getLatestPriceByInsCode(
  insCode: string,
  options: TsetmcPriceOptions = {}
): Promise<TsetmcPriceInfo> {
  const normalizedInsCode = insCode.trim();
  if (!normalizedInsCode) {
    throw new Error('TSETMC latest price requires a non-empty InsCode.');
  }

  const resolved = clientOptions(options);
  const key = cacheKey(['latest-price', normalizedInsCode]);
  const cached = await getCachedValue<TsetmcPriceInfo>(key, resolved.cacheTtlMs);
  if (cached) {
    return cached;
  }

  const url = `${TSETMC_API_BASE}/ClosingPrice/GetClosingPriceInfo/${encodeURIComponent(normalizedInsCode)}`;

  try {
    const payload = await fetchWithRetry(url, resolved);
    const price = normalizePriceInfo(payload, normalizedInsCode);
    if (!price) {
      throw new Error(`TSETMC price response did not include price data for ${normalizedInsCode}.`);
    }

    await setCachedValue(key, price);
    return price;
  } catch (error) {
    const fallbackPrice = options.fallbackDocument
      ? readCurrentPriceFromDocument(options.fallbackDocument)
      : undefined;

    if (fallbackPrice !== undefined) {
      return {
        insCode: normalizedInsCode,
        lastTradePrice: fallbackPrice,
        source: 'dom'
      };
    }

    throw error;
  }
}

export function detectCurrentTsetmcSymbol(documentRef: Document, href: string): SymbolDetectionResult {
  const fromUrl = detectSymbolFromUrl(href);
  if (fromUrl.symbol) {
    return fromUrl;
  }

  return detectSymbolFromDocument(documentRef);
}

export function readCurrentPriceFromDocument(documentRef: Document): number | undefined {
  for (const selector of priceSelectors) {
    const text = documentRef.querySelector(selector)?.textContent;
    const price = parseLocalizedNumber(text);
    if (price !== undefined && price > 0) {
      return price;
    }
  }

  const likelyPriceText = Array.from(documentRef.querySelectorAll('td, span, div'))
    .map((node) => node.textContent?.trim() ?? '')
    .find((text) => /قیمت\s*(پایانی|آخرین|معامله)/.test(text));

  return parseLocalizedNumber(likelyPriceText);
}

export function snapshotTsetmcPage(documentRef: Document, href: string): TsetmcPageSnapshot {
  const detected = detectCurrentTsetmcSymbol(documentRef, href);

  return {
    symbol: detected.symbol,
    symbolSource: detected.source,
    currentPrice: readCurrentPriceFromDocument(documentRef),
    capturedAt: new Date().toISOString()
  };
}
