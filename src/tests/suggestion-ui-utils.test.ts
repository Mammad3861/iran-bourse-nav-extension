import { describe, expect, it } from 'vitest';
import type { ExtractedPortfolioValue } from '../data/codal-monthly-parser';
import type { ManualOverrideRecord } from '../data/manual-overrides';
import {
  appliedSourceLabel,
  appliedSuggestionMessage,
  applyFailureMessage,
  candidateApplyState,
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

function marketCandidate(overrides: Partial<ExtractedPortfolioValue> = {}): ExtractedPortfolioValue {
  return {
    kind: 'listedPortfolioMarketValue',
    label: 'ارزش روز پرتفوی بورسی',
    value: 1_000_000,
    scaledValue: 1_000_000,
    rawText: '1,000,000',
    rawValue: 1_000_000,
    unit: 'میلیون ریال',
    unitMultiplier: 1_000_000,
    confidence: 'medium',
    sourceTableIndex: 3,
    sourceRowIndex: 8,
    sourceColumnIndex: 4,
    rowLabel: 'جمع',
    columnLabel: 'ارزش روز بازار',
    ...overrides
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

  it('does not mark manually entered values as applied suggestions', () => {
    const suggestion = marketCandidate();
    const record: ManualOverrideRecord = {
      symbol: 'وصندوق',
      inputs: {
        listedPortfolioMarketValue: 1_000_000
      },
      currentPriceSource: 'manual',
      updatedAt: '2026-07-01T00:00:00.000Z',
      fieldSources: {
        listedPortfolioMarketValue: {
          value: 1_000_000,
          source: 'manual',
          appliedAt: '2026-07-01T00:00:00.000Z',
          touchedByUser: true
        }
      }
    };

    expect(isSuggestionAlreadyApplied(record, suggestion, 'codal-excel-manual-review', 'گزارش فعالیت ماهانه')).toBe(false);
    expect(candidateApplyState(record, suggestion, 'codal-excel-manual-review', 'گزارش فعالیت ماهانه')).toBe('manual-present');
  });

  it('marks only the exact manual-review market candidate as applied', () => {
    const appliedCandidate = marketCandidate();
    const otherCandidate = marketCandidate({
      sourceRowIndex: 9,
      rowLabel: 'جمع کل',
      rawText: '1,000,000',
      rawValue: 1_000_000
    });
    const record: ManualOverrideRecord = {
      symbol: 'وصندوق',
      inputs: {
        listedPortfolioMarketValue: 1_000_000
      },
      currentPriceSource: 'manual',
      updatedAt: '2026-07-01T00:00:00.000Z',
      fieldSources: {
        listedPortfolioMarketValue: {
          value: 1_000_000,
          source: 'codal-excel-manual-review',
          appliedAt: '2026-07-01T00:00:00.000Z',
          reportTitle: 'گزارش فعالیت ماهانه',
          confidence: 'medium',
          unit: 'میلیون ریال',
          tableIndex: 3,
          rowLabel: 'جمع',
          columnLabel: 'ارزش روز بازار',
          rawText: '1,000,000',
          rawValue: 1_000_000,
          scaledValue: 1_000_000
        }
      }
    };

    expect(candidateApplyState(record, appliedCandidate, 'codal-excel-manual-review', 'گزارش فعالیت ماهانه')).toBe(
      'exact-applied'
    );
    expect(candidateApplyState(record, otherCandidate, 'codal-excel-manual-review', 'گزارش فعالیت ماهانه')).toBe(
      'other-suggestion-applied'
    );
  });

  it('displays legacy TSETMC total shares metadata as TSETMC', () => {
    expect(appliedSourceLabel('totalShares', {
      value: 9_000_000_000,
      source: 'codal-suggestion',
      appliedAt: '2026-07-01T00:00:00.000Z',
      reportTitle: 'TSETMC instrument info',
      columnLabel: 'zTitad / totalShares'
    })).toBe('تعداد کل سهام: اعمال‌شده از پیشنهاد TSETMC');
  });

  it('uses a reload-specific message for invalidated extension context failures', () => {
    expect(applyFailureMessage(new Error('Extension context invalidated.'))).toContain(
      'افزونه reload شده است؛ صفحه را refresh کنید'
    );
  });
});
