import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodalReportDiscoveryResult } from '../data/codal-client';
import type { MonthlyActivityParseResult } from '../data/codal-monthly-parser';
import {
  candidateAvailabilityForSmoke,
  createUnavailableNetworkParseResult,
  getParsedCodalSummary,
  markParseResultStale,
  parseResultFromParsedCache,
  saveParsedCodalSummary
} from '../data/codal-parsed-cache';

function createChromeStorageMock(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  return {
    store,
    chrome: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items);
          })
        }
      }
    }
  };
}

function discovery(): CodalReportDiscoveryResult {
  return {
    status: 'found',
    symbol: 'وصندوق',
    monthlyActivityReport: {
      symbol: 'وصندوق',
      title: 'گزارش فعالیت ماهانه وصندوق',
      tracingNo: '123',
      url: 'https://www.codal.ir/report/123'
    },
    financialStatementReport: {
      symbol: 'وصندوق',
      title: 'اطلاعات و صورت‌های مالی وصندوق'
    },
    sourceVerified: false,
    checkedAt: '2026-07-03T00:00:00.000Z'
  };
}

function parseResult(): MonthlyActivityParseResult {
  return {
    status: 'parsed',
    reportTitle: 'گزارش فعالیت ماهانه وصندوق',
    reportPeriod: '۱۴۰۵/۰۳/۳۱',
    sourceReportUrl: 'https://www.codal.ir/report/123',
    tableCandidates: [],
    extractedValues: [
      {
        kind: 'listedPortfolioCostValue',
        label: 'بهای تمام شده',
        value: 136_494_769,
        rawText: '136,494,769',
        confidence: 'high',
        sourceTableIndex: 3,
        rowLabel: 'جمع',
        columnLabel: 'بهای تمام شده'
      }
    ],
    primarySuggestions: [],
    secondarySuggestions: [
      {
        kind: 'listedPortfolioMarketValue',
        label: 'ارزش بازار',
        value: 140_000_000,
        rawText: '140,000,000',
        confidence: 'medium',
        sourceTableIndex: 8,
        rowLabel: 'جمع',
        columnLabel: 'ارزش بازار'
      }
    ],
    tablePreviews: [
      {
        index: 3,
        rawHeaders: ['شرح', 'بهای تمام شده'],
        normalizedHeaders: ['شرح', 'بهای تمام شده'],
        rawRows: [['جمع', '136,494,769']],
        normalizedRows: [['جمع', '136494769']],
        headers: ['شرح', 'بهای تمام شده'],
        rows: [['جمع', '136494769']],
        textPreview: 'large raw preview must not be cached',
        detectedLabels: ['جمع'],
        warnings: []
      }
    ],
    diagnostics: {
      detectedTableCount: 5,
      parserStatus: 'parsed',
      parserWarnings: ['ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.'],
      extractedCandidates: [],
      rejectedCandidates: [
        {
          reason: 'کاندید مبهم رد شد',
          candidate: {
            kind: 'listedPortfolioMarketValue',
            label: 'ارزش بازار',
            value: 1,
            rawText: '1',
            confidence: 'low',
            sourceTableIndex: 8
          }
        }
      ],
      tables: [
        {
          tableIndex: 3,
          rawHeaders: ['شرح', 'بهای تمام شده'],
          normalizedHeaders: ['شرح', 'بهای تمام شده'],
          firstRawRows: [['جمع', '136,494,769']],
          firstNormalizedRows: [['جمع', '136494769']],
          firstRows: [['جمع', '136494769']],
          detectedLabels: ['جمع'],
          totalRowCandidates: [],
          costColumnCandidates: [],
          marketValueColumnCandidates: [],
          failureReasons: [],
          textPreview: 'large diagnostic preview must not be cached'
        }
      ],
      sourceStrategy: {
        htmlDetailChecked: true,
        reconstructedTableChecked: true,
        excel: { status: 'fetched', tableCount: 13 },
        alternativeReportsChecked: false,
        marketValueStatus: 'ambiguous',
        messages: ['چند مقدار محتمل وجود دارد']
      }
    },
    warnings: ['چند مقدار محتمل وجود دارد'],
    parsedAt: '2026-07-03T00:00:00.000Z'
  };
}

