import { normalizePersianArabicDigits, parseLocalizedNumber } from '../core/number-utils';
import {
  detectSymbolFromDocument,
  detectSymbolFromUrl,
  isKnownUiSymbolLabel,
  type SymbolDetectionResult
} from '../core/symbol-utils';

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
  displaySymbol?: string;
  codalSymbol?: string;
  instrumentName?: string;
  insCode?: string;
  symbolSource: SymbolDetectionResult['source'];
  currentPrice?: number;
  currentPriceSource: 'dom-latest-trade' | 'dom-closing-price' | 'unknown';
  closingPrice?: number;
  symbolDiagnostics: TsetmcSymbolDiagnostics;
  capturedAt: string;
}

export type TsetmcSymbolCandidateSource = 'url' | 'header' | 'title' | 'trusted-dom';

export interface TsetmcSymbolCandidate {
  value: string;
  source: TsetmcSymbolCandidateSource;
  context: string;
  rejectedReason?: string;
}

export interface TsetmcSymbolDiagnostics {
  selected?: TsetmcSymbolCandidate;
  candidates: TsetmcSymbolCandidate[];
  rejectedCandidates: TsetmcSymbolCandidate[];
}

export type TsetmcDomPriceSource = 'dom-latest-trade' | 'dom-closing-price' | 'dom-selector';

export interface TsetmcPriceCandidate {
  value?: number;
  rawText: string;
  source: TsetmcDomPriceSource;
  labelText: string;
  confidence: 'high' | 'medium' | 'low';
  rejectedReason?: string;
}

export interface TsetmcDomPriceExtractionResult {
  selected?: TsetmcPriceCandidate;
  latestTrade?: TsetmcPriceCandidate;
  closingPrice?: TsetmcPriceCandidate;
  candidates: TsetmcPriceCandidate[];
  rejectedCandidates: TsetmcPriceCandidate[];
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

const tsetmcSymbolPatterns = [
  /\(([\u0600-\u06ffA-Za-z0-9_-]{2,20})\)/,
  /نماد\s*[:：]?\s*([\u0600-\u06ffA-Za-z0-9_-]{2,20})/
];

function isTsetmcSiteLabel(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toUpperCase();
  return normalized === 'TSETMC' || normalized === 'INSTINFO' || normalized.includes('TSETMC');
}

function isLikelyInsCode(value: string | undefined): boolean {
  return Boolean(value && /^\d{5,}$/.test(value.trim()));
}

function isLikelyPersianSymbol(value: string | undefined): boolean {
  return Boolean(value && /^[\u0600-\u06ffA-Za-z0-9_-]{2,24}$/.test(value) && /[\u0600-\u06ff]/.test(value));
}

function sanitizeDetectedSymbol(value: string | undefined, insCode?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (
    !normalized ||
    normalized === 'instInfo' ||
    normalized === insCode ||
    isLikelyInsCode(normalized) ||
    isKnownUiSymbolLabel(normalized) ||
    isTsetmcSiteLabel(normalized) ||
    /https?:\/\//i.test(normalized) ||
    /\b(?:www|tsetmc|codal)\b/i.test(normalized)
  ) {
    return undefined;
  }

  return normalized;
}

function validateSymbolCandidate(value: string | undefined, source: TsetmcSymbolCandidateSource, context: string, insCode?: string): TsetmcSymbolCandidate {
  const candidate: TsetmcSymbolCandidate = {
    value: value?.trim() ?? '',
    source,
    context: context.slice(0, 180)
  };

  if (!candidate.value) {
    return { ...candidate, rejectedReason: 'empty candidate' };
  }
  if (candidate.value === 'instInfo') {
    return { ...candidate, rejectedReason: 'route segment is not a symbol' };
  }
  if (candidate.value === insCode || isLikelyInsCode(candidate.value)) {
    return { ...candidate, rejectedReason: 'candidate is InsCode-like' };
  }
  if (isKnownUiSymbolLabel(candidate.value)) {
    return { ...candidate, rejectedReason: 'candidate is a TSETMC UI label' };
  }
  if (isTsetmcSiteLabel(candidate.value)) {
    return { ...candidate, rejectedReason: 'candidate is a site label' };
  }
  if (/https?:\/\//i.test(candidate.value) || /\b(?:www|tsetmc|codal)\b/i.test(candidate.value)) {
    return { ...candidate, rejectedReason: 'candidate is URL/domain-like' };
  }
  if (!isLikelyPersianSymbol(candidate.value)) {
    return { ...candidate, rejectedReason: 'candidate is not a Persian stock symbol shape' };
  }

  return candidate;
}

function symbolPatternMatches(text: string): string[] {
  return tsetmcSymbolPatterns.flatMap((pattern) =>
    Array.from(text.matchAll(new RegExp(pattern.source, 'g'))).map((match) => match[1]).filter(Boolean)
  );
}

export function extractTsetmcSymbolDiagnostics(documentRef: Document, href: string): TsetmcSymbolDiagnostics {
  const insCode = detectInsCodeFromUrl(href);
  const candidates: TsetmcSymbolCandidate[] = [];
  const rejectedCandidates: TsetmcSymbolCandidate[] = [];

  function add(value: string | undefined, source: TsetmcSymbolCandidateSource, context: string): TsetmcSymbolCandidate | undefined {
    const candidate = validateSymbolCandidate(value, source, context, insCode);
    if (candidate.rejectedReason) {
      rejectedCandidates.push(candidate);
      return undefined;
    }
    candidates.push(candidate);
    return candidate;
  }

  const fromUrl = detectSymbolFromUrl(href);
  if (fromUrl.symbol) {
    const selected = add(fromUrl.symbol, 'url', href);
    if (selected) return { selected, candidates, rejectedCandidates };
  }

  const headerNodes = Array.from(
    documentRef.querySelectorAll('.bigheader, .header.bigheader, #MainBox h1, #MainBox h2, h1, h2')
  );
  for (const node of headerNodes) {
    const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    for (const value of symbolPatternMatches(text)) {
      const selected = add(value, 'header', text);
      if (selected) return { selected, candidates, rejectedCandidates };
    }
  }

  const titleText = documentRef.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  for (const value of symbolPatternMatches(titleText)) {
    const selected = add(value, 'title', titleText);
    if (selected) return { selected, candidates, rejectedCandidates };
  }

  for (const selector of ['[data-symbol]', '.instrument-symbol', '#symbol']) {
    const element = documentRef.querySelector(selector);
    const rawValue = element?.getAttribute('data-symbol') ?? element?.textContent?.trim();
    const selected = add(rawValue, 'trusted-dom', `${selector}: ${rawValue ?? ''}`);
    if (selected) return { selected, candidates, rejectedCandidates };
  }

  const fromDocument = detectSymbolFromDocument(documentRef);
  if (fromDocument.symbol) {
    add(fromDocument.symbol, 'trusted-dom', 'legacy document symbol fallback');
  }

  return { candidates, rejectedCandidates };
}

export function detectInsCodeFromUrl(href: string): string | undefined {
  try {
    const parsed = new URL(href);
    const queryValue = parsed.searchParams.get('i') ?? parsed.searchParams.get('insCode');
    if (queryValue && /^\d{5,}$/.test(queryValue)) {
      return queryValue;
    }

    const instInfoMatch = parsed.pathname.match(/\/instInfo\/(\d{5,})/i);
    return instInfoMatch?.[1];
  } catch {
    return undefined;
  }
}

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
  const diagnostics = extractTsetmcSymbolDiagnostics(documentRef, href);
  if (!diagnostics.selected) {
    return { source: 'unknown' };
  }

