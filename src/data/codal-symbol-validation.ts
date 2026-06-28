import { normalizePersianArabicDigits } from '../core/number-utils';

const invalidExactSymbols = new Set(['TSETMC', 'نامشخص', 'نمادنامشخص', 'UNKNOWN', 'N/A', 'NA']);

export interface CodalSymbolValidationResult {
  valid: boolean;
  symbol?: string;
  reason?: string;
}

export function normalizeCodalSymbolCandidate(symbol: string | null | undefined): string {
  return normalizePersianArabicDigits(symbol ?? '')
    .replace(/\u200c/g, '')
    .trim();
}

export function validateCodalSearchSymbol(symbol: string | null | undefined): CodalSymbolValidationResult {
  const normalized = normalizeCodalSymbolCandidate(symbol);
  const upper = normalized.toUpperCase();

  if (!normalized) {
    return { valid: false, reason: 'نماد معتبر تشخیص داده نشد؛ جستجوی کدال انجام نشد' };
  }

  if (invalidExactSymbols.has(upper) || normalized.includes('نامشخص')) {
    return { valid: false, reason: 'نماد معتبر تشخیص داده نشد؛ جستجوی کدال انجام نشد' };
  }

  if (normalized.startsWith('InsCode:') || /^\d+$/.test(normalized)) {
    return { valid: false, reason: 'نماد معتبر تشخیص داده نشد؛ جستجوی کدال انجام نشد' };
  }

  if (/https?:\/\//i.test(normalized) || /\b(?:tsetmc|codal|www)\b/i.test(normalized)) {
    return { valid: false, reason: 'نماد معتبر تشخیص داده نشد؛ جستجوی کدال انجام نشد' };
  }

  if (/[./\\?#=&]/.test(normalized)) {
    return { valid: false, reason: 'نماد معتبر تشخیص داده نشد؛ جستجوی کدال انجام نشد' };
  }

  if (!/[\u0600-\u06ff]/.test(normalized)) {
    return { valid: false, reason: 'نماد معتبر تشخیص داده نشد؛ جستجوی کدال انجام نشد' };
  }

  if (!/^[\u0600-\u06ffA-Za-z0-9_-]{2,24}$/.test(normalized)) {
    return { valid: false, reason: 'نماد معتبر تشخیص داده نشد؛ جستجوی کدال انجام نشد' };
  }

  return { valid: true, symbol: normalized };
}
