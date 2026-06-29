import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCodalMessageHandler } from '../background/codal-message-handler';
import { requestCodalDiscovery } from '../data/codal-transport';
import { validateCodalSearchSymbol } from '../data/codal-symbol-validation';

function mockDependencies() {
  return {
    searchReportsBySymbol: vi.fn(),
    getLatestMonthlyActivityReport: vi.fn(),
    getLatestFinancialStatement: vi.fn(),
    discoverLatestCodalReports: vi.fn(),
    getReportDetail: vi.fn()
  };
}

describe('Codal background bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps Codal network URLs and fetch calls out of content/widget/popup runtime code', () => {
    const files = ['src/content/tsetmc-content.ts', 'src/ui/nav-widget.ts', 'src/popup/popup.ts'];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('search.codal.ir');
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toContain('discoverLatestCodalReports');
      expect(source).not.toContain('getReportDetail(');
    }
  });

  it('rejects invalid TSETMC/site labels before Codal search', () => {
    expect(validateCodalSearchSymbol('TSETMC').valid).toBe(false);
    expect(validateCodalSearchSymbol('خرید').valid).toBe(false);
    expect(validateCodalSearchSymbol('فروش').valid).toBe(false);
    expect(validateCodalSearchSymbol('پرتفوی').valid).toBe(false);
    expect(validateCodalSearchSymbol('نماد نامشخص').valid).toBe(false);
    expect(validateCodalSearchSymbol('https://www.tsetmc.com').valid).toBe(false);
    expect(validateCodalSearchSymbol('778253364357513').valid).toBe(false);
    expect(validateCodalSearchSymbol('وغدیر')).toEqual({ valid: true, symbol: 'وغدیر' });
    expect(validateCodalSearchSymbol('وصندوق')).toEqual({ valid: true, symbol: 'وصندوق' });
    expect(validateCodalSearchSymbol('وبانک')).toEqual({ valid: true, symbol: 'وبانک' });
    expect(validateCodalSearchSymbol('وامید')).toEqual({ valid: true, symbol: 'وامید' });
    expect(validateCodalSearchSymbol('خگستر')).toEqual({ valid: true, symbol: 'خگستر' });
  });

  it('does not call Codal client for invalid discovery symbols', async () => {
    const dependencies = mockDependencies();
    const handler = createCodalMessageHandler(dependencies);

    const response = await handler({ type: 'CODAL_DISCOVER_LATEST_REPORTS', symbol: 'TSETMC' });

    expect(dependencies.discoverLatestCodalReports).not.toHaveBeenCalled();
    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          status: 'not-found',
          errorMessage: 'نماد معتبر تشخیص داده نشد؛ جستجوی کدال انجام نشد'
        })
      })
    );
  });

  it('sends one background message for a valid Persian symbol', async () => {
    const sendMessage = vi.fn((_message, callback: (response: unknown) => void) => {
      callback({
        ok: true,
        data: {
          status: 'not-found',
          symbol: 'وغدیر',
          sourceVerified: false,
          checkedAt: '2026-06-28T00:00:00.000Z'
        }
      });
    });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
        lastError: undefined
      }
    });

    const result = await requestCodalDiscovery('وغدیر');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toEqual({
      type: 'CODAL_DISCOVER_LATEST_REPORTS',
      symbol: 'وغدیر'
    });
    expect(result.status).toBe('not-found');
  });

  it('background handler calls Codal client for valid discovery symbols', async () => {
    const dependencies = mockDependencies();
    dependencies.discoverLatestCodalReports.mockResolvedValue({
      status: 'found',
      symbol: 'وغدیر',
      sourceVerified: false,
      checkedAt: '2026-06-28T00:00:00.000Z'
    });
    const handler = createCodalMessageHandler(dependencies);

    const response = await handler({ type: 'CODAL_DISCOVER_LATEST_REPORTS', symbol: 'وغدیر' });

    expect(dependencies.discoverLatestCodalReports).toHaveBeenCalledTimes(1);
    expect(dependencies.discoverLatestCodalReports).toHaveBeenCalledWith('وغدیر');
    expect(response).toEqual(expect.objectContaining({ ok: true }));
  });

  it('reuses in-flight background Codal requests for the same symbol', async () => {
    const dependencies = mockDependencies();
    let resolveDiscovery: (value: unknown) => void = () => {};
    dependencies.discoverLatestCodalReports.mockReturnValue(
      new Promise((resolve) => {
        resolveDiscovery = resolve;
      })
    );
    const handler = createCodalMessageHandler(dependencies);

    const first = handler({ type: 'CODAL_DISCOVER_LATEST_REPORTS', symbol: 'وغدیر' });
    const second = handler({ type: 'CODAL_DISCOVER_LATEST_REPORTS', symbol: 'وغدیر' });

    resolveDiscovery({
      status: 'not-found',
      symbol: 'وغدیر',
      sourceVerified: false,
      checkedAt: '2026-06-28T00:00:00.000Z'
    });

    await Promise.all([first, second]);
    expect(dependencies.discoverLatestCodalReports).toHaveBeenCalledTimes(1);
  });

  it('background handler returns a safe error object when Codal client fails', async () => {
    const dependencies = mockDependencies();
    dependencies.discoverLatestCodalReports.mockRejectedValue(new Error('failed fetch'));
    const handler = createCodalMessageHandler(dependencies);

    const response = await handler({ type: 'CODAL_DISCOVER_LATEST_REPORTS', symbol: 'وغدیر' });

    expect(response).toEqual({
      ok: false,
      errorMessage: 'failed fetch'
    });
  });
});