  return {
    symbol: diagnostics.selected.value,
    source: diagnostics.selected.source === 'url' ? 'url' : 'dom'
  };
}

function normalizeIssuerText(value: string): string {
  return normalizePersianArabicDigits(value)
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/[()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeTsetmcIssuerName(
  value: string | undefined,
  options: { symbol?: string; currentPrice?: number } = {}
): string | undefined {
  if (!value) return undefined;

  const trimmed = value.replace(/\s+/g, ' ').trim();
  const normalized = normalizeIssuerText(trimmed);
  if (!normalized || normalized === '()') return undefined;
  if (isTsetmcSiteLabel(normalized) || isKnownUiSymbolLabel(normalized)) return undefined;
  if (isLikelyInsCode(normalized) || /^\d[\d,.\s]*$/.test(normalized)) return undefined;

  const symbol = normalizeIssuerText(options.symbol ?? '');
  const numericTokens = normalized.match(/[+-]?(?:\d{1,3}(?:[,٬]\d{3})+|\d+)(?:[٫.]\d+)?/g) ?? [];
  const containsPrice = numericTokens.some((token) => {
    const parsed = parseLocalizedNumber(token);
    return parsed !== undefined && parsed === options.currentPrice;
  });
  if (containsPrice) return undefined;
  if (symbol && new RegExp(`^${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d`).test(normalized)) return undefined;
  if (/^[\u0600-\u06ffA-Za-z0-9_-]{2,24}\s+\d{1,3}(?:[,٬]\d{3})+/.test(normalized)) return undefined;
  if (numericTokens.length > 0 && normalized.replace(/[^\d۰-۹٠-٩]/g, '').length > normalized.replace(/\s/g, '').length / 2) {
    return undefined;
  }

  return trimmed;
}

export function readInstrumentNameFromDocument(
  documentRef: Document,
  options: { symbol?: string; currentPrice?: number } = {}
): string | undefined {
  const headerText = Array.from(
    documentRef.querySelectorAll('.bigheader, .header.bigheader, #MainBox h1, #MainBox h2, h1, h2, title')
  )
    .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .find((text) => text.length > 0 && !isTsetmcSiteLabel(text));

  const name = headerText?.replace(/\([^)]+\)/g, '').replace(/\s+-\s+.*$/, '').trim();
  return sanitizeTsetmcIssuerName(name, options);
}

function normalizeDomText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizedDigitLength(value: string): number {
  return value.replace(/[^\d۰-۹٠-٩]/g, '').length;
}

function validPriceToken(rawText: string): { value?: number; rejectedReason?: string } {
  const digits = normalizedDigitLength(rawText);
  if (digits >= 12) {
    return { rejectedReason: 'candidate looks like an InsCode or concatenated identifier' };
  }
  if (digits > 8) {
    return { rejectedReason: 'candidate has more than 8 digits' };
  }
  if (/[٫.]/.test(rawText)) {
    return { rejectedReason: 'candidate looks like a decimal change/percent, not a price' };
  }

  const value = parseLocalizedNumber(rawText);
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return { rejectedReason: 'candidate is not a positive integer price' };
  }
  if (value > 99_999_999) {
    return { rejectedReason: 'candidate is outside supported price range' };
  }

  return { value };
}

