export interface NavInputs {
  equity: number;
  listedPortfolioMarketValue: number;
  listedPortfolioCostValue: number;
  unlistedPortfolioSurplus: number;
  totalShares: number;
  currentPrice?: number;
}

export interface NavResult {
  navTotal: number;
  navPerShare: number | null;
  pToNav: number | null;
}

export function calculateNav(inputs: NavInputs): NavResult {
  const navTotal =
    inputs.equity +
    (inputs.listedPortfolioMarketValue - inputs.listedPortfolioCostValue) +
    inputs.unlistedPortfolioSurplus;

  const navPerShare = inputs.totalShares > 0 ? navTotal / inputs.totalShares : null;
  const pToNav =
    navPerShare !== null && navPerShare > 0 && inputs.currentPrice !== undefined
      ? inputs.currentPrice / navPerShare
      : null;

  return {
    navTotal,
    navPerShare,
    pToNav
  };
}

export function emptyNavInputs(): NavInputs {
  return {
    equity: 0,
    listedPortfolioMarketValue: 0,
    listedPortfolioCostValue: 0,
    unlistedPortfolioSurplus: 0,
    totalShares: 0,
    currentPrice: undefined
  };
}
