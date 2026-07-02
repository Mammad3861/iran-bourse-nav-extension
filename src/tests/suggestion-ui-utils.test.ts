import { describe, expect, it } from 'vitest';
import type { ExtractedPortfolioValue } from '../data/codal-monthly-parser';
import type { ManualOverrideRecord } from '../data/manual-overrides';
import {
  appliedSourceLabel,
  appliedSuggestionMessage,
  isSuggestionAlreadyApplied,
  suggestionSourceKindFor
} from '../ui/suggestion-ui-utils';

function totalSharesSuggestion(): ExtractedPortfolioValue {
  return {
    kind: 'totalSharesSuggestion',
    label: 'تعداد کل سهام',
    value: 9_000_000_000,
    rawText: '9000000000',
    confidence: 'medium',
    sourceTableIndex: -1,
    sourceTableCaption: 'TSETMC instrument info'
  };
}

describe('suggestion UI utilities', () => {
  it('labels TSETMC total share suggestions as TSETMC, not Codal', () => {
    const sourceKind = suggestionSourceKindFor(totalSharesSuggestion(), 'گزارش کدال + TSETMC instrument info');

    expect(sourceKind).toBe('tsetmc-suggestion');
    expect(appliedSourceLabel('totalShares', {
      value: 9_000_000_000,
      source: sourceKind,
      appliedAt: '2026-07-01T00:00:00.000Z'
    })).toBe('تعداد کل سهام: اعمال‌شده از پیشنهاد TSETMC');
  });

  it('creates field-specific applied messages', () => {
    expect(appliedSuggestionMessage('totalShares', 'tsetmc-suggestion')).toBe(
      'تعداد کل سهام از پیشنهاد TSETMC اعمال و ذخیره شد.'
    );
    expect(appliedSuggestionMessage('listedPortfolioCostValue', 'codal-suggestion')).toBe(
      'بهای تمام‌شده پرتفوی بورسی از پیشنهاد کدال اعمال و ذخیره شد.'
    );
    expect(appliedSuggestionMessage('listedPortfolioMarketValue', 'codal-excel-manual-review')).toBe(
      'ارزش روز پرتفوی بورسی از بررسی دستی Excel کدال اعمال و ذخیره شد.'
    );
    expect(appliedSuggestionMessage('equity', 'financial-statement-suggestion')).toBe(
      'حقوق صاحبان سهام از پیشنهاد صورت مالی اعمال و ذخیره شد.'
    );
  });

  it('detects matching already-applied suggestions', () => {
    const suggestion = totalSharesSuggestion();
    const record: ManualOverrideRecord = {
      symbol: 'وصندوق',
      inputs: {
        totalShares: 9_000_000_000
      },
      currentPriceSource: 'manual',
      updatedAt: '2026-07-01T00:00:00.000Z',
      fieldSources: {
        totalShares: {
          value: 9_000_000_000,
          source: 'tsetmc-suggestion',
          appliedAt: '2026-07-01T00:00:00.000Z'
        }
      }
    };

    expect(isSuggestionAlreadyApplied(record, suggestion, 'tsetmc-suggestion')).toBe(true);
    expect(isSuggestionAlreadyApplied(record, { ...suggestion, value: 8_000_000_000 }, 'tsetmc-suggestion')).toBe(false);
    expect(isSuggestionAlreadyApplied(record, suggestion, 'codal-suggestion')).toBe(false);
  });
});
