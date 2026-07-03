import { describe, expect, it } from 'vitest';
import type { MonthlyActivityParseResult } from '../data/codal-monthly-parser';
import type { ManualOverrideRecord } from '../data/manual-overrides';
import { buildNavCompletionSummary } from '../data/nav-completion';
import { confirmZeroField, markSuggestionFieldReviewed, resetCodalSuggestionFields } from '../data/suggestion-application';

function record(overrides: Partial<ManualOverrideRecord> = {}): ManualOverrideRecord {
  return {
    symbol: 'وصندوق',
    inputs: {},
    currentPriceSource: 'manual',
    updatedAt: '2026-07-02T00:00:00.000Z',
    fieldSources: {},
    ...overrides
  };
}

function parseResult(overrides: Partial<MonthlyActivityParseResult> = {}): MonthlyActivityParseResult {
  return {
    status: 'parsed',
    tableCandidates: [],
    extractedValues: [],
    primarySuggestions: [],
    secondarySuggestions: [],
    tablePreviews: [],
    diagnostics: {
      detectedTableCount: 1,
      parserStatus: 'parsed',
      parserWarnings: [],
      extractedCandidates: [],
      rejectedCandidates: [],
      tables: []
    },
    warnings: [],
    parsedAt: '2026-07-02T00:00:00.000Z',
    ...overrides
  };
}

