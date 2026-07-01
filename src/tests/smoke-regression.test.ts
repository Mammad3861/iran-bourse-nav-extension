import { describe, expect, it, vi } from 'vitest';
import { analyzeNavCompleteness, emptyNavInputs } from '../core/nav-calculator';
import type { CodalReportDetail } from '../data/codal-client';
import { discoverLatestCodalReports } from '../data/codal-client';
import { parseMonthlyActivityReport } from '../data/codal-monthly-parser';
import {
  discoverySelectionNotice,
  financialReportSummary,
  marketValueStatusText,
  sourceStrategySummaryText
} from '../ui/codal-display-utils';
import reportSelectionVaghadir from './fixtures/codal/report-selection-vaghadir.json';
import reportSelectionVasandogh from './fixtures/codal/report-selection-vasandogh.json';
import vaghadirDetail from './fixtures/codal/vaghadir-monthly-parser.json';
import vasandoghDetail from './fixtures/codal/vasandogh-monthly-parser.json';

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload)
  } as unknown as Response;
}

function chromeStorageMock(): typeof chrome {
  const store = new Map<string, unknown>();
  return {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
          if (!keys) return Object.fromEntries(store);
          if (typeof keys === 'string') return { [keys]: store.get(keys) };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store.get(key)]));
          return Object.fromEntries(Object.keys(keys).map((key) => [key, store.get(key) ?? keys[key]]));
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) store.set(key, value);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
        })
      }
    }
  } as unknown as typeof chrome;
}

describe('real symbol smoke regression fixtures', () => {
  it('keeps وصندوق monthly and financial report selection stable', async () => {
    vi.stubGlobal('chrome', chromeStorageMock());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(reportSelectionVasandogh));

    const result = await discoverLatestCodalReports('وصندوق', {
      requestedIssuerName: 'سرمایه گذاری صندوق بازنشستگی',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('found');
    expect(result.monthlyActivityReport?.title).toContain('گزارش فعالیت ماهانه');
    expect(result.monthlyActivityReport?.selectionDiagnostics?.selectedConfidence).toBe('high');
    expect(result.financialStatementReport?.title).toContain('صورت‌های مالی');
    expect(financialReportSummary(result.financialStatementReport)).not.toContain('پیدا نشد');
  });

  it('selects وغدیر monthly report despite Arabic/Persian ی variants and rejects subsidiary financial statements', async () => {
    vi.stubGlobal('chrome', chromeStorageMock());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(reportSelectionVaghadir));

    const result = await discoverLatestCodalReports('وغدير', {
      requestedIssuerName: 'سرمايه‌گذاري‌غدير(هلدينگ‌',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('found');
    expect(result.monthlyActivityReport?.symbol).toBe('وغدیر');
    expect(result.monthlyActivityReport?.selectionDiagnostics?.selectedConfidence).toBe('high');
    expect(discoverySelectionNotice(result)).toBe('گزارش انتخاب‌شده با نماد/ناشر تطبیق داده شد.');
    expect(result.financialStatementReport).toBeUndefined();
    expect(financialReportSummary(result.financialStatementReport)).toBe('صورت مالی معتبر برای ناشر پیدا نشد');
    expect(financialReportSummary(result.financialStatementReport)).not.toContain('ایران مارین سرویسز');
    expect(result.diagnostics?.financialStatement?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          report: expect.objectContaining({ title: expect.stringContaining('ایران مارین سرویسز') }),
          rejectedReasons: expect.arrayContaining(['عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند.'])
        }),
        expect.objectContaining({
          report: expect.objectContaining({ title: expect.stringContaining('توضیحات در خصوص') }),
          rejectedReasons: expect.arrayContaining(['گزارش توضیحات/شفاف‌سازی است و صورت مالی معتبر محسوب نمی‌شود.'])
        })
      ])
    );
  });

  it('parses وصندوق cost and keeps ambiguous Excel market values diagnostics-only', () => {
    const result = parseMonthlyActivityReport(vasandoghDetail as CodalReportDetail);

    expect(result.diagnostics.sourceStrategy?.excel.status).toBe('fetched');
    expect(result.diagnostics.sourceStrategy?.marketValueStatus).toBe('ambiguous');
    expect(marketValueStatusText(result.diagnostics.sourceStrategy!.marketValueStatus)).toBe('نیازمند بررسی دستی');
    expect(sourceStrategySummaryText(result.diagnostics.sourceStrategy!)).not.toContain('ناموفق بود: fetched');
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 136_494_769 })])
    );
    expect(result.extractedValues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue' })])
    );
    expect(result.secondarySuggestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue' })])
    );
    expect(result.diagnostics.rejectedCandidates.length).toBeGreaterThan(0);
  });

  it('parses وغدیر cost and keeps ambiguous Excel market values diagnostics-only', () => {
    const result = parseMonthlyActivityReport(vaghadirDetail as CodalReportDetail);

    expect(result.diagnostics.sourceStrategy?.excel.status).toBe('fetched');
    expect(result.diagnostics.sourceStrategy?.marketValueStatus).toBe('ambiguous');
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 275_218_935 })])
    );
    expect(result.extractedValues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue' })])
    );
    expect(result.secondarySuggestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue' })])
    );
  });

  it('keeps NAV incomplete without showing negative NAV warning for partial Codal cost inputs', () => {
    const analysis = analyzeNavCompleteness({
      ...emptyNavInputs(),
      listedPortfolioCostValue: 136_494_769
    });

    expect(analysis.navTotalAvailable).toBe(false);
    expect(analysis.status).toBe('needs-review');
    expect(analysis.warnings.join(' ')).not.toContain('NAV منفی');
  });
});
