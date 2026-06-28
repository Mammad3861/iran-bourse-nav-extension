import { normalizePersianArabicDigits } from './number-utils';

export interface SymbolDetectionResult {
  symbol?: string;
  source: 'url' | 'dom' | 'unknown';
}

const symbolParamNames = ['symbol', 'Symbol', 'inscode', 'i'];

export function normalizeSymbol(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizePersianArabicDigits(value)
    .replace(/[^\u0600-\u06ffA-Za-z0-9_-]/g, '')
    .trim();

  return normalized || undefined;
}

export function detectSymbolFromUrl(url: string): SymbolDetectionResult {
  try {
    const parsed = new URL(url);
    for (const name of symbolParamNames) {
      const value = normalizeSymbol(parsed.searchParams.get(name));
      if (value) {
        return { symbol: value, source: 'url' };
      }
    }

    const pathCandidate = parsed.pathname
      .split('/')
      .map((part) => decodeURIComponent(part))
      .map(normalizeSymbol)
      .find((part) => part && /[\u0600-\u06ffA-Za-z]/.test(part));

    if (pathCandidate) {
      return { symbol: pathCandidate, source: 'url' };
    }
  } catch {
    return { source: 'unknown' };
  }

  return { source: 'unknown' };
}

export function detectSymbolFromDocument(documentRef: Document): SymbolDetectionResult {
  const selectors = [
    '[data-symbol]',
    '.symbol',
    '#symbol',
    '.instrument-symbol',
    'h1',
    'title'
  ];

  for (const selector of selectors) {
    const element = documentRef.querySelector(selector);
    const rawValue =
      element?.getAttribute('data-symbol') ?? element?.textContent?.split(/[\s|-]/)[0] ?? undefined;
    const symbol = normalizeSymbol(rawValue);
    if (symbol) {
      return { symbol, source: 'dom' };
    }
  }

  return { source: 'unknown' };
}

export function storageKeyForSymbol(symbol: string): string {
  return `manual-nav:${symbol}`;
}
