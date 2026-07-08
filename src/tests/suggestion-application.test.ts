import { describe, expect, it } from 'vitest';
import { analyzeNavCompleteness, calculateNav, emptyNavInputs } from '../core/nav-calculator';
import { getManualOverride, saveManualOverride } from '../data/cache-store';
import type { ExtractedPortfolioValue, MonthlyActivityParseResult } from '../data/codal-monthly-parser';
import type { ManualOverrideRecord } from '../data/manual-overrides';
import { manualFieldMetadata, normalizeManualOverrideRecord } from '../data/manual-overrides';
import {
  applyHighConfidenceSuggestionsToRecord,
  applySuggestionToRecord,
  markFieldAsManual,
  resetCodalSuggestionFields
} from '../data/suggestion-application';

function suggestion(
  kind: ExtractedPortfolioValue['kind'],
  value: number,
  confidence: ExtractedPortfolioValue['confidence'] = 'high',
  unit?: string
): ExtractedPortfolioValue {
  return {
    kind,
    label: kind,
    value,
    rawText: String(value),
    confidence,
    unit,
    sourceTableIndex: 0,
    warning: confidence === 'low' ? 'low confidence' : undefined
  };
}

function monthlyResult(extractedValues: ExtractedPortfolioValue[]): MonthlyActivityParseResult {
  return {
    status: 'parsed',
    reportTitle: 'گزارش فعالیت ماهانه',
    reportPeriod: '1405/03/31',
    tableCandidates: [],
    tablePreviews: [],
    extractedValues,
    primarySuggestions: extractedValues,
    secondarySuggestions: [],
    diagnostics: {
      reportTitle: 'گزارش فعالیت ماهانه',
      reportDate: '1405/03/31',
      detectedTableCount: 0,
      parserStatus: 'parsed',
      parserWarnings: [],
      extractedCandidates: extractedValues,
      rejectedCandidates: [],
      tables: []
    },
    warnings: [],
    parsedAt: '2026-06-28T00:00:00.000Z'
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
    const applied = applySuggestionToRecord(record(), suggestion('listedPortfolioMarketValue', 2500, 'high', 'میلیون ریال'), {
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
      confidence: 'high',
      unit: 'میلیون ریال'
    });
  });

  it('applies all high-confidence suggestions but skips low-confidence suggestions', () => {
    const parseResult = monthlyResult([
      suggestion('listedPortfolioCostValue', 1000, 'high'),
      suggestion('listedPortfolioMarketValue', 1500, 'high'),
      suggestion('unlistedPortfolioSurplusSuggestion', 800, 'low')
    ]);

    const applied = applyHighConfidenceSuggestionsToRecord(record(), parseResult, {
      symbol: 'وغدیر',
      currentPriceSource: 'manual',
      reportTitle: parseResult.reportTitle,
      reportDate: parseResult.reportPeriod,
      appliedAt: '2026-06-28T10:00:00.000Z'
    });

    expect(applied.inputs.listedPortfolioCostValue).toBe(1000);
    expect(applied.inputs.listedPortfolioMarketValue).toBe(1500);
    expect(applied.inputs.unlistedPortfolioSurplus).toBeUndefined();
    expect(applied.fieldSources?.unlistedPortfolioSurplus).toBeUndefined();
  });

  it('treats legacy plain zero fields without metadata as missing', () => {
    const legacy: ManualOverrideRecord = {
      symbol: 'وصندوق',
      inputs: {
        equity: 0,
        listedPortfolioMarketValue: 0,
        listedPortfolioCostValue: 0,
        unlistedPortfolioSurplus: 0,
        totalShares: 0
      },
      currentPriceSource: 'manual',
      updatedAt: '2026-06-28T00:00:00.000Z'
    };

    const normalized = normalizeManualOverrideRecord(legacy);

    expect(normalized.inputs.equity).toBeUndefined();
    expect(normalized.inputs.listedPortfolioMarketValue).toBeUndefined();
    expect(normalized.inputs.listedPortfolioCostValue).toBeUndefined();
    expect(normalized.inputs.unlistedPortfolioSurplus).toBeUndefined();
    expect(normalized.inputs.totalShares).toBeUndefined();
  });

  it('keeps user-entered zero when manual metadata exists', () => {
    const recordWithExplicitZero: ManualOverrideRecord = {
      symbol: 'وصندوق',
      inputs: {
        equity: 100,
        listedPortfolioMarketValue: 0,
        listedPortfolioCostValue: 50,
        unlistedPortfolioSurplus: 0,
        totalShares: 10
      },
      currentPriceSource: 'manual',
      updatedAt: '2026-06-28T00:00:00.000Z',
      fieldSources: {
        listedPortfolioMarketValue: manualFieldMetadata(0, '2026-06-28T00:00:00.000Z'),
        unlistedPortfolioSurplus: manualFieldMetadata(0, '2026-06-28T00:00:00.000Z')
      }
    };

    const normalized = normalizeManualOverrideRecord(recordWithExplicitZero);
    const analysis = analyzeNavCompleteness(normalized.inputs);

    expect(normalized.inputs.listedPortfolioMarketValue).toBe(0);
    expect(normalized.inputs.unlistedPortfolioSurplus).toBe(0);
    expect(analysis.explicitZeroFields).toEqual(
      expect.arrayContaining(['listedPortfolioMarketValue', 'unlistedPortfolioSurplus'])
    );
    expect(analysis.warnings).toContain(
      'ارزش روز پرتفوی بورسی صفر ثبت شده در حالی که بهای تمام‌شده مثبت است؛ مقدار را بررسی کنید.'
    );
  });

  it('applying Codal cost to a legacy zero record does not make other fields explicit zero', () => {
    const legacy: ManualOverrideRecord = {
      symbol: 'وصندوق',
      inputs: {
        equity: 0,
        listedPortfolioMarketValue: 0,
        listedPortfolioCostValue: 0,
        unlistedPortfolioSurplus: 0,
        totalShares: 0
      },
      currentPriceSource: 'manual',
      updatedAt: '2026-06-28T00:00:00.000Z'
    };

    const applied = applySuggestionToRecord(legacy, suggestion('listedPortfolioCostValue', 136_494_769), {
      symbol: 'وصندوق',
      currentPriceSource: 'manual',
      appliedAt: '2026-06-28T10:00:00.000Z'
    });
    const analysis = analyzeNavCompleteness(applied.inputs);

    expect(applied.inputs.listedPortfolioCostValue).toBe(136_494_769);
    expect(applied.inputs.listedPortfolioMarketValue).toBeUndefined();
    expect(applied.inputs.equity).toBeUndefined();
    expect(applied.inputs.totalShares).toBeUndefined();
    expect(analysis.navTotalAvailable).toBe(false);
    expect(analysis.explicitZeroFields).toEqual([]);
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
      appliedAt: '2026-06-28T11:00:00.000Z',
      touchedByUser: true
    });
  });

  it('recalculates NAV from applied manual inputs', () => {
    const applied = applyHighConfidenceSuggestionsToRecord(
      record(),
      monthlyResult([
        suggestion('listedPortfolioCostValue', 1000),
        suggestion('listedPortfolioMarketValue', 1600)
      ]),
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

  it('persists complete manual-only NAV inputs as manual source of truth', async () => {
    const savedRecord: ManualOverrideRecord = {
      symbol: 'manual-baseline-symbol',
      inputs: {
        equity: 1_000_000_000,
        listedPortfolioMarketValue: 700_000_000,
        listedPortfolioCostValue: 500_000_000,
        unlistedPortfolioSurplus: 0,
        totalShares: 1_000_000,
        currentPrice: 1_500
      },
      currentPriceSource: 'manual',
      updatedAt: '2026-07-06T00:00:00.000Z',
      fieldSources: {
        equity: manualFieldMetadata(1_000_000_000, '2026-07-06T00:00:00.000Z'),
        listedPortfolioMarketValue: manualFieldMetadata(700_000_000, '2026-07-06T00:00:00.000Z'),
        listedPortfolioCostValue: manualFieldMetadata(500_000_000, '2026-07-06T00:00:00.000Z'),
        unlistedPortfolioSurplus: manualFieldMetadata(0, '2026-07-06T00:00:00.000Z'),
        totalShares: manualFieldMetadata(1_000_000, '2026-07-06T00:00:00.000Z'),
        currentPrice: manualFieldMetadata(1_500, '2026-07-06T00:00:00.000Z')
      }
    };

    await saveManualOverride(savedRecord);
    const restored = await getManualOverride('manual-baseline-symbol');

    expect(restored?.inputs).toEqual(savedRecord.inputs);
    expect(restored?.fieldSources?.equity?.source).toBe('manual');
    expect(restored?.fieldSources?.listedPortfolioMarketValue?.source).toBe('manual');
    expect(restored?.fieldSources?.unlistedPortfolioSurplus?.source).toBe('manual');
    expect(calculateNav(restored?.inputs ?? emptyNavInputs())).toEqual({
      navTotal: 1_200_000_000,
      navPerShare: 1_200,
      pToNav: 1.25
    });
  });

  it('reset Codal-applied values only clears Codal suggestion fields', () => {
    const current = applySuggestionToRecord(record(), suggestion('listedPortfolioCostValue', 900), {
      symbol: 'وغدیر',
      currentPriceSource: 'manual',
      appliedAt: '2026-06-28T10:00:00.000Z'
    });
    const withManual = markFieldAsManual(current, 'equity', 2000, '2026-06-28T11:00:00.000Z');

    const reset = resetCodalSuggestionFields(withManual, '2026-06-28T12:00:00.000Z');

    expect(reset.inputs.listedPortfolioCostValue).toBeUndefined();
    expect(reset.fieldSources?.listedPortfolioCostValue).toBeUndefined();
    expect(reset.inputs.equity).toBe(2000);
    expect(reset.fieldSources?.equity?.source).toBe('manual');
    expect(reset.updatedAt).toBe('2026-06-28T12:00:00.000Z');
  });

  it('reset suggested values preserves manual fields and user-confirmed zero', () => {
    const withSuggestion = applySuggestionToRecord(record(), suggestion('listedPortfolioCostValue', 900), {
      symbol: 'وغدیر',
      currentPriceSource: 'manual',
      appliedAt: '2026-07-06T10:00:00.000Z'
    });
    const withManualMarket = markFieldAsManual(
      withSuggestion,
      'listedPortfolioMarketValue',
      1_100,
      '2026-07-06T11:00:00.000Z'
    );
    const withManualZero = markFieldAsManual(
      withManualMarket,
      'unlistedPortfolioSurplus',
      0,
      '2026-07-06T11:05:00.000Z'
    );

    const reset = resetCodalSuggestionFields(withManualZero, '2026-07-06T12:00:00.000Z');

    expect(reset.inputs.listedPortfolioCostValue).toBeUndefined();
    expect(reset.inputs.listedPortfolioMarketValue).toBe(1_100);
    expect(reset.fieldSources?.listedPortfolioMarketValue?.source).toBe('manual');
    expect(reset.inputs.unlistedPortfolioSurplus).toBe(0);
    expect(reset.fieldSources?.unlistedPortfolioSurplus?.source).toBe('manual');
  });

  it('applies equity suggestions without completing NAV by itself', () => {
    const applied = applySuggestionToRecord(undefined, suggestion('equitySuggestion', 1_200_000), {
      symbol: 'وصندوق',
      currentPriceSource: 'manual',
      sourceKind: 'codal-financial-suggestion',
      appliedAt: '2026-06-28T10:00:00.000Z'
    });
    const analysis = analyzeNavCompleteness(applied.inputs);

    expect(applied.inputs.equity).toBe(1_200_000);
    expect(applied.fieldSources?.equity?.source).toBe('codal-financial-suggestion');
    expect(analysis.navTotalAvailable).toBe(false);
    expect(analysis.missingFields).toEqual(
      expect.arrayContaining(['listedPortfolioMarketValue', 'listedPortfolioCostValue', 'unlistedPortfolioSurplus'])
    );
  });

  it('reset applied suggestions clears Codal financial equity suggestions', () => {
    const applied = applySuggestionToRecord(undefined, suggestion('equitySuggestion', 1_200_000), {
      symbol: 'وصندوق',
      currentPriceSource: 'manual',
      sourceKind: 'codal-financial-suggestion',
      appliedAt: '2026-06-28T10:00:00.000Z'
    });

    const reset = resetCodalSuggestionFields(applied, '2026-06-28T11:00:00.000Z');

    expect(reset.inputs.equity).toBeUndefined();
    expect(reset.fieldSources?.equity).toBeUndefined();
  });

  it('applies total share suggestions without completing NAV by itself', () => {
    const applied = applySuggestionToRecord(undefined, suggestion('totalSharesSuggestion', 9_000_000_000), {
      symbol: 'وصندوق',
      currentPriceSource: 'manual',
      sourceKind: 'tsetmc-suggestion',
      appliedAt: '2026-06-28T10:00:00.000Z'
    });
    const analysis = analyzeNavCompleteness(applied.inputs);

    expect(applied.inputs.totalShares).toBe(9_000_000_000);
    expect(applied.fieldSources?.totalShares?.source).toBe('tsetmc-suggestion');
    expect(analysis.navTotalAvailable).toBe(false);
    expect(calculateNav(applied.inputs).navPerShare).toBe(0);
  });

  it('reset applied suggestions clears TSETMC suggestion fields too', () => {
    const applied = applySuggestionToRecord(undefined, suggestion('totalSharesSuggestion', 9_000_000_000), {
      symbol: 'وصندوق',
      currentPriceSource: 'manual',
      sourceKind: 'tsetmc-suggestion',
      appliedAt: '2026-06-28T10:00:00.000Z'
    });

    const reset = resetCodalSuggestionFields(applied, '2026-06-28T11:00:00.000Z');

    expect(reset.inputs.totalShares).toBeUndefined();
    expect(reset.fieldSources?.totalShares).toBeUndefined();
  });
});
