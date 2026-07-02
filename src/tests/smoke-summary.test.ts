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
      holdingSupport: {
        status: 'unsupported'
      }
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
      },
      userFacingWarnings: ['گزارش مالی معتبر ناشر اصلی برای NAV پیدا نشد.']
    });
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
