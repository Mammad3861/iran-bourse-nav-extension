import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverLatestCodalReports,
  extractTableMetadataFromHtml,
  extractTablesFromHtml,
  getLatestFinancialStatement,
  getLatestMonthlyActivityReport,
  getReportDetail,
  getReportDetailByTracingNo,
  getReportDetailByUrl,
  groupCellsByMetaTableCode,
  isFinancialStatementReport,
  isMonthlyActivityReport,
  isPortfolioReport,
  reconstructCodalCellTable,
  searchReportsBySymbol
} from '../data/codal-client';

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload)
  } as unknown as Response;
}

function detailResponse(body: string | unknown, contentType: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: vi.fn(() => contentType)
    },
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(String(body))
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

  it('falls back to Arabic Yeh/Kaf symbol variants when Codal returns no Persian-spelling matches', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Total: 0, Letters: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          Total: 1,
          Letters: [
            {
              Symbol: 'وغدیر',
              CompanyName: 'سرمایه گذاری غدیر',
              Title: 'اطلاعات و صورت‌های مالی میاندوره‌ای',
              PublishDateTime: '۱۴۰۵/۰۱/۳۰ ۱۰:۰۴:۵۲'
            }
          ]
        })
      );

    const reports = await searchReportsBySymbol('وغدیر', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('Symbol=%D9%88%D8%BA%D8%AF%DB%8C%D8%B1');
    expect(fetchMock.mock.calls[1][0]).toContain('Symbol=%D9%88%D8%BA%D8%AF%D9%8A%D8%B1');
    expect(reports[0]).toEqual(
      expect.objectContaining({
        symbol: 'وغدیر',
        companyName: 'سرمایه گذاری غدیر'
      })
    );
  });

  it('does not use Codal Length as a page-size parameter', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ Letters: [] }));

    await searchReportsBySymbol('وغدیر', {
      limit: 50,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock.mock.calls[0][0]).toContain('Length=-1');
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

  it('treats Codal portfolio status titles as monthly activity candidates for holding companies', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وصندوق',
            Title: 'صورت وضعیت پورتفوی دوره ۳ ماهه منتهی به ۱۴۰۴/۱۲/۲۹',
            PublishDateTime: '۱۴۰۵/۰۱/۲۹ ۱۰:۲۵:۴۹'
          }
        ]
      })
    );

    const monthly = await getLatestMonthlyActivityReport('وصندوق', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(monthly?.title).toContain('صورت وضعیت پورتفوی');
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

  it('prefers exact symbol reports over newer weak symbol matches', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'غدیر',
            CompanyName: 'شرکت صنعتی وبازرگانی غدیر',
            Title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31',
            PublishDateTime: '2026-06-25T09:00:00'
          },
          {
            Symbol: 'وغدیر',
            CompanyName: 'سرمایه گذاری غدیر',
            Title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/02/31',
            PublishDateTime: '2026-05-25T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('وغدیر', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.monthlyActivityReport?.symbol).toBe('وغدیر');
    expect(result.monthlyActivityReport?.publishedAt).toBe('2026-05-25T09:00:00');
    expect(result.diagnostics?.monthlyActivity?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rejectedReasons: expect.arrayContaining(['نماد گزارش با نماد درخواست‌شده تطبیق ندارد.'])
        })
      ])
    );
  });

  it('does not select a suspicious subsidiary portfolio report when issuer metadata differs', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وغدیر',
            CompanyName: 'شرکت صنعتی وبازرگانی غدیر',
            Title: 'صورت وضعیت پورتفوی دوره 3 ماهه منتهی به 1405/03/31 (شرکت صنعتی وبازرگانی غدیر)',
            PublishDateTime: '2026-06-25T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('وغدير', {
      requestedIssuerName: 'سرمايه گذاري غدير هلدينگ',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('not-found');
    expect(result.monthlyActivityReport).toBeUndefined();
    expect(result.errorMessage).toContain('تطبیق نماد/ناشر');
    expect(result.diagnostics?.monthlyActivity?.selectedConfidence).toBe('none');
    expect(result.diagnostics?.monthlyActivity?.candidates[0].warnings).toEqual(
      expect.arrayContaining([
        'نام شرکت گزارش با ناشر تشخیص‌داده‌شده از TSETMC تطبیق قوی ندارد.',
        'عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند.'
      ])
    );
  });

  it('selects وصندوق own monthly activity report with high confidence', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وصندوق',
            CompanyName: 'سرمایه گذاری صندوق بازنشستگی',
            Title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31',
            PublishDateTime: '2026-06-25T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('وصندوق', {
      requestedIssuerName: 'سرمايه گذاري صندوق بازنشستگي',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('found');
    expect(result.monthlyActivityReport?.symbol).toBe('وصندوق');
    expect(result.monthlyActivityReport?.selectionDiagnostics?.selectedConfidence).toBe('high');
    expect(result.diagnostics?.monthlyActivity?.selectedWarnings).toHaveLength(0);
  });

  it('matches وغدير request to وغدیر report symbol without issuer warning', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وغدیر',
            CompanyName: 'سرمایه گذاری غدیر',
            Title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31',
            PublishDateTime: '2026-06-25T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('وغدير', {
      requestedIssuerName: 'سرمايه‌گذاري‌غدير(هلدينگ‌',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('found');
    expect(result.monthlyActivityReport?.symbol).toBe('وغدیر');
    expect(result.diagnostics?.monthlyActivity?.selectedConfidence).toBe('high');
    expect(result.diagnostics?.monthlyActivity?.selectedWarnings).toEqual([]);
  });

  it('keeps Shasta-like exact monthly symbol matches high confidence despite weak issuer-name mismatch', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'شستا',
            CompanyName: 'سرمایه گذاری تامین اجتماعی',
            Title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31',
            PublishDateTime: '2026-06-25T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('شستا', {
      requestedIssuerName: 'شستا 123,456',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('found');
    expect(result.monthlyActivityReport?.symbol).toBe('شستا');
    expect(result.diagnostics?.monthlyActivity?.selectedConfidence).toBe('high');
    expect(result.diagnostics?.monthlyActivity?.selectedWarnings).toEqual([]);
  });

  it('does not classify clarification letters as financial statements', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وغدیر',
            CompanyName: 'سرمایه گذاری غدیر',
            Title: 'شفاف سازی در خصوص صورت‌های مالی سال مالی منتهی',
            PublishDateTime: '2026-06-25T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('وغدیر', {
      requestedIssuerName: 'سرمایه گذاری غدیر',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.financialStatementReport).toBeUndefined();
    expect(result.diagnostics?.financialStatement?.selectedConfidence).toBe('none');
    expect(result.diagnostics?.financialStatement?.candidates[0].rejectedReasons).toContain(
      'گزارش توضیحات/شفاف‌سازی است و صورت مالی معتبر محسوب نمی‌شود.'
    );
  });

  it('does not display subsidiary financial statements as issuer financial reports', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وغدیر',
            CompanyName: 'سرمایه گذاری غدیر',
            Title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31',
            PublishDateTime: '2026-06-25T09:00:00'
          },
          {
            Symbol: 'وغدیر',
            CompanyName: 'سرمایه گذاری غدیر',
            Title: 'اطلاعات و صورت‌های مالی میاندوره‌ای دوره 6 ماهه منتهی به 1404/12/29 (حسابرسی شده) (شرکت ایران مارین سرویسز)',
            PublishDateTime: '2026-06-24T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('وغدیر', {
      requestedIssuerName: 'سرمايه‌گذاري‌غدير(هلدينگ‌',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('found');
    expect(result.monthlyActivityReport?.selectionDiagnostics?.selectedConfidence).toBe('high');
    expect(result.financialStatementReport).toBeUndefined();
    expect(result.diagnostics?.financialStatement?.selectedConfidence).toBe('none');
    expect(result.diagnostics?.financialStatement?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          report: expect.objectContaining({ title: expect.stringContaining('ایران مارین سرویسز') }),
          rejectedReasons: expect.arrayContaining(['عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند.'])
        })
      ])
    );
  });

  it('rejects فولاد-like financial statements that name another company in parentheses', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'فولاد',
            CompanyName: 'فولاد مبارکه اصفهان',
            Title: 'صورت‌های مالی سال مالی منتهی به ۱۴۰۴/۱۲/۲۹ (شرکت مجتمع فولاد و نورد سبا اصفهان)',
            PublishDateTime: '2026-06-24T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('فولاد', {
      requestedIssuerName: 'فولاد مبارکه اصفهان',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.financialStatementReport).toBeUndefined();
    expect(result.diagnostics?.financialStatement?.selectedConfidence).toBe('none');
    expect(result.diagnostics?.financialStatement?.candidates[0]).toEqual(
      expect.objectContaining({
        rejectedReasons: expect.arrayContaining([
          expect.stringContaining('عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند')
        ])
      })
    );
  });

  it('rejects فولاد-like financial statements that name another fund in parentheses', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'فولاد',
            CompanyName: 'فولاد مبارکه اصفهان',
            Title:
              'صورت‌های مالی سال مالی منتهی به ۱۴۰۴/۱۲/۲۹ (شرکت صندوق پژوهش و فناوری غیر دولتی سرمایه گذاری خطرپذیر شرکتی فولاد مبارکه اصفهان)',
            PublishDateTime: '2026-06-24T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('فولاد', {
      requestedIssuerName: 'فولاد مبارکه اصفهان',
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.financialStatementReport).toBeUndefined();
    expect(result.diagnostics?.financialStatement?.selectedConfidence).toBe('none');
    expect(result.diagnostics?.financialStatement?.candidates[0].rejectedReasons.join(' ')).toContain('پرانتز');
  });

  it('includes rejected candidate reasons in report selection diagnostics', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وبانک',
            CompanyName: 'سرمایه گذاری گروه توسعه ملی',
            Title: 'گزارش فعالیت ماهانه دوره 1 ماهه',
            PublishDateTime: '2026-06-25T09:00:00'
          },
          {
            Symbol: 'وغدیر',
            CompanyName: 'سرمایه گذاری غدیر',
            Title: 'اطلاعیه عمومی',
            PublishDateTime: '2026-06-24T09:00:00'
          }
        ]
      })
    );

    const result = await discoverLatestCodalReports('وغدیر', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.diagnostics?.monthlyActivity?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rejectedReasons: expect.arrayContaining(['نماد گزارش با نماد درخواست‌شده تطبیق ندارد.'])
        }),
        expect.objectContaining({
          rejectedReasons: expect.arrayContaining(['عنوان گزارش با نوع گزارش مورد انتظار تطبیق ندارد.'])
        })
      ])
    );
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

  it('returns network-error when Codal discovery cannot fetch reports and no stale cache exists', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'unavailable' }, 503));

    const result = await discoverLatestCodalReports('وغدیر', {
      retryLimit: 0,
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('network-error');
    expect(result.errorMessage).toContain('HTTP 503');
    expect(result.usedCache).toBe(false);
    expect(result.attemptCount).toBe(1);
    expect(result.monthlyActivityReport).toBeUndefined();
    expect(result.diagnostics?.liveFetch).toEqual(
      expect.objectContaining({
        status: 'network-error',
        usedCache: false,
        attemptCount: 1,
        domain: 'search.codal.ir'
      })
    );
  });

  it('returns stale-cache from the last successful discovery when live Codal search fails', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const successFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        Letters: [
          {
            Symbol: 'وغدیر',
            CompanyName: 'سرمایه گذاری غدیر',
            Title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31',
            PublishDateTime: '2026-06-20T00:00:00Z',
            Url: '/Reports/Decision.aspx?LetterSerial=ok'
          }
        ]
      })
    );

    const first = await discoverLatestCodalReports('وغدیر', {
      fetchImpl: successFetch as unknown as typeof fetch
    });
    expect(first.status).toBe('found');

    const failedFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const second = await discoverLatestCodalReports('وغدیر', {
      retryLimit: 0,
      cacheTtlMs: -1,
      fetchImpl: failedFetch as unknown as typeof fetch
    });

    expect(second.status).toBe('stale-cache');
    expect(second.monthlyActivityReport?.title).toContain('گزارش فعالیت ماهانه');
    expect(second.errorMessage).toContain('Failed to fetch');
    expect(second.usedCache).toBe(true);
    expect(second.stale).toBe(true);
    expect(second.cachedAt).toBeDefined();
    expect(second.diagnostics?.liveFetch).toEqual(
      expect.objectContaining({
        status: 'network-error',
        usedCache: true,
        attemptCount: 1,
        domain: 'search.codal.ir'
      })
    );
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

  it('fetches report detail HTML and extracts safe text/table metadata', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const html = `
      <html>
        <head><script>alert("x")</script><style>.x{color:red}</style></head>
        <body>
          <h1>گزارش فعالیت ماهانه</h1>
          <table><caption>خلاصه</caption><tr><th>شرح</th><th>مبلغ</th></tr><tr><td>فروش</td><td>۱۲۳</td></tr></table>
        </body>
      </html>
    `;
    const fetchMock = vi.fn().mockResolvedValue(detailResponse(html, 'text/html'));

    const result = await getReportDetailByUrl('https://www.codal.ir/Reports/Decision.aspx?LetterSerial=abc', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('fetched');
    expect(result.detail?.rawHtml).toBe(html);
    expect(result.detail?.plainTextPreview).toContain('گزارش فعالیت ماهانه');
    expect(result.detail?.plainTextPreview).toContain('123');
    expect(result.detail?.plainTextPreview).not.toContain('alert');
    expect(result.detail?.contentType).toBe('html');
    expect(result.detail?.extractedTables[0].source).toBe('html-table');
    expect(result.detail?.tables[0]).toEqual(
      expect.objectContaining({
        rowCount: 2,
        columnCount: 2,
        headers: ['شرح', 'مبلغ'],
        caption: 'خلاصه'
      })
    );
  });

  it('captures ExcelUrl metadata and appends accessible Excel-like tables to report detail', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const detailHtml = '<html><body><h1>گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31</h1></body></html>';
    const excelText = [
      'شرح\tبهای تمام شده\tارزش بازار',
      'سرمایه گذاری در سهام\t100\t180',
      'جمع\t100\t180'
    ].join('\n');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(detailResponse(detailHtml, 'text/html'))
      .mockResolvedValueOnce(detailResponse(excelText, 'text/tab-separated-values'));

    const result = await getReportDetail(
      {
        symbol: 'وصندوق',
        title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31',
        url: '/Reports/Decision.aspx?LetterSerial=abc',
        excelUrl: '/Reports/ExportExcel.aspx?LetterSerial=abc'
      },
      { fetchImpl: fetchMock as unknown as typeof fetch }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://www.codal.ir/Reports/ExportExcel.aspx?LetterSerial=abc');
    expect(result.detail?.excelDiagnostics).toEqual(
      expect.objectContaining({
        status: 'fetched',
        tableCount: 1
      })
    );
    expect(result.detail?.sourceStrategy).toEqual(
      expect.objectContaining({
        marketValueStatus: 'found'
      })
    );
    expect(result.detail?.extractedTables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'codal-excel',
          headers: ['شرح', 'بهای تمام شده', 'ارزش بازار']
        })
      ])
    );
  });

  it('classifies blocked ExcelUrl fetches as CORS/access unavailable diagnostics', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const detailHtml = '<html><body><h1>گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31</h1></body></html>';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(detailResponse(detailHtml, 'text/html'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await getReportDetail(
      {
        symbol: 'وصندوق',
        title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31',
        url: '/Reports/Decision.aspx?LetterSerial=abc',
        excelUrl: 'https://excel.codal.ir/service/Excel/GetAll/abc'
      },
      { fetchImpl: fetchMock as unknown as typeof fetch }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('fetched');
    expect(result.detail?.excelDiagnostics).toEqual(
      expect.objectContaining({
        status: 'cors-blocked',
        errorCode: 'cors-blocked',
        errorMessage: 'ExcelUrl به‌دلیل محدودیت CORS/دسترسی افزونه قابل بررسی نبود.'
      })
    );
    expect(result.detail?.sourceStrategy?.messages).toContain(
      'ExcelUrl به‌دلیل محدودیت CORS/دسترسی افزونه قابل بررسی نبود.'
    );
  });

  it('detects real-like script-embedded JSON tables in Codal detail HTML', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const html = `
      <html><body>
        <h1>صورت وضعیت پورتفوی</h1>
        <script>
          window.reportData = {
            sheets: [{
              title: 'صورت وضعیت پورتفوی پذیرفته شده در بورس',
              rows: [
                ['شرح', 'بهای تمام شده', 'ارزش بازار'],
                ['سرمایه گذاری در سهام', '۱٬۲۳۴', '۲٬۳۴۵']
              ]
            }]
          };
        </script>
      </body></html>
    `;
    const fetchMock = vi.fn().mockResolvedValue(detailResponse(html, 'text/html'));

    const result = await getReportDetailByUrl('https://www.codal.ir/Reports/Decision.aspx?LetterSerial=script', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('fetched');
    expect(result.detail?.contentType).toBe('html');
    expect(result.detail?.tables).toHaveLength(1);
    expect(result.detail?.tables[0]).toEqual(
      expect.objectContaining({
        source: 'script-json',
        headers: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
        headersPreview: ['شرح', 'بهای تمام شده', 'ارزش بازار']
      })
    );
    expect(result.detail?.extractedTables[0].rows[1]).toEqual([
      'سرمایه گذاری در سهام',
      '1,234',
      '2,345'
    ]);
  });

  it('fetches report detail JSON and extracts table-like metadata', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const payload = {
      tables: [{ title: 'صورت وضعیت', headers: ['دارایی', 'مبلغ'], rows: [['نقد', '۱۰']] }]
    };
    const fetchMock = vi.fn().mockResolvedValue(detailResponse(payload, 'application/json'));

    const result = await getReportDetail(
      {
        symbol: 'وغدیر',
        title: 'صورت‌های مالی',
        publishedAt: '2026-06-18T09:00:00',
        url: '/Reports/Decision.aspx?LetterSerial=json'
      },
      {
        fetchImpl: fetchMock as unknown as typeof fetch
      }
    );

    expect(result.status).toBe('fetched');
    expect(result.detail?.symbol).toBe('وغدیر');
    expect(result.detail?.contentType).toBe('json');
    expect(result.detail?.rawJson).toEqual(payload);
    expect(result.detail?.plainTextPreview).toContain('10');
    expect(result.detail?.tables[0]).toEqual(
      expect.objectContaining({
        rowCount: 2,
        columnCount: 2,
        headers: ['دارایی', 'مبلغ'],
        caption: 'صورت وضعیت'
      })
    );
  });

  it('detects JSON cell-array table structures', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const payload = {
      data: {
        sheets: [
          {
            title: 'صورت وضعیت پورتفوی',
            cells: [
              { row: 0, column: 0, value: 'شرح' },
              { row: 0, column: 1, value: 'بهای تمام شده' },
              { row: 0, column: 2, value: 'ارزش روز' },
              { row: 1, column: 0, value: 'سرمایه گذاری در سهام' },
              { row: 1, column: 1, value: '۱۰۰' },
              { row: 1, column: 2, value: '۱۸۰' }
            ]
          }
        ]
      }
    };
    const fetchMock = vi.fn().mockResolvedValue(detailResponse(payload, 'application/json'));

    const result = await getReportDetailByUrl('https://www.codal.ir/Reports/Decision.aspx?LetterSerial=cells', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('fetched');
    expect(result.detail?.tables[0]).toEqual(
      expect.objectContaining({
        source: 'json',
        rowCount: 2,
        columnCount: 3,
        headers: ['شرح', 'بهای تمام شده', 'ارزش روز']
      })
    );
  });

  it('groups and reconstructs Codal cell-model rows by metaTableCode', () => {
    const cells = [
      {
        metaTableId: 10,
        metaTableCode: 2570,
        address: 'A1',
        cellGroupName: 'SummaryOfCompanyInvestments',
        rowSequence: 1,
        columnSequence: 1,
        value: 'شرح',
        valueTypeName: 'String',
        dataTypeName: 'Text'
      },
      {
        metaTableId: 10,
        metaTableCode: 2570,
        address: 'B1',
        cellGroupName: 'SummaryOfCompanyInvestments',
        rowSequence: 1,
        columnSequence: 2,
        value: 'بهای تمام شده'
      },
      {
        metaTableId: 10,
        metaTableCode: 2570,
        address: 'C1',
        cellGroupName: 'SummaryOfCompanyInvestments',
        rowSequence: 1,
        columnSequence: 3,
        value: 'ارزش بازار'
      },
      {
        metaTableId: 10,
        metaTableCode: 2570,
        address: 'A2',
        cellGroupName: 'SummaryOfCompanyInvestments',
        rowSequence: 2,
        columnSequence: 1,
        value: 'سهام شرکت های قابل معامله'
      },
      {
        metaTableId: 10,
        metaTableCode: 2570,
        address: 'B2',
        cellGroupName: 'SummaryOfCompanyInvestments',
        rowSequence: 2,
        columnSequence: 2,
        value: '۱۰۰'
      },
      {
        metaTableId: 10,
        metaTableCode: 2570,
        address: 'C2',
        cellGroupName: 'SummaryOfCompanyInvestments',
        rowSequence: 2,
        columnSequence: 3,
        value: '۱۸۰'
      },
      {
        metaTableId: 10,
        metaTableCode: 2570,
        address: 'A3',
        cellGroupName: 'SummaryOfCompanyInvestments',
        rowSequence: 3,
        columnSequence: 1,
        value: 'جمع'
      },
      {
        metaTableId: 10,
        metaTableCode: 2570,
        address: 'B3',
        cellGroupName: 'SummaryOfCompanyInvestments',
        rowSequence: 3,
        columnSequence: 2,
        value: '۱۰۰'
      },
      {
        metaTableId: 10,
        metaTableCode: 2570,
        address: 'C3',
        cellGroupName: 'SummaryOfCompanyInvestments',
        rowSequence: 3,
        columnSequence: 3,
        value: '۱۸۰'
      },
      {
        metaTableId: 11,
        metaTableCode: 3000,
        address: 'A1',
        cellGroupName: 'OtherTable',
        rowSequence: 1,
        columnSequence: 1,
        value: 'جدول دیگر'
      }
    ];

    const groups = groupCellsByMetaTableCode(cells);
    expect(groups.size).toBe(2);
    const table2570 = reconstructCodalCellTable(groups.get('2570:10') ?? []);

    expect(table2570).toEqual(
      expect.objectContaining({
        source: 'codal-cell-model',
        headers: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
        rows: expect.arrayContaining([
          ['سهام شرکت های قابل معامله', '100', '180'],
          ['جمع', '100', '180']
        ]),
        reconstruction: expect.objectContaining({
          metaTableCode: '2570',
          metaTableId: '10',
          rawCellCount: 9,
          rowCount: 3,
          columnCount: 3
        })
      })
    );
  });

  it('detects Codal cell-model JSON as reconstructed report matrices instead of technical field tables', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const payload = {
      cells: [
        { metaTableId: 10, metaTableCode: 2570, address: 'A1', cellGroupName: 'SummaryOfCompanyInvestments', rowSequence: 1, columnSequence: 1, value: 'شرح' },
        { metaTableId: 10, metaTableCode: 2570, address: 'B1', cellGroupName: 'SummaryOfCompanyInvestments', rowSequence: 1, columnSequence: 2, value: 'بهای تمام شده' },
        { metaTableId: 10, metaTableCode: 2570, address: 'C1', cellGroupName: 'SummaryOfCompanyInvestments', rowSequence: 1, columnSequence: 3, value: 'ارزش روز' },
        { metaTableId: 10, metaTableCode: 2570, address: 'A2', cellGroupName: 'SummaryOfCompanyInvestments', rowSequence: 2, columnSequence: 1, value: 'جمع' },
        { metaTableId: 10, metaTableCode: 2570, address: 'B2', cellGroupName: 'SummaryOfCompanyInvestments', rowSequence: 2, columnSequence: 2, value: '۱۰۰' },
        { metaTableId: 10, metaTableCode: 2570, address: 'C2', cellGroupName: 'SummaryOfCompanyInvestments', rowSequence: 2, columnSequence: 3, value: '۱۸۰' }
      ]
    };
    const fetchMock = vi.fn().mockResolvedValue(detailResponse(payload, 'application/json'));

    const result = await getReportDetailByUrl('https://www.codal.ir/Reports/Decision.aspx?LetterSerial=cells', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('fetched');
    expect(result.detail?.extractedTables[0]).toEqual(
      expect.objectContaining({
        source: 'codal-cell-model',
        headers: ['شرح', 'بهای تمام شده', 'ارزش روز'],
        rows: [
          ['شرح', 'بهای تمام شده', 'ارزش روز'],
          ['جمع', '100', '180']
        ],
        reconstruction: expect.objectContaining({ metaTableCode: '2570', rawCellCount: 6 })
      })
    );
    expect(result.detail?.tables[0].headers).not.toContain('metaTableId');
    expect(result.detail?.tables[0].headers).not.toContain('address');
    expect(result.detail?.tables[0].headers).toContain('بهای تمام شده');
  });

  it('reports duplicate and missing coordinates while reconstructing Codal cell-model tables', () => {
    const table = reconstructCodalCellTable([
      { metaTableId: 10, metaTableCode: 2570, address: 'A1', cellGroupName: 'SummaryOfCompanyInvestments', value: 'شرح' },
      { metaTableId: 10, metaTableCode: 2570, address: 'B1', cellGroupName: 'SummaryOfCompanyInvestments', value: 'بهای تمام شده' },
      { metaTableId: 10, metaTableCode: 2570, address: 'B1', cellGroupName: 'SummaryOfCompanyInvestments', value: 'مبلغ تمام شده' },
      { metaTableId: 10, metaTableCode: 2570, cellGroupName: 'SummaryOfCompanyInvestments', value: 'بدون مختصات' }
    ]);

    expect(table?.rows[0]).toEqual(['شرح', 'بهای تمام شده مبلغ تمام شده']);
    expect(table?.reconstruction?.warnings.join(' ')).toContain('skipped');
    expect(table?.reconstruction?.warnings.join(' ')).toContain('Duplicate');
  });

  it('constructs a report detail URL from tracing number metadata', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(detailResponse('<html><body>جزئیات گزارش</body></html>', 'text/html'));

    const result = await getReportDetailByTracingNo('abc123', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('fetched');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://www.codal.ir/Reports/Decision.aspx?LetterSerial=abc123'
    );
  });

  it('returns unsupported-format for empty detail content', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(detailResponse('<html><script>noop()</script></html>', 'text/html'));

    const result = await getReportDetailByUrl('https://www.codal.ir/Reports/Decision.aspx?LetterSerial=empty', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('unsupported-format');
    expect(result.errorMessage).toContain('no readable content');
  });

  it('returns a clear unsupported warning for PDF-like detail content', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(detailResponse('%PDF-1.7', 'application/pdf'));

    const result = await getReportDetailByUrl('https://www.codal.ir/Reports/Decision.aspx?LetterSerial=pdf', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('unsupported-format');
    expect(result.detail?.parserWarnings[0]).toContain('PDF');
  });

  it('returns timeout detail status when the detail fetch aborts', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));

    const result = await getReportDetailByUrl('https://www.codal.ir/Reports/Decision.aspx?LetterSerial=timeout', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(result.status).toBe('timeout');
    expect(result.errorMessage).toContain('timed out');
  });

  it('extracts table metadata without depending on a single selector', () => {
    const tables = extractTableMetadataFromHtml(`
      <section><table><tr><td>A</td><td>B</td></tr></table></section>
      <div><table><tr><th>H1</th></tr><tr><td>V1</td></tr></table></div>
    `);

    expect(tables).toHaveLength(2);
    expect(tables[0]).toEqual(expect.objectContaining({ rowCount: 1, columnCount: 2 }));
    expect(tables[1]).toEqual(expect.objectContaining({ rowCount: 2, headers: ['H1'] }));
  });

  it('extracts table objects from HTML scripts for parser reuse', () => {
    const tables = extractTablesFromHtml(`
      <script>
        var codal = {
          tables: [{
            title: 'گزارش فعالیت ماهانه',
            headers: ['شرح','بهای تمام شده'],
            rows: [['سرمایه گذاری در سهام','۱۲۳']]
          }]
        };
      </script>
    `);

    expect(tables).toHaveLength(1);
    expect(tables[0]).toEqual(
      expect.objectContaining({
        source: 'script-json',
        caption: 'گزارش فعالیت ماهانه',
        headers: ['شرح', 'بهای تمام شده']
      })
    );
  });

  it('detects report types from titles', () => {
    expect(isMonthlyActivityReport('گزارش فعالیت ماهانه دوره ۱ ماهه')).toBe(true);
    expect(isMonthlyActivityReport('گزارش فعالیت هیئت مدیره دوره ۱۲ ماهه')).toBe(false);
    expect(isFinancialStatementReport('صورت‌های مالی سال مالی منتهی')).toBe(true);
    expect(isFinancialStatementReport('اطلاعات و صورت‌های مالی میاندوره‌ای')).toBe(true);
    expect(isFinancialStatementReport('توضیحات در خصوص اطلاعات و صورت های مالی منتشر شده')).toBe(false);
    expect(isFinancialStatementReport('شفاف‌سازی در خصوص صورت‌های مالی')).toBe(false);
    expect(isFinancialStatementReport('افشای اطلاعات بااهمیت در خصوص صورت‌های مالی')).toBe(false);
    expect(isPortfolioReport('صورت وضعیت پرتفوی شرکت')).toBe(true);
  });
});
