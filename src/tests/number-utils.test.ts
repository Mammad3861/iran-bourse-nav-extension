import { describe, expect, it } from 'vitest';
import { normalizePersianArabicDigits, parseLocalizedNumber } from '../core/number-utils';

describe('normalizePersianArabicDigits', () => {
  it('normalizes Persian digits', () => {
    expect(normalizePersianArabicDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
  });

  it('normalizes Arabic digits', () => {
    expect(normalizePersianArabicDigits('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890');
  });

  it('normalizes localized decimal and thousands separators', () => {
    expect(normalizePersianArabicDigits('۱۲٬۳۴۵٫۶۷')).toBe('12,345.67');
  });
});

describe('parseLocalizedNumber', () => {
  it('parses Persian formatted numbers', () => {
    expect(parseLocalizedNumber('۱۲٬۳۴۵٫۶۷')).toBe(12345.67);
  });

  it('parses Arabic formatted numbers with whitespace', () => {
    expect(parseLocalizedNumber(' ١٢ ٣٤٥ ')).toBe(12345);
  });

  it('ignores currency labels and non-numeric text', () => {
    expect(parseLocalizedNumber('۱,۲۵۰ ریال')).toBe(1250);
  });

  it('returns undefined for invalid values', () => {
    expect(parseLocalizedNumber('---')).toBeUndefined();
    expect(parseLocalizedNumber('')).toBeUndefined();
    expect(parseLocalizedNumber('متن بدون عدد')).toBeUndefined();
    expect(parseLocalizedNumber(null)).toBeUndefined();
  });

  it('parses comma and Persian thousands separators', () => {
    expect(parseLocalizedNumber('1,234,567')).toBe(1_234_567);
    expect(parseLocalizedNumber('۱٬۲۳۴٬۵۶۷')).toBe(1_234_567);
  });

  it('keeps very large finite numbers within the app number model', () => {
    expect(parseLocalizedNumber('۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۱')).toBe(9_007_199_254_740_991);
  });
});