export function extractPriceCandidatesFromText(
  text: string,
  source: TsetmcDomPriceSource,
  labelText = text
): { candidates: TsetmcPriceCandidate[]; rejectedCandidates: TsetmcPriceCandidate[] } {
  const compact = normalizeDomText(text);
  const tokenPattern = /[+-]?(?:[۰-۹٠-٩\d]{1,3}(?:[,٬][۰-۹٠-٩\d]{3})+|[۰-۹٠-٩\d]+)(?:[٫.][۰-۹٠-٩\d]+)?/g;
  const candidates: TsetmcPriceCandidate[] = [];
  const rejectedCandidates: TsetmcPriceCandidate[] = [];

  for (const match of compact.matchAll(tokenPattern)) {
    const rawText = match[0];
    const validated = validPriceToken(rawText);
    const candidate: TsetmcPriceCandidate = {
      value: validated.value,
      rawText,
      source,
      labelText: normalizeDomText(labelText).slice(0, 160),
      confidence: source === 'dom-selector' ? 'medium' : 'high',
      rejectedReason: validated.rejectedReason
    };
    if (validated.value !== undefined) {
      candidates.push(candidate);
    } else {
      rejectedCandidates.push(candidate);
    }
  }

  return { candidates, rejectedCandidates };
}

function extractFirstPriceAfterLabel(
  text: string,
  label: string,
  source: TsetmcDomPriceSource
): { selected?: TsetmcPriceCandidate; candidates: TsetmcPriceCandidate[]; rejectedCandidates: TsetmcPriceCandidate[] } {
  const compact = normalizeDomText(text);
  const labelIndex = compact.indexOf(label);
  if (labelIndex < 0) {
    return { candidates: [], rejectedCandidates: [] };
  }

  const afterLabel = compact.slice(labelIndex + label.length);
  const nextLabelIndex = afterLabel.search(/آخرین معامله|قیمت پایانی|قیمت دیروز|بازه مجاز|تعداد معاملات|حجم معاملات/);
  const scopedText = nextLabelIndex > 0 ? afterLabel.slice(0, nextLabelIndex) : afterLabel;
  const extracted = extractPriceCandidatesFromText(scopedText, source, compact);
  return {
    selected: extracted.candidates[0],
    candidates: extracted.candidates,
    rejectedCandidates: extracted.rejectedCandidates
  };
}

function readLabeledPriceFromRows(
  documentRef: Document,
  label: string,
  source: TsetmcDomPriceSource
): { selected?: TsetmcPriceCandidate; candidates: TsetmcPriceCandidate[]; rejectedCandidates: TsetmcPriceCandidate[] } {
  const rows = Array.from(documentRef.querySelectorAll('#TopBox tr, #MainContent tr, #MainBox tr, tr'))
    .map((node) => node.textContent ?? '')
    .filter((text) => text.includes(label));

  const candidates: TsetmcPriceCandidate[] = [];
  const rejectedCandidates: TsetmcPriceCandidate[] = [];
  for (const rowText of rows) {
    const extracted = extractFirstPriceAfterLabel(rowText, label, source);
    candidates.push(...extracted.candidates);
    rejectedCandidates.push(...extracted.rejectedCandidates);
    if (extracted.selected) {
      return { selected: extracted.selected, candidates, rejectedCandidates };
    }
  }

  return { candidates, rejectedCandidates };
}

