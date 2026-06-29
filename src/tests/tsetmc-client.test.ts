import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectCurrentTsetmcSymbol,
  detectInsCodeFromUrl,
  getInstrumentInfoByInsCode,
  getLatestPriceByInsCode,
  readClosingPriceFromDocument,
  readCurrentPriceFromDocument,
  searchSymbols,
  snapshotTsetmcPage
} from '../data/tsetmc-client';

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

describe('tsetmc-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('searches symbols and normalizes instrument search results', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        instrumentSearch: [
          {
            insCode: '123456789',
            lVal18AFC: 'TEST1',
            lVal30: 'Test Company One',
            cIsin: 'IRO1TEST0001',
            marketName: 'TSE'
          }
        ]
      })
    );

    const results = await searchSymbols('TEST', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://cdn.tsetmc.com/api/Instrument/GetInstrumentSearch/TEST'
    );
    expect(results).toEqual([
      expect.objectContaining({
        insCode: '123456789',
        symbol: 'TEST1',
        name: 'Test Company One',
        isin: 'IRO1TEST0001',
        market: 'TSE'
      })
    ]);
    expect(storage.chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it('returns cached symbol search results without calling fetch', async () => {
    const storage = createChromeStorageMock({
      'tsetmc:search:ABC': {
        createdAt: new Date().toISOString(),
        value: [{ insCode: '1', symbol: 'ABC' }]
      }
    });
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn();

    const results = await searchSymbols('ABC', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results[0]).toEqual({ insCode: '1', symbol: 'ABC' });
  });

  it('fetches instrument identity by InsCode', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        instrumentInfo: {
          insCode: '123',
          lVal18AFC: 'ABC',
          lVal30: 'ABC Holding',
          cIsin: 'IRO1ABC0001',
          sectorName: 'Investments',
          zTitad: 5000000
        }
      })
    );

    const info = await getInstrumentInfoByInsCode('123', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://cdn.tsetmc.com/api/Instrument/GetInstrumentInfo/123');
    expect(info).toEqual(
      expect.objectContaining({
        insCode: '123',
        symbol: 'ABC',
        name: 'ABC Holding',
        totalShares: 5000000
      })
    );
  });

  it('fetches latest last trade and closing prices by InsCode', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        closingPriceInfo: {
          insCode: '123',
          pDrCotVal: 1450,
          pClosing: 1430,
          priceYesterday: 1400,
          dEven: '20260628'
        }
      })
    );

    const price = await getLatestPriceByInsCode('123', {
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/123'
    );
    expect(price).toEqual(
      expect.objectContaining({
        insCode: '123',
        lastTradePrice: 1450,
        closingPrice: 1430,
        source: 'api'
      })
    );
  });

  it('falls back to DOM price extraction when latest price fetch fails', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'unavailable' }, 503));
    const documentMock = {
      querySelector: vi.fn((selector: string) =>
        selector === '[data-current-price]' ? { textContent: '1,250' } : null
      ),
      querySelectorAll: vi.fn(() => [])
    } as unknown as Document;

    const price = await getLatestPriceByInsCode('123', {
      retryLimit: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
      fallbackDocument: documentMock
    });

    expect(price).toEqual({
      insCode: '123',
      lastTradePrice: 1250,
      source: 'dom'
    });
  });

  it('throws a clear error after retry exhaustion', async () => {
    const storage = createChromeStorageMock();
    vi.stubGlobal('chrome', storage.chrome);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'temporary' }, 503));

    await expect(
      getInstrumentInfoByInsCode('123', {
        retryLimit: 1,
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow('TSETMC request failed after 2 attempt(s): TSETMC request failed with HTTP 503.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('detects InsCode from current TSETMC instrument URLs', () => {
    expect(detectInsCodeFromUrl('https://www.tsetmc.com/instInfo/778253364357513')).toBe(
      '778253364357513'
    );
    expect(detectInsCodeFromUrl('https://old.tsetmc.com/Loader.aspx?ParTree=151311&i=778253364357513')).toBe(
      '778253364357513'
    );
  });

  it('detects symbol from the real TSETMC header pattern instead of the instInfo path', () => {
    const header = { textContent: 'بانك ملت (وبملت) - بازار اول (تابلوی اصلی) بورس' };
    const documentMock = {
      querySelectorAll: vi.fn((selector: string) => {
        if (selector.includes('bigheader')) {
          return [header];
        }
        return [];
      }),
      querySelector: vi.fn(() => null)
    } as unknown as Document;

    expect(
      detectCurrentTsetmcSymbol(documentMock, 'https://www.tsetmc.com/instInfo/778253364357513')
    ).toEqual({ symbol: 'وبملت', source: 'dom' });
  });

  it('does not turn an InsCode-only URL into a display or Codal symbol', () => {
    const documentMock = {
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null)
    } as unknown as Document;

    const snapshot = snapshotTsetmcPage(
      documentMock,
      'https://www.tsetmc.com/instInfo/37204371816016200'
    );

    expect(snapshot.insCode).toBe('37204371816016200');
    expect(snapshot.displaySymbol).toBeUndefined();
    expect(snapshot.codalSymbol).toBeUndefined();
  });

  it('keeps InsCode and Persian symbol separate when both are available', () => {
    const header = {
      textContent: 'سرمایه گذاری صندوق بازنشستگی (وصندوق) - بازار اول بورس'
    };
    const rows = [{ textContent: 'آخرین معامله2,430 (10) [0.4%]' }];
    const documentMock = {
      querySelectorAll: vi.fn((selector: string) => {
        if (selector.includes('bigheader')) return [header];
        if (selector.includes('tr')) return rows;
        return [];
      }),
      querySelector: vi.fn(() => null)
    } as unknown as Document;

    const snapshot = snapshotTsetmcPage(
      documentMock,
      'https://www.tsetmc.com/instInfo/37204371816016200'
    );

    expect(snapshot).toEqual(
      expect.objectContaining({
        insCode: '37204371816016200',
        displaySymbol: 'وصندوق',
        codalSymbol: 'وصندوق',
        currentPrice: 2430
      })
    );
  });

  it('does not treat the TSETMC site title as a stock symbol', () => {
    const title = {
      textContent: '.:TSETMC:. :: مدیریت فناوری بورس تهران',
      getAttribute: vi.fn(() => null)
    };
    const documentMock = {
      querySelectorAll: vi.fn((selector: string) => {
        if (selector.includes('title')) {
          return [title];
        }
        return [];
      }),
      querySelector: vi.fn((selector: string) => (selector === 'title' ? title : null))
    } as unknown as Document;

    expect(detectCurrentTsetmcSymbol(documentMock, 'https://www.tsetmc.com/')).toEqual({
      source: 'unknown'
    });
  });

  it('reads latest and closing prices from compact TSETMC table rows', () => {
    const rows = [
      { textContent: 'آخرین معامله1,255 (38) [2.94%-]' },
      { textContent: 'قیمت پایانی1,256 (37) [2.86%-]' }
    ];
    const documentMock = {
      querySelectorAll: vi.fn((selector: string) => (selector.includes('tr') ? rows : [])),
      querySelector: vi.fn(() => null)
    } as unknown as Document;

    expect(readCurrentPriceFromDocument(documentMock)).toBe(1255);
    expect(readClosingPriceFromDocument(documentMock)).toBe(1256);
  });

  it('returns undefined price when no reliable price exists', () => {
    const documentMock = {
      querySelectorAll: vi.fn(() => [{ textContent: 'قیمت نامشخص' }]),
      querySelector: vi.fn(() => null)
    } as unknown as Document;

    expect(readCurrentPriceFromDocument(documentMock)).toBeUndefined();
  });
});
