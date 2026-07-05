import { describe, expect, it } from 'vitest';
import type { CodalReportDiscoveryResult } from '../data/codal-client';
import type { MonthlyActivityParseResult } from '../data/codal-monthly-parser';
import type { ManualOverrideRecord } from '../data/manual-overrides';
import { buildNavCompletionSummary } from '../data/nav-completion';
import { createSmokeSummary, smokeSummaryText } from '../data/smoke-summary';

function record(): ManualOverrideRecord {
  return {
    symbol: 'وصندوق',
    inputs: {
      listedPortfolioCostValue: 136_494_769,
      totalShares: 2_700_000_000,
      currentPrice: 17_070
    },
    currentPriceSource: 'dom-latest-trade',
    updatedAt: '2026-07-02T00:00:00.000Z',
    fieldSources: {
      listedPortfolioCostValue: {
        value: 136_494_769,
        source: 'codal-suggestion',
        appliedAt: '2026-07-02T00:00:00.000Z',
        reportTitle: 'گزارش فعالیت ماهانه وصندوق',
        confidence: 'high'
      },
      totalShares: {
        value: 2_700_000_000,
        source: 'codal-suggestion',
        appliedAt: '2026-07-02T00:00:00.000Z',
        reportTitle: 'TSETMC instrument info',
        rowLabel: 'TSETMC instrument info',
        columnLabel: 'zTitad / totalShares',
        confidence: 'medium'
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
      title: 'گزارش فعالیت ماهانه دوره ۱ ماهه منتهی به ۱۴۰۵/۰۳/۳۱'
    },
    diagnostics: {
      requestedSymbol: 'وصندوق',
      monthlyActivity: {
        requestedSymbol: 'وصندوق',
        reportKind: 'monthly-activity',
        selectedReport: {
          symbol: 'وصندوق',
          title: 'گزارش فعالیت ماهانه دوره ۱ ماهه منتهی به ۱۴۰۵/۰۳/۳۱'
        },
        selectedConfidence: 'high',
        selectedWarnings: [],
        candidates: []
      },
      financialStatement: {
        requestedSymbol: 'وصندوق',
        reportKind: 'financial-statement',
        selectedConfidence: 'none',
        selectedWarnings: [],
        candidates: [
          {
            report: {
              symbol: 'وصندوق',
              title: 'گزارش رد شده فقط برای تشخیص'
            },
            score: -75,
            selected: false,
            reasons: [],
            warnings: ['هشدار تشخیصی'],
            rejectedReasons: ['رد شده']
          }
        ]
      },
      liveFetch: {
        status: 'found',
        usedCache: false,
        attemptCount: 1,
        domain: 'search.codal.ir'
      }
    },
    sourceVerified: false,
    checkedAt: '2026-07-02T00:00:00.000Z'
  };
}

function parseResult(): MonthlyActivityParseResult {
  return {
    status: 'parsed',
    reportTitle: 'گزارش فعالیت ماهانه وصندوق',
    reportPeriod: '۱۴۰۵/۰۳/۳۱',
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
        label: 'ارزش روز',
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
        textPreview: 'raw table preview must not be copied to smoke summary',
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
          reason: 'کاندید رد شده فقط در تشخیص کامل'
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
          textPreview: 'raw diagnostic table preview must not be copied to smoke summary'
        },
        {
          tableIndex: 8,
          source: 'codal-excel',
          sourceGroup: 'monthly-excel',
          rawHeaders: ['شرح', 'ارزش بازار'],
          normalizedHeaders: ['شرح', 'ارزش بازار'],
          firstRawRows: [['جمع', '140,000,000']],
          firstNormalizedRows: [['جمع', '140000000']],
          firstRows: [['جمع', '140000000']],
          detectedLabels: ['جمع', 'ارزش بازار'],
          totalRowCandidates: [],
          costColumnCandidates: [],
          marketValueColumnCandidates: [],
          failureReasons: [],
          textPreview: 'excel market table preview must not be copied'
        }
      ],
      sourceStrategy: {
        htmlDetailChecked: true,
        reconstructedTableChecked: true,
        alternativeReportsChecked: false,
        marketValueStatus: 'ambiguous',
        messages: ['ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.'],
        excel: {
          status: 'fetched',
          tableCount: 13
        }
      }
    },
    warnings: ['ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.'],
    parsedAt: '2026-07-02T00:00:00.000Z'
  };
}

