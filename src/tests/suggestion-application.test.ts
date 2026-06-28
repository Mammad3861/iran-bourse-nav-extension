import { describe, expect, it } from 'vitest';
import { calculateNav, emptyNavInputs } from '../core/nav-calculator';
import { getManualOverride, saveManualOverride } from '../data/cache-store';
import type { ExtractedPortfolioValue, MonthlyActivityParseResult } from '../data/codal-monthly-parser';
import type { ManualOverrideRecord } from '../data/manual-overrides';
import {
  applyHighConfidenceSuggestionsToRecord,
  applySuggestionToRecord,
  markFieldAsManual
} from '../data/suggestion-application';

function suggestion(
  kind: ExtractedPortfolioValue['kind'],
  value: number,
  confidence: ExtractedPortfolioValue['confidence'] = 'high'
): ExtractedPortfolioValue {
  return {
    kind,
    label: kind,
    value,
    rawText: String(value),
    confidence,
    sourceTableIndex: 0,
    warning: confidence === 'low' ? 'low confidence' : undefined
  };
}

function record(): ManualOverrideRecord {
  return {
    symbol: 'وغدیر',
    inputs: {
      ...emptyNavInputs(),
      equity: 1000,
      totalShares: 100,
      currentPrice: 20
    },
    currentPriceSource: 'manual',
    updatedAt: '2026-06-28T00:00:00.000Z'
  };
}

describe('suggestion application', () => {
  it('applies one suggested value with Codal source metadata', () => {
    const applied = applySuggestionToRecord(record(), suggestion('listedPortfolioMarketValue', 2500), {
      symbol: 'وغدیر',
      currentPriceSource: 'manual',
      reportTitle: 'گزارش فعالیت ماهانه',
      reportDate: '1405/03/31',
      appliedAt: '2026-06-28T10:00:00.000Z'
    });

    expect(applied.inputs.listedPortfolioMarketValue).toBe(2500);
    expect(applied.fieldSources?.listedPortfolioMarketValue).toEqual({
      value: 2500,
      source: 'codal-suggestion',
      appliedAt: '2026-06-28T10:00:00.000Z',
      reportTitle: 'گزارش فعالیت ماهانه',
      reportDate: '1405/03/31',
      confidence: 'high'
    });
  });

  it('applies all high-confidence suggestions but skips low-confidence suggestions', () => {
    const parseResult: MonthlyActivityParseResult = {
      status: 'parsed',
      reportTitle: 'گزارش فعالیت ماهانه',
      reportPeriod: '1405/03/31',
      tableCandidates: [],
      extractedValues: [
        suggestion('listedPortfolioCostValue', 1000, 'high'),
        suggestion('listedPortfolioMarketValue', 1500, 'high'),
        suggestion('unlistedPortfolioSurplusSuggestion', 800, 'low')
      ],
      warnings: [],
      parsedAt: '2026-06-28T00:00:00.000Z'
    };

    const applied = applyHighConfidenceSuggestionsToRecord(record(), parseResult, {
      symbol: 'وغدیر',
      currentPriceSource: 'manual',
      reportTitle: parseResult.reportTitle,
      reportDate: parseResult.reportPeriod,
      appliedAt: '2026-06-28T10:00:00.000Z'
    });

    expect(applied.inputs.listedPortfolioCostValue).toBe(1000);
    expect(applied.inputs.listedPortfolioMarketValue).toBe(1500);
    expect(applied.inputs.unlistedPortfolioSurplus).toBe(0);
    expect(applied.fieldSources?.unlistedPortfolioSurplus).toBeUndefined();
  });

  it('manual edit overrides Codal source metadata', () => {
    const applied = applySuggestionToRecord(record(), suggestion('listedPortfolioMarketValue', 2500), {
      symbol: 'وغدیر',
      currentPriceSource: 'manual',
      appliedAt: '2026-06-28T10:00:00.000Z'
    });

    const edited = markFieldAsManual(
      applied,
      'listedPortfolioMarketValue',
      2600,
      '2026-06-28T11:00:00.000Z'
    );

    expect(edited.inputs.listedPortfolioMarketValue).toBe(2600);
    expect(edited.fieldSources?.listedPortfolioMarketValue).toEqual({
      value: 2600,
      source: 'manual',
      appliedAt: '2026-06-28T11:00:00.000Z'
    });
  });

  it('recalculates NAV from applied manual inputs', () => {
    const applied = applyHighConfidenceSuggestionsToRecord(
      record(),
      {
        status: 'parsed',
        tableCandidates: [],
        extractedValues: [
          suggestion('listedPortfolioCostValue', 1000),
          suggestion('listedPortfolioMarketValue', 1600)
        ],
        warnings: [],
        parsedAt: '2026-06-28T00:00:00.000Z'
      },
      {
        symbol: 'وغدیر',
        currentPriceSource: 'manual'
      }
    );

    expect(calculateNav(applied.inputs)).toEqual({
      navTotal: 1600,
      navPerShare: 16,
      pToNav: 1.25
    });
  });

  it('persists applied suggestion metadata through the manual override store', async () => {
    const applied = applySuggestionToRecord(record(), suggestion('listedPortfolioCostValue', 900), {
      symbol: 'وغدیر',
      currentPriceSource: 'manual',
      appliedAt: '2026-06-28T10:00:00.000Z'
    });

    await saveManualOverride(applied);
    const saved = await getManualOverride('وغدیر');

    expect(saved?.inputs.listedPortfolioCostValue).toBe(900);
    expect(saved?.fieldSources?.listedPortfolioCostValue?.source).toBe('codal-suggestion');
  });
});
