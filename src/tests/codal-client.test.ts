import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverLatestCodalReports,
  getLatestFinancialStatement,
  getLatestMonthlyActivityReport,
  searchReportsBySymbol
} from '../data/codal-client';

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload)
  } as unknown as Response;
}

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

describe('codal-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('searches reports by symbol and normalizes Codal response records', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وخارزم',
            CompanyName: 'سرمایه گذاری خوارزمی',
            Title: 'گزارش فعالیت ماهانه دوره ۱ ماهه',
            PublishDateTime: '2026-06-20T10:00:00',
            Url: '/Reports/Decision.aspx?LetterSerial=abc',
            TracingNo: 123,
            LetterSerial: 'abc'
          }
        ]
      })
    );

    const reports = await searchReportsBySymbol('وخارزم', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('Symbol=%D9%88%D8%AE%D8%A7%D8%B1%D8%B2%D9%85');
    expect(reports).toEqual([
      expect.objectContaining({
        symbol: 'وخارزم',
        title: 'گزارش فعالیت ماهانه دوره ۱ ماهه',
        companyName: 'سرمایه گذاری خوارزمی',
        tracingNo: '123',
        reportId: 'abc',
        url: 'https://www.codal.ir/Reports/Decision.aspx?LetterSerial=abc'
      })
    ]);
    expect(storage.chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it('returns cached successful responses without calling fetch', async () => {
    const cacheKey = 'codal-search:all:وبملت';
    const storage = createChromeStorageMock({
      [cacheKey]: {
        createdAt: new Date().toISOString(),
        reports: [{ symbol: 'وبملت', title: 'صورت‌های مالی سال مالی منتهی' }]
      }
    });
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn();

    const reports = await searchReportsBySymbol('وبملت', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(reports[0].title).toBe('صورت‌های مالی سال مالی منتهی');
  });

  it('retries failed search requests up to the retry limit', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'temporary' }, 503))
      .mockResolvedValueOnce(jsonResponse({ Letters: [{ Symbol: 'وغدیر', Title: 'گزارش فعالیت ماهانه' }] }));

    const reports = await searchReportsBySymbol('وغدیر', {
      retryLimit: 1,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reports[0].title).toBe('گزارش فعالیت ماهانه');
  });

  it('throws a clear error after retry exhaustion', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'unavailable' }, 503));

    await expect(
      searchReportsBySymbol('وغدیر', {
        retryLimit: 1,
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow('Codal search failed after 2 attempt(s): Codal search request failed with HTTP 503.');
  });

  it('selects latest monthly activity and financial statement reports', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وغدیر',
            Title: 'صورت‌های مالی سال مالی منتهی به ۱۴۰۵/۱۲/۳۰',
            PublishDateTime: '2026-06-18T09:00:00'
          },
          {
            Symbol: 'وغدیر',
            Title: 'گزارش فعالیت ماهانه دوره ۱ ماهه منتهی به ۱۴۰۵/۰۳/۳۱',
            PublishDateTime: '2026-06-22T09:00:00'
          },
          {
            Symbol: 'وغدیر',
            Title: 'گزارش فعالیت ماهانه دوره ۱ ماهه منتهی به ۱۴۰۵/۰۲/۳۱',
            PublishDateTime: '2026-05-22T09:00:00'
          }
        ]
      })
    );

    const monthly = await getLatestMonthlyActivityReport('وغدیر', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    const financial = await getLatestFinancialStatement('وغدیر', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(monthly?.publishedAt).toBe('2026-06-22T09:00:00');
    expect(financial?.publishedAt).toBe('2026-06-18T09:00:00');
  });

  it('returns a found discovery result when relevant reports exist', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وغدیر',
            Title: 'گزارش فعالیت ماهانه دوره ۱ ماهه',
            PublishDateTime: '2026-06-22T09:00:00'
          },
          {
            Symbol: 'وغدیر',
            Title: 'صورت‌های مالی سال مالی منتهی',
            PublishDateTime: '2026-06-18T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('وغدیر', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('found');
    expect(result.sourceVerified).toBe(false);
    expect(result.monthlyActivityReport?.title).toContain('فعالیت ماهانه');
    expect(result.financialStatementReport?.title).toContain('صورت‌های مالی');
  });

  it('returns not-found when Codal search succeeds but has no relevant reports', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ Letters: [{ Symbol: 'وغدیر', Title: 'اطلاعیه عمومی' }] }));

    const result = await discoverLatestCodalReports('وغدیر', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('not-found');
    expect(result.monthlyActivityReport).toBeUndefined();
    expect(result.financialStatementReport).toBeUndefined();
  });

  it('returns failed when Codal discovery cannot fetch reports', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'unavailable' }, 503));

    const result = await discoverLatestCodalReports('وغدیر', {
      retryLimit: 0,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('HTTP 503');
  });

  it('does not call Codal for unknown or InsCode-only symbols', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn();

    const result = await discoverLatestCodalReports('InsCode:778253364357513', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('not-found');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
