import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverLatestCodalReports,
  extractTableMetadataFromHtml,
  getLatestFinancialStatement,
  getLatestMonthlyActivityReport,
  getReportDetail,
  getReportDetailByTracingNo,
  getReportDetailByUrl,
  isFinancialStatementReport,
  isMonthlyActivityReport,
  isPortfolioReport,
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
    expect(result.detail?.tables[0]).toEqual(
      expect.objectContaining({
        rowCount: 2,
        columnCount: 2,
        headers: ['شرح', 'مبلغ'],
        caption: 'خلاصه'
      })
    );
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
    expect(result.detail?.rawJson).toEqual(payload);
    expect(result.detail?.plainTextPreview).toContain('10');
    expect(result.detail?.tables[0]).toEqual(
      expect.objectContaining({
        rowCount: 1,
        columnCount: 2,
        headers: ['دارایی', 'مبلغ'],
        caption: 'صورت وضعیت'
      })
    );
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

  it('detects report types from titles', () => {
    expect(isMonthlyActivityReport('گزارش فعالیت ماهانه دوره ۱ ماهه')).toBe(true);
    expect(isMonthlyActivityReport('گزارش فعالیت هیئت مدیره دوره ۱۲ ماهه')).toBe(false);
    expect(isFinancialStatementReport('صورت‌های مالی سال مالی منتهی')).toBe(true);
    expect(isPortfolioReport('صورت وضعیت پرتفوی شرکت')).toBe(true);
  });
});
