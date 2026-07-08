import { describe, expect, it } from 'vitest';
import { analyzeNavCompleteness, calculateNav } from '../core/nav-calculator';

describe('calculateNav', () => {
  it('calculates the baseline manual NAV workflow values', () => {
    const result = calculateNav({
      equity: 1_000_000_000,
      listedPortfolioMarketValue: 700_000_000,
      listedPortfolioCostValue: 500_000_000,
      unlistedPortfolioSurplus: 0,
      totalShares: 1_000_000,
      currentPrice: 1_500
    });

    expect(result.navTotal).toBe(1_200_000_000);
    expect(result.navPerShare).toBe(1_200);
    expect(result.pToNav).toBe(1.25);

    const analysis = analyzeNavCompleteness({
      equity: 1_000_000_000,
      listedPortfolioMarketValue: 700_000_000,
      listedPortfolioCostValue: 500_000_000,
      unlistedPortfolioSurplus: 0,
      totalShares: 1_000_000,
      currentPrice: 1_500
    });

    expect(analysis.status).toBe('complete');
    expect(analysis.navTotalAvailable).toBe(true);
    expect(analysis.missingFields).toEqual([]);
    expect(analysis.explicitZeroFields).toEqual(['unlistedPortfolioSurplus']);
  });

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

  it('keeps NAV total available while NAV/share is unavailable when total shares are missing', () => {
    const inputs = {
      equity: 1_000_000_000,
      listedPortfolioMarketValue: 700_000_000,
      listedPortfolioCostValue: 500_000_000,
      unlistedPortfolioSurplus: 0
    };

    const result = calculateNav(inputs);
    const analysis = analyzeNavCompleteness(inputs);

    expect(result.navTotal).toBe(1_200_000_000);
    expect(result.navPerShare).toBeNull();
    expect(result.pToNav).toBeNull();
    expect(analysis.navTotalAvailable).toBe(true);
    expect(analysis.warnings).toContain('تعداد کل سهام وارد نشده است؛ NAV هر سهم و P/NAV محاسبه نمی‌شود.');
  });

  it('keeps NAV/share available but P/NAV unavailable when current price is missing', () => {
    const result = calculateNav({
      equity: 1_000_000_000,
      listedPortfolioMarketValue: 700_000_000,
      listedPortfolioCostValue: 500_000_000,
      unlistedPortfolioSurplus: 0,
      totalShares: 1_000_000
    });

    expect(result.navTotal).toBe(1_200_000_000);
    expect(result.navPerShare).toBe(1_200);
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

  it('marks missing equity as incomplete', () => {
    const analysis = analyzeNavCompleteness({
      listedPortfolioMarketValue: 700_000_000,
      listedPortfolioCostValue: 500_000_000,
      unlistedPortfolioSurplus: 0,
      totalShares: 1_000_000,
      currentPrice: 1_500
    });

    expect(analysis.navTotalAvailable).toBe(false);
    expect(analysis.missingFields).toContain('equity');
    expect(analysis.warnings).toContain('حقوق صاحبان سهام وارد نشده است.');
  });

  it('marks totalShares zero invalid for NAV/share', () => {
    const result = calculateNav({
      equity: 1_000_000_000,
      listedPortfolioMarketValue: 700_000_000,
      listedPortfolioCostValue: 500_000_000,
      unlistedPortfolioSurplus: 0,
      totalShares: 0,
      currentPrice: 1_500
    });
    const analysis = analyzeNavCompleteness({
      equity: 1_000_000_000,
      listedPortfolioMarketValue: 700_000_000,
      listedPortfolioCostValue: 500_000_000,
      unlistedPortfolioSurplus: 0,
      totalShares: 0,
      currentPrice: 1_500
    });

    expect(result.navTotal).toBe(1_200_000_000);
    expect(result.navPerShare).toBeNull();
    expect(result.pToNav).toBeNull();
    expect(analysis.navTotalAvailable).toBe(true);
    expect(analysis.explicitZeroFields).toContain('totalShares');
    expect(analysis.warnings).toContain('تعداد کل سهام وارد نشده است؛ NAV هر سهم و P/NAV محاسبه نمی‌شود.');
  });

  it('warns when complete inputs produce negative NAV', () => {
    const analysis = analyzeNavCompleteness({
      equity: 100,
      listedPortfolioMarketValue: 50,
      listedPortfolioCostValue: 500,
      unlistedPortfolioSurplus: 0,
      totalShares: 10,
      currentPrice: 20
    });

    expect(calculateNav({
      equity: 100,
      listedPortfolioMarketValue: 50,
      listedPortfolioCostValue: 500,
      unlistedPortfolioSurplus: 0,
      totalShares: 10,
      currentPrice: 20
    }).navTotal).toBe(-350);
    expect(analysis.navTotalAvailable).toBe(true);
    expect(analysis.status).toBe('needs-review');
    expect(analysis.warnings).toContain('NAV منفی شده است؛ ورودی‌ها، واحدها و دوره گزارش‌ها را بررسی کنید.');
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
