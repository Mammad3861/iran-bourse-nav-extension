import { describe, expect, it } from 'vitest';
import { analyzeNavCompleteness, calculateNav } from '../core/nav-calculator';

describe('calculateNav', () => {
  it('calculates total NAV from equity and portfolio surplus values', () => {
    const result = calculateNav({
      equity: 1_000_000,
      listedPortfolioMarketValue: 700_000,
      listedPortfolioCostValue: 400_000,
      unlistedPortfolioSurplus: 200_000,
      totalShares: 100_000,
      currentPrice: 18
    });

    expect(result.navTotal).toBe(1_500_000);
    expect(result.navPerShare).toBe(15);
    expect(result.pToNav).toBe(1.2);
  });

  it('does not divide by zero when total shares are missing', () => {
    const result = calculateNav({
      equity: 1_000,
      listedPortfolioMarketValue: 0,
      listedPortfolioCostValue: 0,
      unlistedPortfolioSurplus: 0,
      totalShares: 0,
      currentPrice: 100
    });

    expect(result.navTotal).toBe(1_000);
    expect(result.navPerShare).toBeNull();
    expect(result.pToNav).toBeNull();
  });

  it('returns no P/NAV when current price is unavailable', () => {
    const result = calculateNav({
      equity: 1_000,
      listedPortfolioMarketValue: 0,
      listedPortfolioCostValue: 0,
      unlistedPortfolioSurplus: 0,
      totalShares: 100
    });

    expect(result.navPerShare).toBe(10);
    expect(result.pToNav).toBeNull();
  });

  it('warns when listed cost is entered without listed market value', () => {
    const analysis = analyzeNavCompleteness({
      equity: undefined,
      listedPortfolioMarketValue: undefined,
      listedPortfolioCostValue: 136_494_769,
      unlistedPortfolioSurplus: undefined,
      totalShares: undefined
    });

    expect(analysis.status).toBe('needs-review');
    expect(analysis.warnings).toEqual(
      expect.arrayContaining([
        'محاسبه NAV ناقص است؛ بهای تمام‌شده وارد شده اما ارزش روز پرتفوی بورسی وارد نشده است.',
        'حقوق صاحبان سهام وارد نشده است.',
        'تعداد کل سهام وارد نشده است؛ NAV هر سهم و P/NAV محاسبه نمی‌شود.'
      ])
    );
    expect(analysis.warnings.some((warning) => warning.includes('NAV منفی'))).toBe(false);
    expect(analysis.navTotalAvailable).toBe(false);
  });

  it('warns when listed market value is entered without listed cost', () => {
    const analysis = analyzeNavCompleteness({
      equity: 100,
      listedPortfolioMarketValue: 500,
      listedPortfolioCostValue: undefined,
      unlistedPortfolioSurplus: 0,
      totalShares: 10
    });

    expect(analysis.status).toBe('needs-review');
    expect(analysis.warnings).toContain('محاسبه NAV ناقص است؛ ارزش روز وارد شده اما بهای تمام‌شده وارد نشده است.');
  });

  it('treats manually entered listed market value as present', () => {
    const analysis = analyzeNavCompleteness({
      equity: undefined,
      listedPortfolioMarketValue: 500,
      listedPortfolioCostValue: 400,
      unlistedPortfolioSurplus: undefined,
      totalShares: undefined
    });

    expect(analysis.missingFields).not.toContain('listedPortfolioMarketValue');
    expect(analysis.warnings.join(' ')).not.toContain('ارزش روز پرتفوی بورسی وارد نشده است');
  });

  it('treats typed zero as a real explicit value', () => {
    const analysis = analyzeNavCompleteness({
      equity: 100,
      listedPortfolioMarketValue: 0,
      listedPortfolioCostValue: 50,
      unlistedPortfolioSurplus: 0,
      totalShares: 10
    });

    expect(analysis.navTotalAvailable).toBe(true);
    expect(analysis.explicitZeroFields).toEqual(
      expect.arrayContaining(['listedPortfolioMarketValue', 'unlistedPortfolioSurplus'])
    );
    expect(analysis.warnings).toContain(
      'ارزش روز پرتفوی بورسی صفر ثبت شده در حالی که بهای تمام‌شده مثبت است؛ مقدار را بررسی کنید.'
    );
  });

  it('marks complete inputs as complete', () => {
    const analysis = analyzeNavCompleteness({
        equity: 1000,
        listedPortfolioMarketValue: 500,
        listedPortfolioCostValue: 400,
        unlistedPortfolioSurplus: 0,
        totalShares: 100
      });

    expect(analysis.status).toBe('complete');
    expect(analysis.warnings).toEqual([]);
    expect(analysis.navTotalAvailable).toBe(true);
    expect(analysis.missingFields).toEqual([]);
  });
});