describe('Codal parsed summary cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stores compact parsed cache after a live parse success', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);

    const record = await saveParsedCodalSummary({
      symbol: 'وصندوق',
      codalSymbol: 'وصندوق',
      discovery: discovery(),
      parseResult: parseResult()
    });

    expect(record.extractedCandidates).toHaveLength(1);
    expect(record.secondarySuggestions).toHaveLength(1);
    expect(record.marketValueStatus).toBe('ambiguous');
    expect(JSON.stringify(storage.store)).not.toContain('large raw preview');
    expect(JSON.stringify(storage.store)).not.toContain('large diagnostic preview');
  });

  it('rehydrates stale cached candidates and marks them as stale', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    await saveParsedCodalSummary({
      symbol: 'وصندوق',
      codalSymbol: 'وصندوق',
      discovery: discovery(),
      parseResult: parseResult()
    });

    const cached = await getParsedCodalSummary('وصندوق');
    const stale = markParseResultStale(parseResultFromParsedCache(cached!), cached!.cachedAt);

    expect(stale.diagnostics.parserDataStatus).toBe('stale-cache');
    expect(stale.diagnostics.staleParsedCacheUsed).toBe(true);
    expect(stale.diagnostics.candidateAvailability).toBe('stale-candidates');
    expect(stale.extractedValues[0]).toMatchObject({
      kind: 'listedPortfolioCostValue',
      value: 136_494_769
    });
  });

  it('marks no-cache network failures as unavailable rather than none-found', () => {
    const result = createUnavailableNetworkParseResult({
      symbol: 'وصندوق',
      codalSymbol: 'وصندوق'
    });

    expect(result.extractedValues).toEqual([]);
    expect(result.diagnostics.parserDataStatus).toBe('unavailable-network-error');
    expect(result.diagnostics.candidateAvailability).toBe('unavailable-network-error');
    expect(result.warnings.join(' ')).toContain('خطای اتصال');
  });

  it('distinguishes NAV candidates from basic total-share-only candidates', () => {
    const totalSharesOnly = parseResult();
    totalSharesOnly.extractedValues = [
      {
        kind: 'totalSharesSuggestion',
        label: 'تعداد کل سهام',
        value: 9_000_000_000,
        rawText: '9000000000',
        confidence: 'medium',
        sourceTableIndex: -1
      }
    ];
    totalSharesOnly.primarySuggestions = [];
    totalSharesOnly.secondarySuggestions = [];
    totalSharesOnly.diagnostics.rejectedCandidates = [];
    totalSharesOnly.diagnostics.sourceStrategy = undefined;

    expect(parseResultFromParsedCache({
      symbol: 'فولاد',
      parserStatus: totalSharesOnly.status,
      marketReviewCandidateCount: 0,
      marketReviewVisibleCandidateCount: 0,
      marketReviewHiddenCandidateCount: 0,
      extractedCandidates: totalSharesOnly.extractedValues,
      primarySuggestions: [],
      secondarySuggestions: [],
      rejectedCandidates: [],
      userFacingWarnings: [],
      parsedAt: totalSharesOnly.parsedAt,
      cachedAt: '2026-07-03T00:00:00.000Z'
    }).diagnostics.candidateAvailability).toBe('live-basic-candidates-only');

    expect(parseResultFromParsedCache({
      symbol: 'وصندوق',
      parserStatus: 'parsed',
      marketReviewCandidateCount: 0,
      marketReviewVisibleCandidateCount: 0,
      marketReviewHiddenCandidateCount: 0,
      extractedCandidates: parseResult().extractedValues,
      primarySuggestions: [],
      secondarySuggestions: [],
      rejectedCandidates: [],
      userFacingWarnings: [],
      parsedAt: totalSharesOnly.parsedAt,
      cachedAt: '2026-07-03T00:00:00.000Z'
    }).diagnostics.candidateAvailability).toBe('live-nav-candidates');
  });

  it('recomputes smoke candidate availability when live diagnostics carry an outdated value', () => {
    const totalSharesOnly = parseResult();
    totalSharesOnly.extractedValues = [
      {
        kind: 'totalSharesSuggestion',
        label: 'تعداد کل سهام',
        value: 9_000_000_000,
        rawText: '9000000000',
        confidence: 'medium',
        sourceTableIndex: -1
      }
    ];
    totalSharesOnly.primarySuggestions = [];
    totalSharesOnly.secondarySuggestions = [];
    totalSharesOnly.diagnostics.rejectedCandidates = [];
    totalSharesOnly.diagnostics.sourceStrategy = undefined;
    totalSharesOnly.diagnostics.candidateAvailability = 'live-nav-candidates';

    expect(candidateAvailabilityForSmoke({ parseResult: totalSharesOnly })).toBe('live-basic-candidates-only');
  });

  it('marks a live parse with no NAV or basic candidates as no-nav-candidates-live', () => {
    const emptyLive = parseResult();
    emptyLive.extractedValues = [];
    emptyLive.primarySuggestions = [];
    emptyLive.secondarySuggestions = [];
    emptyLive.diagnostics.rejectedCandidates = [];
    emptyLive.diagnostics.sourceStrategy = undefined;

    expect(candidateAvailabilityForSmoke({ parseResult: emptyLive })).toBe('no-nav-candidates-live');
  });

  it('filters unsafe cached equity suggestions from percentage/change columns', () => {
    const restored = parseResultFromParsedCache({
      symbol: 'وبانک',
      parserStatus: 'parsed',
      marketReviewCandidateCount: 0,
      marketReviewVisibleCandidateCount: 0,
      marketReviewHiddenCandidateCount: 0,
      extractedCandidates: [
        {
          kind: 'equitySuggestion',
          label: 'حقوق صاحبان سهام',
          value: 21_000_000,
          rawValue: 21,
          rawText: '21',
          unit: 'میلیون ریال',
          confidence: 'low',
          sourceTableIndex: 35,
          sourceColumnIndex: 1,
          rowLabel: 'حقوق مالکانه قابل انتساب به مالکان شرکت اصلی',
          columnLabel: 'درصد تغییر'
        },
        {
          kind: 'totalSharesSuggestion',
          label: 'تعداد کل سهام',
          value: 9_000_000_000,
          rawText: '9000000000',
          confidence: 'medium',
          sourceTableIndex: -1
        }
      ],
      primarySuggestions: [],
      secondarySuggestions: [],
      rejectedCandidates: [],
      userFacingWarnings: [],
      parsedAt: '2026-07-03T00:00:00.000Z',
      cachedAt: '2026-07-03T00:00:00.000Z'
    });

    expect(restored.extractedValues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'equitySuggestion' })])
    );
    expect(restored.extractedValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'totalSharesSuggestion' })])
    );
    expect(restored.diagnostics.candidateAvailability).toBe('live-basic-candidates-only');
  });
});