describe('smoke summary', () => {
  it('copies compact regression fields without raw table diagnostics', () => {
    const currentRecord = record();
    const parsed = parseResult();
    const summary = createSmokeSummary({
      symbol: 'وصندوق',
      instrumentName: 'سرمایه‌گذاری صندوق بازنشستگی',
      insCode: '37204371816016200',
      codalSymbol: 'وصندوق',
      currentPrice: 17_070,
      currentPriceSource: 'dom-latest-trade',
      record: currentRecord,
      discovery: discovery(),
      parseResult: parsed,
      navCompletion: buildNavCompletionSummary(currentRecord, parsed),
      support: {
        status: 'likely-holding',
        reasons: ['نام ابزار شبیه شرکت سرمایه‌گذاری/هلدینگ است.']
      }
    });

    expect(summary).toMatchObject({
      symbol: 'وصندوق',
      insCode: '37204371816016200',
      currentPrice: 17_070,
      currentPriceSource: 'dom-latest-trade',
      smokeReadiness: 'ready',
      detailPipelineStatus: 'completed',
      totalSharesSource: 'tsetmc-suggestion',
      codalDiscoveryStatus: 'found',
      marketValueStatus: 'ambiguous',
      marketReviewCandidateCount: 1,
      marketReviewVisibleCandidateCount: 1,
      marketReviewHiddenCandidateCount: 0,
      marketReviewRejectedCandidateCount: 0,
      marketReviewTotalCandidateCount: 1,
      navCompletionStatus: 'incomplete',
      missingFields: ['equity', 'listedPortfolioMarketValue', 'unlistedPortfolioSurplus']
    });
    expect(summary).not.toHaveProperty('tablePreviews');
    expect(JSON.stringify(summary)).not.toContain('raw table preview');
    expect(JSON.stringify(summary)).not.toContain('raw diagnostic table preview');
    expect(JSON.stringify(summary)).not.toContain('excel market table preview');
    expect(JSON.stringify(summary)).not.toContain('گزارش رد شده فقط برای تشخیص');
  });

  it('serializes a readable smoke-test JSON payload', () => {
    const text = smokeSummaryText({
      symbol: 'فولاد',
      currentPriceSource: 'unknown',
      support: {
        status: 'unsupported',
        message: 'این نماد احتمالاً هلدینگ/سرمایه‌گذاری نیست یا داده کافی برای NAV هلدینگی پیدا نشد.',
        reasons: ['گزارش یا جدول پرتفوی/سرمایه‌گذاری قابل اتکا پیدا نشد.']
      }
    });

    expect(JSON.parse(text)).toMatchObject({
      symbol: 'فولاد',
      fetchCacheStatus: {
        status: 'not-attempted'
      },
      holdingSupport: {
        status: 'unsupported'
      }
    });
  });

  it('marks smoke as pending when reports are found but parsing has not finished', () => {
    const summary = createSmokeSummary({
      symbol: 'وصندوق',
      currentPriceSource: 'unknown',
      discovery: discovery(),
      detailPipelineStatus: 'fetching-detail',
      parserStartedAt: '2026-07-02T00:00:00.000Z'
    });

    expect(summary).toMatchObject({
      codalDiscoveryStatus: 'found',
      smokeReadiness: 'pending',
      smokeReadinessWarning: 'تحلیل گزارش هنوز کامل نشده است؛ این Smoke Summary ممکن است ناقص باشد.',
      detailPipelineStatus: 'fetching-detail',
      parserDataStatus: 'not-attempted',
      candidateAvailability: 'not-attempted',
      fetchCacheStatus: {
        status: 'found',
        liveFetch: expect.objectContaining({ status: 'found' })
      }
    });
  });

  it('marks completed no-candidate parser output as ready, not silently not-attempted', () => {
    const parsed = parseResult();
    parsed.extractedValues = [];
    parsed.secondarySuggestions = [];
    parsed.diagnostics.extractedCandidates = [];
    parsed.diagnostics.rejectedCandidates = [];
    parsed.diagnostics.sourceStrategy = {
      htmlDetailChecked: true,
      reconstructedTableChecked: true,
      alternativeReportsChecked: false,
      marketValueStatus: 'not-found',
      messages: [],
      excel: { status: 'not-requested', tableCount: 0 }
    };

    const summary = createSmokeSummary({
      symbol: 'وصندوق',
      currentPriceSource: 'unknown',
      discovery: discovery(),
      parseResult: parsed,
      detailPipelineStatus: 'completed'
    });

    expect(summary).toMatchObject({
      smokeReadiness: 'ready',
      detailPipelineStatus: 'completed',
      parserDataStatus: 'live',
      candidateAvailability: 'no-nav-candidates-live',
      extractedCandidates: []
    });
  });

  it('marks detail failures as failed and keeps the parser error visible', () => {
    const failedDiscovery = discovery();
    failedDiscovery.status = 'network-error';
    failedDiscovery.errorStatus = 'network-error';
    failedDiscovery.errorMessage = 'Failed to fetch detail';
    failedDiscovery.diagnostics!.liveFetch = {
      status: 'network-error',
      errorMessage: 'Failed to fetch detail',
      attemptCount: 1,
      domain: 'codal.ir',
      usedCache: false
    };

    const summary = createSmokeSummary({
      symbol: 'وصندوق',
      currentPriceSource: 'unknown',
      discovery: failedDiscovery,
      detailPipelineStatus: 'failed',
      parserError: 'Failed to fetch detail'
    });

    expect(summary).toMatchObject({
      smokeReadiness: 'failed',
      detailPipelineStatus: 'failed',
      parserDataStatus: 'unavailable-network-error',
      candidateAvailability: 'unavailable-network-error',
      parserError: 'Failed to fetch detail'
    });
    expect((summary.userFacingWarnings as string[]).join(' ')).toContain('ناموفق بود');
  });

  it('keeps equity suggestion diagnostic metadata in compact smoke candidates', () => {
    const parsed = parseResult();
    parsed.extractedValues = [
      {
        kind: 'equitySuggestion',
        label: 'حقوق صاحبان سهام',
        value: 3_000_000_000,
        rawText: '۳۰۰۰',
        rawValue: 3000,
        confidence: 'low',
        unit: 'نامشخص',
        unitMultiplier: 1,
        sourceTableIndex: 7,
        rowLabel: 'جمع حقوق مالکانه',
        columnLabel: 'دوره جاری / سال مالی منتهی به 1404/12/29',
        periodMatchStatus: 'exact-current-period',
        unitDetectionStatus: 'unknown',
        tableContextStatus: 'balance-sheet-strong',
        confidenceReason: 'row=exact-total; period=exact-current-period; unit=unknown; table=balance-sheet-strong',
        warning: 'واحد صورت مالی با اطمینان تشخیص داده نشد؛ مقدار خام بدون مقیاس‌گذاری پیشنهاد شده است.'
      }
    ];

    const summary = createSmokeSummary({
      symbol: 'وصندوق',
      currentPriceSource: 'unknown',
      parseResult: parsed
    });

    expect(summary).toMatchObject({
      extractedCandidates: [
        expect.objectContaining({
          kind: 'equitySuggestion',
          value: 3_000_000_000,
          rawValue: 3000,
          unit: 'نامشخص',
          unitMultiplier: 1,
          rowLabel: 'جمع حقوق مالکانه',
          columnLabel: 'دوره جاری / سال مالی منتهی به 1404/12/29',
          periodMatchStatus: 'exact-current-period',
          unitDetectionStatus: 'unknown',
          tableContextStatus: 'balance-sheet-strong',
          warnings: [expect.stringContaining('واحد صورت مالی')],
          confidenceReason: expect.stringContaining('unit=unknown')
        })
      ]
    });
  });

  it('separates visible, hidden, rejected, and total market-review counts', () => {
    const parsed = parseResult();
    parsed.secondarySuggestions = [
      {
        kind: 'listedPortfolioMarketValue',
        label: 'ارزش روز',
        value: 1,
        rawText: '1',
        rawValue: 1,
        confidence: 'medium',
        sourceTableIndex: 8,
        rowLabel: 'ردیف مبهم',
        columnLabel: 'ارزش بازار'
      }
    ];
    parsed.diagnostics.rejectedCandidates = Array.from({ length: 8 }, (_, index) => ({
      reason: `rejected market ${index}`,
      candidate: {
        kind: 'listedPortfolioMarketValue',
        label: 'ارزش روز',
        value: index + 1,
        rawText: String(index + 1),
        confidence: 'low',
        sourceTableIndex: 9
      }
    }));

    const summary = createSmokeSummary({
      symbol: 'وصندوق',
      currentPriceSource: 'unknown',
      parseResult: parsed
    });

    expect(summary).toMatchObject({
      marketReviewCandidateCount: 0,
      marketReviewVisibleCandidateCount: 0,
      marketReviewHiddenCandidateCount: 1,
      marketReviewRejectedCandidateCount: 8,
      marketReviewTotalCandidateCount: 9
    });
  });

  it('keeps stale cached parser candidates visible in smoke summaries', () => {
    const parsed = parseResult();
    parsed.diagnostics.parserDataStatus = 'stale-cache';
    parsed.diagnostics.staleParsedCacheUsed = true;
    parsed.diagnostics.parsedCacheCachedAt = '2026-07-02T00:00:00.000Z';
    parsed.diagnostics.candidateAvailability = 'stale-candidates';
    const staleDiscovery = discovery();
    staleDiscovery.status = 'stale-cache';
    staleDiscovery.usedCache = true;
    staleDiscovery.stale = true;
    staleDiscovery.cachedAt = '2026-07-02T00:00:00.000Z';
    staleDiscovery.errorStatus = 'network-error';
    staleDiscovery.errorMessage = 'Codal search failed after 3 attempt(s): Failed to fetch';
    staleDiscovery.diagnostics!.liveFetch = {
      status: 'network-error',
      usedCache: true,
      cachedAt: '2026-07-02T00:00:00.000Z',
      attemptCount: 3,
      domain: 'search.codal.ir',
      errorMessage: 'Failed to fetch'
    };

    const summary = createSmokeSummary({
      symbol: 'وصندوق',
      currentPriceSource: 'unknown',
      discovery: staleDiscovery,
      parseResult: parsed,
      detailPipelineStatus: 'stale-cache-used',
      support: {
        status: 'likely-holding',
        reasons: ['نام ابزار شبیه شرکت سرمایه‌گذاری/هلدینگ است.']
      }
    });

    expect(summary).toMatchObject({
      codalDiscoveryStatus: 'stale-cache',
      smokeReadiness: 'stale-cache',
      detailPipelineStatus: 'stale-cache-used',
      parserDataStatus: 'stale-cache',
      staleParsedCacheUsed: true,
      parsedCacheCachedAt: '2026-07-02T00:00:00.000Z',
      codalLiveFetchStatus: 'network-error',
      codalLiveFetchError: 'Failed to fetch',
      candidateAvailability: 'stale-candidates',
      extractedCandidates: [expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 136_494_769 })]
    });
    expect((summary.userFacingWarnings as string[]).join(' ')).toContain('آخرین نتیجه ذخیره‌شده');
  });

  it('marks network failures without parsed cache as unavailable, not no-nav-candidates-live', () => {
    const summary = createSmokeSummary({
      symbol: 'وصندوق',
      currentPriceSource: 'unknown',
      discovery: {
        status: 'network-error',
        symbol: 'وصندوق',
        errorStatus: 'network-error',
        errorMessage: 'Codal search failed after 3 attempt(s): Failed to fetch',
        sourceVerified: false,
        checkedAt: '2026-07-03T00:00:00.000Z',
        diagnostics: {
          requestedSymbol: 'وصندوق',
          liveFetch: {
            status: 'network-error',
            errorMessage: 'Failed to fetch',
            attemptCount: 3,
            domain: 'search.codal.ir',
            usedCache: false
          }
        }
      }
    });

    expect(summary).toMatchObject({
      parserDataStatus: 'unavailable-network-error',
      candidateAvailability: 'unavailable-network-error',
      extractedCandidates: []
    });
    expect((summary.userFacingWarnings as string[]).join(' ')).toContain('کاندیدهای کدال بررسی نشدند');
  });

  it('reports total-share-only parser output as basic candidates, not NAV candidates', () => {
    const parsed = parseResult();
    parsed.extractedValues = [
      {
        kind: 'totalSharesSuggestion',
        label: 'تعداد کل سهام',
        value: 9_000_000_000,
        rawText: '9000000000',
        confidence: 'medium',
        sourceTableIndex: -1
      }
    ];
    parsed.primarySuggestions = [];
    parsed.secondarySuggestions = [];
    parsed.diagnostics.rejectedCandidates = [];
    parsed.diagnostics.sourceStrategy = {
      htmlDetailChecked: true,
      reconstructedTableChecked: true,
      excel: { status: 'not-requested', tableCount: 0 },
      alternativeReportsChecked: false,
      marketValueStatus: 'not-found',
      messages: []
    };
    parsed.diagnostics.candidateAvailability = 'live-nav-candidates';

    const summary = createSmokeSummary({
      symbol: 'فملی',
      instrumentName: 'ملی صنایع مس ایران',
      currentPriceSource: 'dom-latest-trade',
      parseResult: parsed,
      support: {
        status: 'unknown',
        reasons: ['برای تشخیص نوع نماد داده کافی وجود ندارد.']
      }
    });

    expect(summary).toMatchObject({
      holdingSupport: { status: 'unknown' },
      marketValueStatus: 'not-found',
      candidateAvailability: 'live-basic-candidates-only',
      extractedCandidates: [expect.objectContaining({ kind: 'totalSharesSuggestion' })]
    });
  });

  it('marks subsidiary financial reports as issuer mismatch in smoke summaries', () => {
    const summary = createSmokeSummary({
      symbol: 'فولاد',
      instrumentName: 'فولاد مبارکه اصفهان',
      codalSymbol: 'فولاد',
      currentPrice: 5_000,
      currentPriceSource: 'dom-latest-trade',
      support: {
        status: 'unknown',
        message: 'این نماد احتمالاً برای محاسبه NAV هلدینگی پشتیبانی نمی‌شود یا داده کافی ندارد. محاسبه دستی همچنان ممکن است.',
        reasons: ['برای تشخیص نوع نماد داده کافی وجود ندارد.']
      },
      discovery: {
        status: 'not-found',
        symbol: 'فولاد',
        sourceVerified: false,
        checkedAt: '2026-07-02T00:00:00.000Z',
        diagnostics: {
          requestedSymbol: 'فولاد',
          requestedIssuerName: 'فولاد مبارکه اصفهان',
          financialStatement: {
            requestedSymbol: 'فولاد',
            requestedIssuerName: 'فولاد مبارکه اصفهان',
            reportKind: 'financial-statement',
            selectedConfidence: 'none',
            selectedWarnings: [],
            candidates: [
              {
                report: {
                  symbol: 'فولاد',
                  companyName: 'فولاد مبارکه اصفهان',
                  title: 'صورت‌های مالی سال مالی منتهی به ۱۴۰۴/۱۲/۲۹ (شرکت مجتمع فولاد و نورد سبا اصفهان)'
                },
                score: 50,
                selected: false,
                reasons: ['نماد گزارش دقیقاً با نماد درخواست‌شده تطبیق دارد.'],
                warnings: [],
                rejectedReasons: ['عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند.']
              }
            ]
          }
        }
      }
    });

    expect(summary).toMatchObject({
      currentPrice: 5_000,
      holdingSupport: { status: 'unknown' },
      financialReport: {
        status: 'issuer-mismatch',
        confidence: 'none',
        issuerMatchStatus: 'subsidiary-or-other-company',
        rejectionReason: 'عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند.'
      }
    });
    expect(summary.userFacingWarnings).toEqual(
      expect.arrayContaining(['گزارش مالی معتبر ناشر اصلی برای NAV پیدا نشد.'])
    );
  });

  it('does not report exact-symbol issuer status for unselected weak-name financial candidates', () => {
    const summary = createSmokeSummary({
      symbol: 'شستا',
      currentPriceSource: 'unknown',
      discovery: {
        status: 'not-found',
        symbol: 'شستا',
        sourceVerified: false,
        checkedAt: '2026-07-02T00:00:00.000Z',
        diagnostics: {
          requestedSymbol: 'شستا',
          financialStatement: {
            requestedSymbol: 'شستا',
            reportKind: 'financial-statement',
            selectedConfidence: 'none',
            selectedWarnings: [],
            candidates: [
              {
                report: {
                  symbol: 'شستا',
                  title: 'صورت‌های مالی سال مالی منتهی به ۱۴۰۴/۱۲/۲۹'
                },
                score: 65,
                selected: false,
                reasons: ['نماد گزارش دقیقاً با نماد درخواست‌شده تطبیق دارد.'],
                warnings: ['نام شرکت گزارش با ناشر تشخیص‌داده‌شده از TSETMC تطبیق قوی ندارد.'],
                rejectedReasons: []
              }
            ]
          }
        }
      }
    });

    expect(summary).toMatchObject({
      financialReport: {
        status: 'no-valid-issuer-financial-report',
        issuerMatchStatus: 'weak-name',
        rejectionReason: 'نام شرکت گزارش با ناشر تشخیص‌داده‌شده از TSETMC تطبیق قوی ندارد.'
      }
    });
  });
});
