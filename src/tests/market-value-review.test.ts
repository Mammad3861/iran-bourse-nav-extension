import { describe, expect, it } from 'vitest';
import { analyzeNavCompleteness } from '../core/nav-calculator';
import type { ExtractedPortfolioValue, MonthlyActivityParseResult } from '../data/codal-monthly-parser';
import { manualReviewMarketValueCandidates } from '../data/market-value-review';
import { applySuggestionToRecord, resetCodalSuggestionFields } from '../data/suggestion-application';

function marketCandidate(overrides: Partial<ExtractedPortfolioValue> = {}): ExtractedPortfolioValue {
  return {
    kind: 'listedPortfolioMarketValue',
    label: 'ارزش بازار پرتفوی بورسی',
    value: 1_081_295_143_000_000,
    scaledValue: 1_081_295_143_000_000,
    rawText: '1,081,295,143',
    rawValue: 1_081_295_143,
    unit: 'میلیون ریال',
    unitMultiplier: 1_000_000,
    confidence: 'medium',
    sourceTableIndex: 10,
    sourceRowIndex: 4,
    sourceColumnIndex: 3,
    rowLabel: 'جمع',
    columnLabel: 'ارزش روز بازار',
    rankingScore: 132,
    ...overrides
  };
}

function result(candidates: ExtractedPortfolioValue[]): MonthlyActivityParseResult {
  return {
    status: 'ambiguous',
    reportTitle: 'گزارش فعالیت ماهانه دوره 1 ماهه',
    reportPeriod: '1405/03/31',
    tableCandidates: [],
    extractedValues: [],
    primarySuggestions: [],
    secondarySuggestions: candidates,
    tablePreviews: [],
    diagnostics: {
      reportTitle: 'گزارش فعالیت ماهانه دوره 1 ماهه',
      detectedTableCount: 1,
      parserStatus: 'ambiguous',
      parserWarnings: [],
      extractedCandidates: candidates,
      rejectedCandidates: [],
      tables: [
        {
          tableIndex: 10,
          source: 'codal-excel',
          sourceGroup: 'monthly-excel',
          rawHeaders: [],
          normalizedHeaders: [],
          firstRawRows: [],
          firstNormalizedRows: [],
          firstRows: [],
          detectedLabels: [],
          totalRowCandidates: [],
          costColumnCandidates: [],
          marketValueColumnCandidates: [],
          failureReasons: [],
          textPreview: ''
        }
      ]
    },
    warnings: ['ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.'],
    parsedAt: '2026-07-01T00:00:00.000Z'
  };
}

describe('manualReviewMarketValueCandidates', () => {
  it('shows only strong ambiguous market value candidates for manual review', () => {
    const good = marketCandidate();
    const candidates = manualReviewMarketValueCandidates(
      result([
        good,
        marketCandidate({ value: 0, rawValue: 0, rawText: '0' }),
        marketCandidate({ value: -9, rawValue: -9, rawText: '(9)' }),
        marketCandidate({ value: 5, rawValue: 5, rawText: '5', unitMultiplier: 1 }),
        marketCandidate({ rowLabel: 'شرکت نمونه' }),
        marketCandidate({ columnLabel: 'بهای تمام شده' }),
        marketCandidate({ rankingScore: 20 })
      ])
    );

    expect(candidates).toEqual([good]);
  });

  it('hides previous-period candidates when a current-period candidate exists', () => {
    const current = marketCandidate({ period: '1405/03/31', periodLabel: 'دوره مالی منتهی به 1405/03/31' });
    const previous = marketCandidate({
      value: 900,
      rawValue: 900,
      periodLabel: 'سال مالی منتهی به 1404/12/29',
      sourceColumnIndex: 4
    });

    expect(manualReviewMarketValueCandidates(result([previous, current]))).toEqual([current]);
  });

  it('applying a reviewed candidate stores manual-review metadata and does not complete NAV alone', () => {
    const candidate = marketCandidate();
    const applied = applySuggestionToRecord(undefined, candidate, {
      symbol: 'وصندوق',
      currentPriceSource: 'manual',
      reportTitle: 'گزارش فعالیت ماهانه',
      reportDate: '1405/03/31',
      sourceKind: 'codal-excel-manual-review',
      stale: true,
      appliedAt: '2026-07-01T10:00:00.000Z'
    });

    expect(applied.inputs.listedPortfolioMarketValue).toBe(candidate.value);
    expect(applied.fieldSources?.listedPortfolioMarketValue).toEqual(
      expect.objectContaining({
        source: 'codal-excel-manual-review',
        tableIndex: 10,
        rowLabel: 'جمع',
        columnLabel: 'ارزش روز بازار',
        rawValue: 1_081_295_143,
        scaledValue: 1_081_295_143_000_000,
        stale: true
      })
    );
    expect(analyzeNavCompleteness(applied.inputs).navTotalAvailable).toBe(false);

    const reset = resetCodalSuggestionFields(applied, '2026-07-01T11:00:00.000Z');
    expect(reset.inputs.listedPortfolioMarketValue).toBeUndefined();
    expect(reset.fieldSources?.listedPortfolioMarketValue).toBeUndefined();
  });
});
