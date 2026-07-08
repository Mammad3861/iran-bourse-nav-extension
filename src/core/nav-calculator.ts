export interface NavInputs {
  equity?: number;
  listedPortfolioMarketValue?: number;
  listedPortfolioCostValue?: number;
  unlistedPortfolioSurplus?: number;
  totalShares?: number;
  currentPrice?: number;
}

export interface NavResult {
  navTotal: number;
  navPerShare: number | null;
  pToNav: number | null;
}

export type NavCalculationStatus = 'complete' | 'incomplete' | 'needs-review';

export interface NavCompletenessResult {
  status: NavCalculationStatus;
  warnings: string[];
  navTotalAvailable: boolean;
  missingFields: Array<keyof NavInputs>;
  explicitZeroFields: Array<keyof NavInputs>;
}

export function calculateNav(inputs: NavInputs): NavResult {
  const navTotal =
    (inputs.equity ?? 0) +
    ((inputs.listedPortfolioMarketValue ?? 0) - (inputs.listedPortfolioCostValue ?? 0)) +
    (inputs.unlistedPortfolioSurplus ?? 0);

  const navPerShare = inputs.totalShares !== undefined && inputs.totalShares > 0 ? navTotal / inputs.totalShares : null;
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

export function analyzeNavCompleteness(inputs: NavInputs): NavCompletenessResult {
  const warnings: string[] = [];
  const requiredFields: Array<keyof NavInputs> = [
    'equity',
    'listedPortfolioMarketValue',
    'listedPortfolioCostValue',
    'unlistedPortfolioSurplus'
  ];
  const missingFields = requiredFields.filter((field) => inputs[field] === undefined);
  const zeroTrackFields: Array<keyof NavInputs> = [...requiredFields, 'totalShares'];
  const explicitZeroFields = zeroTrackFields.filter((field) => inputs[field] === 0);
  const cost = inputs.listedPortfolioCostValue;
  const market = inputs.listedPortfolioMarketValue;

  if (cost !== undefined && cost > 0 && market === undefined) {
    warnings.push('محاسبه NAV ناقص است؛ بهای تمام‌شده وارد شده اما ارزش روز پرتفوی بورسی وارد نشده است.');
  }

  if (cost !== undefined && cost > 0 && market === 0) {
    warnings.push('ارزش روز پرتفوی بورسی صفر ثبت شده در حالی که بهای تمام‌شده مثبت است؛ مقدار را بررسی کنید.');
  }

  if (market !== undefined && market > 0 && cost === undefined) {
    warnings.push('محاسبه NAV ناقص است؛ ارزش روز وارد شده اما بهای تمام‌شده وارد نشده است.');
  }

  if (market !== undefined && market > 0 && cost === 0) {
    warnings.push('محاسبه NAV نیازمند بررسی دستی است؛ ارزش روز وارد شده اما بهای تمام‌شده صفر وارد شده است.');
  }

  if (inputs.equity === undefined) {
    warnings.push('حقوق صاحبان سهام وارد نشده است.');
  }

  if (inputs.unlistedPortfolioSurplus === undefined) {
    warnings.push('مازاد ارزش پرتفوی غیربورسی وارد نشده است؛ اگر واقعاً صفر است، عدد 0 را وارد کنید.');
  }

  if (inputs.totalShares === undefined || inputs.totalShares <= 0) {
    warnings.push('تعداد کل سهام وارد نشده است؛ NAV هر سهم و P/NAV محاسبه نمی‌شود.');
  }

  const navTotal =
    (inputs.equity ?? 0) +
    ((inputs.listedPortfolioMarketValue ?? 0) - (inputs.listedPortfolioCostValue ?? 0)) +
    (inputs.unlistedPortfolioSurplus ?? 0);
  const navTotalAvailable = missingFields.length === 0;
  if (navTotalAvailable && navTotal < 0) {
    warnings.push('NAV منفی شده است؛ ورودی‌ها، واحدها و دوره گزارش‌ها را بررسی کنید.');
  }

  const status: NavCalculationStatus =
    warnings.length === 0 ? 'complete' : cost !== undefined || market !== undefined ? 'needs-review' : 'incomplete';

  return { status, warnings, navTotalAvailable, missingFields, explicitZeroFields };
}

export function emptyNavInputs(): NavInputs {
  return {
    equity: undefined,
    listedPortfolioMarketValue: undefined,
    listedPortfolioCostValue: undefined,
    unlistedPortfolioSurplus: undefined,
    totalShares: undefined,
    currentPrice: undefined
  };
}
