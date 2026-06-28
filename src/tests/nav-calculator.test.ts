import { describe, expect, it } from 'vitest';
import { calculateNav } from '../core/nav-calculator';

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
});