describe('NAV completion workflow model', () => {
  it('shows missing NAV total fields', () => {
    const summary = buildNavCompletionSummary(record({ inputs: { listedPortfolioCostValue: 136_494_769 } }));

    expect(summary.status).toBe('incomplete');
    expect(summary.navTotalMissingFields).toEqual(
      expect.arrayContaining(['equity', 'listedPortfolioMarketValue', 'unlistedPortfolioSurplus'])
    );
  });

  it('treats manually entered fields as present', () => {
    const summary = buildNavCompletionSummary(
      record({
        inputs: {
          equity: 100,
          listedPortfolioMarketValue: 500,
          listedPortfolioCostValue: 400,
          unlistedPortfolioSurplus: 0
        },
        fieldSources: {
          listedPortfolioMarketValue: {
            value: 500,
            source: 'manual',
            appliedAt: '2026-07-02T00:00:00.000Z',
            touchedByUser: true
          }
        }
      })
    );

    expect(summary.navTotalMissingFields).toEqual([]);
    expect(summary.fields.find((field) => field.field === 'listedPortfolioMarketValue')?.statusLabel).toBe(
      'وارد شده دستی'
    );
  });

  it('marks suggestion-applied fields as present but needing review', () => {
    const summary = buildNavCompletionSummary(
      record({
        inputs: {
          equity: 100,
          listedPortfolioMarketValue: 500,
          listedPortfolioCostValue: 400,
          unlistedPortfolioSurplus: 0
        },
        fieldSources: {
          listedPortfolioMarketValue: {
            value: 500,
            source: 'codal-excel-manual-review',
            appliedAt: '2026-07-02T00:00:00.000Z',
            confidence: 'medium'
          }
        }
      })
    );

    expect(summary.status).toBe('complete-needs-review');
    expect(summary.fields.find((field) => field.field === 'listedPortfolioMarketValue')?.canConfirmReview).toBe(true);
  });

  it('reviewing an applied suggestion changes completion status to reviewed when all NAV fields exist', () => {
    const current = record({
      inputs: {
        equity: 100,
        listedPortfolioMarketValue: 500,
        listedPortfolioCostValue: 400,
        unlistedPortfolioSurplus: 0,
        totalShares: 10,
        currentPrice: 20
      },
      fieldSources: {
        listedPortfolioMarketValue: {
          value: 500,
          source: 'codal-excel-manual-review',
          appliedAt: '2026-07-02T00:00:00.000Z',
          confidence: 'medium'
        },
        equity: {
          value: 100,
          source: 'manual',
          appliedAt: '2026-07-02T00:00:00.000Z',
          touchedByUser: true
        },
        listedPortfolioCostValue: {
          value: 400,
          source: 'manual',
          appliedAt: '2026-07-02T00:00:00.000Z',
          touchedByUser: true
        },
        unlistedPortfolioSurplus: {
          value: 0,
          source: 'user-confirmed-zero',
          appliedAt: '2026-07-02T00:00:00.000Z',
          reviewedByUser: true
        },
        totalShares: {
          value: 10,
          source: 'manual',
          appliedAt: '2026-07-02T00:00:00.000Z',
          touchedByUser: true
        },
        currentPrice: {
          value: 20,
          source: 'manual',
          appliedAt: '2026-07-02T00:00:00.000Z',
          touchedByUser: true
        }
      }
    });

    const reviewed = markSuggestionFieldReviewed(current, 'listedPortfolioMarketValue', '2026-07-02T01:00:00.000Z');

    expect(buildNavCompletionSummary(current).status).toBe('complete-needs-review');
    expect(buildNavCompletionSummary(reviewed).status).toBe('complete-reviewed');
  });

  it('treats user-confirmed zero for unlisted surplus as present', () => {
    const current = confirmZeroField(record({ inputs: { equity: 100, listedPortfolioMarketValue: 500, listedPortfolioCostValue: 400 } }), 'unlistedPortfolioSurplus');
    const summary = buildNavCompletionSummary(current);

    expect(current.inputs.unlistedPortfolioSurplus).toBe(0);
    expect(summary.navTotalMissingFields).not.toContain('unlistedPortfolioSurplus');
    expect(summary.fields.find((field) => field.field === 'unlistedPortfolioSurplus')?.statusLabel).toBe(
      'صفر تأییدشده توسط کاربر'
    );
  });

  it('keeps NAV/share unavailable when total shares or current price are missing', () => {
    const summary = buildNavCompletionSummary(
      record({
        inputs: {
          equity: 100,
          listedPortfolioMarketValue: 500,
          listedPortfolioCostValue: 400,
          unlistedPortfolioSurplus: 0
        },
        fieldSources: {
          equity: {
            value: 100,
            source: 'manual',
            appliedAt: '2026-07-02T00:00:00.000Z',
            touchedByUser: true
          },
          listedPortfolioMarketValue: {
            value: 500,
            source: 'manual',
            appliedAt: '2026-07-02T00:00:00.000Z',
            touchedByUser: true
          },
          listedPortfolioCostValue: {
            value: 400,
            source: 'manual',
            appliedAt: '2026-07-02T00:00:00.000Z',
            touchedByUser: true
          },
          unlistedPortfolioSurplus: {
            value: 0,
            source: 'user-confirmed-zero',
            appliedAt: '2026-07-02T00:00:00.000Z',
            reviewedByUser: true
          }
        }
      })
    );

    expect(summary.status).toBe('calculable-warning');
    expect(summary.navShareMissingFields).toEqual(expect.arrayContaining(['totalShares', 'currentPrice']));
    expect(summary.navShareGuidance).toBe('برای NAV هر سهم، تعداد کل سهام لازم است.');
  });

  it('uses TSETMC label for legacy totalShares metadata in completion workflow', () => {
    const summary = buildNavCompletionSummary(
      record({
        inputs: { totalShares: 9_000_000_000 },
        fieldSources: {
          totalShares: {
            value: 9_000_000_000,
            source: 'codal-suggestion',
            appliedAt: '2026-07-02T00:00:00.000Z',
            reportTitle: 'TSETMC instrument info',
            columnLabel: 'zTitad / totalShares'
          }
        }
      })
    );

    expect(summary.fields.find((field) => field.field === 'totalShares')?.statusLabel).toBe(
      'اعمال‌شده از پیشنهاد TSETMC'
    );
  });

  it('does not mark live/latest-trade current price as stale', () => {
    const summary = buildNavCompletionSummary(
      record({
        inputs: { currentPrice: 17_070 },
        currentPriceSource: 'dom-latest-trade'
      })
    );

    expect(summary.fields.find((field) => field.field === 'currentPrice')?.statusLabel).toBe(
      'خوانده‌شده از آخرین معامله / TSETMC'
    );
  });

  it('marks current price stale only when metadata says stale', () => {
    const summary = buildNavCompletionSummary(
      record({
        inputs: { currentPrice: 17_070 },
        currentPriceSource: 'manual',
        fieldSources: {
          currentPrice: {
            value: 17_070,
            source: 'manual',
            appliedAt: '2026-07-02T00:00:00.000Z',
            stale: true
          }
        }
      })
    );

    expect(summary.fields.find((field) => field.field === 'currentPrice')?.statusLabel).toBe(
      'مقدار ذخیره‌شده قدیمی / stale'
    );
  });

  it('explains share and P/NAV wait for NAV total when shares and price are present', () => {
    const summary = buildNavCompletionSummary(
      record({
        inputs: {
          totalShares: 9_000_000_000,
          currentPrice: 17_070
        },
        currentPriceSource: 'dom-latest-trade'
      })
    );

    expect(summary.navShareGuidance).toBe(
      'تعداد سهام و قیمت فعلی موجود است؛ بعد از تکمیل NAV کل، NAV هر سهم و P/NAV قابل محاسبه می‌شود.'
    );
  });

  it('says NAV/share and P/NAV are calculable only after NAV total is complete', () => {
    const summary = buildNavCompletionSummary(
      record({
        inputs: {
          equity: 100,
          listedPortfolioMarketValue: 500,
          listedPortfolioCostValue: 400,
          unlistedPortfolioSurplus: 0,
          totalShares: 10,
          currentPrice: 20
        },
        currentPriceSource: 'dom-latest-trade',
        fieldSources: {
          equity: { value: 100, source: 'manual', appliedAt: '2026-07-02T00:00:00.000Z' },
          listedPortfolioMarketValue: { value: 500, source: 'manual', appliedAt: '2026-07-02T00:00:00.000Z' },
          listedPortfolioCostValue: { value: 400, source: 'manual', appliedAt: '2026-07-02T00:00:00.000Z' },
          unlistedPortfolioSurplus: {
            value: 0,
            source: 'user-confirmed-zero',
            appliedAt: '2026-07-02T00:00:00.000Z'
          }
        }
      })
    );

    expect(summary.navShareGuidance).toBe('NAV هر سهم و P/NAV قابل محاسبه است.');
  });

  it('reports cost/market pair warnings', () => {
    const costOnly = buildNavCompletionSummary(record({ inputs: { listedPortfolioCostValue: 400 } }));
    const marketOnly = buildNavCompletionSummary(record({ inputs: { listedPortfolioMarketValue: 500 } }));

    expect(costOnly.pairWarnings.join(' ')).toContain('بهای تمام‌شده');
    expect(marketOnly.pairWarnings.join(' ')).toContain('ارزش روز وارد شده');
  });

  it('reset applied suggestions does not clear user-confirmed zero', () => {
    const current = confirmZeroField(
      record({
        inputs: {
          listedPortfolioCostValue: 400
        },
        fieldSources: {
          listedPortfolioCostValue: {
            value: 400,
            source: 'codal-suggestion',
            appliedAt: '2026-07-02T00:00:00.000Z'
          }
        }
      }),
      'unlistedPortfolioSurplus',
      '2026-07-02T01:00:00.000Z'
    );

    const reset = resetCodalSuggestionFields(current, '2026-07-02T02:00:00.000Z');

    expect(reset.inputs.listedPortfolioCostValue).toBeUndefined();
    expect(reset.inputs.unlistedPortfolioSurplus).toBe(0);
    expect(reset.fieldSources?.unlistedPortfolioSurplus?.source).toBe('user-confirmed-zero');
  });

  it('does not claim an equity suggestion exists when no equity candidate was extracted', () => {
    const summary = buildNavCompletionSummary(
      record(),
      parseResult({
        diagnostics: {
          detectedTableCount: 1,
          parserStatus: 'parsed',
          parserWarnings: [],
          extractedCandidates: [],
          rejectedCandidates: [],
          tables: [
            {
              tableIndex: 0,
              sourceGroup: 'financial',
              rawHeaders: ['شرح', 'مبلغ'],
              normalizedHeaders: ['شرح', 'مبلغ'],
              firstRawRows: [['سود انباشته', '100']],
              firstNormalizedRows: [['سود انباشته', '100']],
              firstRows: [['سود انباشته', '100']],
              detectedLabels: ['سود انباشته'],
              totalRowCandidates: [],
              costColumnCandidates: [],
              marketValueColumnCandidates: [],
              failureReasons: ['ردیف جمع حقوق صاحبان سهام پیدا نشد'],
              textPreview: ''
            }
          ]
        }
      }),
      {
        status: 'unknown',
        message: 'manual only',
        reasons: []
      }
    );

    const equity = summary.fields.find((field) => field.field === 'equity');
    expect(equity?.guidance).not.toContain('پیشنهاد از صورت مالی موجود است');
    expect(equity?.guidance).toContain('پیشنهاد قابل اتکا');
  });

  it('shows equity suggestion copy only when a real equitySuggestion exists', () => {
    const summary = buildNavCompletionSummary(
      record(),
      parseResult({
        extractedValues: [
          {
            kind: 'equitySuggestion',
            label: 'جمع حقوق صاحبان سهام',
            value: 100,
            rawText: '100',
            confidence: 'medium',
            sourceTableIndex: 0
          }
        ]
      }),
      {
        status: 'likely-holding',
        reasons: []
      }
    );

    expect(summary.fields.find((field) => field.field === 'equity')?.guidance).toContain(
      'پیشنهاد از صورت مالی موجود است'
    );
  });
});