function readSelectorPriceCandidates(documentRef: Document): {
  selected?: TsetmcPriceCandidate;
  candidates: TsetmcPriceCandidate[];
  rejectedCandidates: TsetmcPriceCandidate[];
} {
  const candidates: TsetmcPriceCandidate[] = [];
  const rejectedCandidates: TsetmcPriceCandidate[] = [];
  for (const selector of priceSelectors) {
    const text = documentRef.querySelector(selector)?.textContent;
    if (!text) {
      continue;
    }
    const extracted = extractPriceCandidatesFromText(text, 'dom-selector');
    candidates.push(...extracted.candidates);
    rejectedCandidates.push(...extracted.rejectedCandidates);
    if (extracted.candidates.length === 1) {
      return { selected: extracted.candidates[0], candidates, rejectedCandidates };
    }
  }

  return { candidates, rejectedCandidates };
}

export function extractCurrentPriceFromTsetmcDom(documentRef: Document): TsetmcDomPriceExtractionResult {
  const candidates: TsetmcPriceCandidate[] = [];
  const rejectedCandidates: TsetmcPriceCandidate[] = [];

  const latest = readLabeledPriceFromRows(documentRef, 'آخرین معامله', 'dom-latest-trade');
  candidates.push(...latest.candidates);
  rejectedCandidates.push(...latest.rejectedCandidates);
  if (latest.selected) {
    return {
      selected: latest.selected,
      latestTrade: latest.selected,
      candidates,
      rejectedCandidates
    };
  }

  const closing = readLabeledPriceFromRows(documentRef, 'قیمت پایانی', 'dom-closing-price');
  candidates.push(...closing.candidates);
  rejectedCandidates.push(...closing.rejectedCandidates);
  if (closing.selected) {
    return {
      selected: closing.selected,
      closingPrice: closing.selected,
      candidates,
      rejectedCandidates
    };
  }

  const selector = readSelectorPriceCandidates(documentRef);
  candidates.push(...selector.candidates);
  rejectedCandidates.push(...selector.rejectedCandidates);
  if (selector.selected) {
    return { selected: selector.selected, candidates, rejectedCandidates };
  }

  const labeledBlocks = Array.from(documentRef.querySelectorAll('td, span, div'))
    .map((node) => node.textContent?.trim() ?? '')
    .filter((text) => /آخرین معامله|قیمت پایانی/.test(text));

  for (const text of labeledBlocks) {
    const source = text.includes('آخرین معامله') ? 'dom-latest-trade' : 'dom-closing-price';
    const label = source === 'dom-latest-trade' ? 'آخرین معامله' : 'قیمت پایانی';
    const extracted = extractFirstPriceAfterLabel(text, label, source);
    candidates.push(...extracted.candidates);
    rejectedCandidates.push(...extracted.rejectedCandidates);
    if (extracted.selected) {
      return { selected: extracted.selected, candidates, rejectedCandidates };
    }
  }

  return { candidates, rejectedCandidates };
}

export function readCurrentPriceFromDocument(documentRef: Document): number | undefined {
  return extractCurrentPriceFromTsetmcDom(documentRef).selected?.value;
}

export function readClosingPriceFromDocument(documentRef: Document): number | undefined {
  return readLabeledPriceFromRows(documentRef, 'قیمت پایانی', 'dom-closing-price').selected?.value;
}

export function snapshotTsetmcPage(documentRef: Document, href: string): TsetmcPageSnapshot {
  const insCode = detectInsCodeFromUrl(href);
  const symbolDiagnostics = extractTsetmcSymbolDiagnostics(documentRef, href);
  const symbol = sanitizeDetectedSymbol(symbolDiagnostics.selected?.value, insCode);
  const price = extractCurrentPriceFromTsetmcDom(documentRef);

  return {
    displaySymbol: symbol,
    codalSymbol: isLikelyPersianSymbol(symbol) ? symbol : undefined,
    instrumentName: readInstrumentNameFromDocument(documentRef, { symbol, currentPrice: price.selected?.value }),
    insCode,
    symbolSource: symbolDiagnostics.selected?.source === 'url' ? 'url' : symbol ? 'dom' : 'unknown',
    currentPrice: price.selected?.value,
    currentPriceSource:
      price.selected?.source === 'dom-latest-trade'
        ? 'dom-latest-trade'
        : price.selected?.source === 'dom-closing-price'
          ? 'dom-closing-price'
          : 'unknown',
    closingPrice: readClosingPriceFromDocument(documentRef),
    symbolDiagnostics,
    capturedAt: new Date().toISOString()
  };
}
