import type { NavInputs } from '../core/nav-calculator';
import { analyzeNavCompleteness } from '../core/nav-calculator';
import type { MonthlyActivityParseResult } from './codal-monthly-parser';
import type { ManualOverrideRecord, ManualValueSourceMetadata } from './manual-overrides';

export type NavCompletionStatus = 'incomplete' | 'calculable-warning' | 'complete-needs-review' | 'complete-reviewed';

export interface NavCompletionFieldState {
  field: keyof NavInputs;
  label: string;
  value: number | undefined;
  statusLabel: string;
  present: boolean;
  needsReview: boolean;
  canConfirmReview: boolean;
  canConfirmZero: boolean;
  guidance: string;
}

export interface NavCompletionSummary {
  status: NavCompletionStatus;
  statusLabel: string;
  navTotalMissingFields: Array<keyof NavInputs>;
  navShareMissingFields: Array<keyof NavInputs>;
  fields: NavCompletionFieldState[];
  pairWarnings: string[];
  summaryText: string;
  navShareGuidance: string;
}

const fieldLabels: Record<keyof NavInputs, string> = {
  equity: 'حقوق صاحبان سهام',
  listedPortfolioMarketValue: 'ارزش روز پرتفوی بورسی',
  listedPortfolioCostValue: 'بهای تمام‌شده پرتفوی بورسی',
  unlistedPortfolioSurplus: 'مازاد ارزش پرتفوی غیربورسی',
  totalShares: 'تعداد کل سهام',
  currentPrice: 'قیمت فعلی سهم'
};

const navTotalFields: Array<keyof NavInputs> = [
  'equity',
  'listedPortfolioMarketValue',
  'listedPortfolioCostValue',
  'unlistedPortfolioSurplus'
];

const workflowFields: Array<keyof NavInputs> = [...navTotalFields, 'totalShares', 'currentPrice'];

function appliedSuggestionSource(source: ManualValueSourceMetadata | undefined): boolean {
  return Boolean(
    source &&
      (source.source === 'codal-suggestion' ||
        source.source === 'codal-excel-manual-review' ||
        source.source === 'tsetmc-suggestion' ||
        source.source === 'financial-statement-suggestion')
  );
}

function effectiveSourceForField(
  field: keyof NavInputs,
  source: ManualValueSourceMetadata | undefined
): ManualValueSourceMetadata['source'] | undefined {
  if (
    field === 'totalShares' &&
    source?.source === 'codal-suggestion' &&
    /TSETMC/i.test(`${source.reportTitle ?? ''} ${source.columnLabel ?? ''} ${source.rowLabel ?? ''}`)
  ) {
    return 'tsetmc-suggestion';
  }
  return source?.source;
}

function statusLabelForSource(
  field: keyof NavInputs,
  source: ManualValueSourceMetadata | undefined,
  value: number | undefined,
  record: ManualOverrideRecord
): string {
  if (value === undefined || !Number.isFinite(value)) return 'وارد نشده';
  if (field === 'currentPrice') {
    if (source?.stale) return 'مقدار ذخیره‌شده قدیمی / stale';
    if (record.currentPriceSource === 'dom-latest-trade' || record.currentPriceSource === 'api-latest-trade' || record.currentPriceSource === 'page') {
      return 'خوانده‌شده از آخرین معامله / TSETMC';
    }
    if (record.currentPriceSource === 'dom-closing-price' || record.currentPriceSource === 'api-closing-price') {
      return 'خوانده‌شده از قیمت پایانی / TSETMC';
    }
    if (record.currentPriceSource === 'manual' || source?.source === 'manual') return 'وارد شده دستی';
  }
  if (!source) return 'مقدار ذخیره‌شده قدیمی / stale';
  const effectiveSource = effectiveSourceForField(field, source);
  if (effectiveSource === 'manual') return value === 0 ? 'صفر تأییدشده توسط کاربر' : 'وارد شده دستی';
  if (effectiveSource === 'user-confirmed-zero') return 'صفر تأییدشده توسط کاربر';
  if (source.stale) return 'مقدار ذخیره‌شده قدیمی / stale';
  if (effectiveSource === 'tsetmc-suggestion') return 'اعمال‌شده از پیشنهاد TSETMC';
  if (effectiveSource === 'codal-excel-manual-review') return 'اعمال‌شده از بررسی دستی Excel کدال';
  if (effectiveSource === 'financial-statement-suggestion') return 'اعمال‌شده از صورت مالی کدال';
  if (effectiveSource === 'codal-suggestion') return 'اعمال‌شده از پیشنهاد کدال';
  return 'نیازمند بررسی دستی';
}

function fieldNeedsReview(source: ManualValueSourceMetadata | undefined, value: number | undefined): boolean {
  if (value === undefined || !Number.isFinite(value)) return false;
  if (!source) return true;
  if (source.source === 'manual' || source.source === 'user-confirmed-zero') return false;
  if (source.stale || source.confidence === 'low') return true;
  return appliedSuggestionSource(source) && source.reviewedByUser !== true;
}

function navShareGuidance(
  navTotalComplete: boolean,
  inputs: NavInputs
): string {
  const totalSharesMissing = inputs.totalShares === undefined || inputs.totalShares <= 0;
  const currentPriceMissing = inputs.currentPrice === undefined;
  if (totalSharesMissing) return 'برای NAV هر سهم، تعداد کل سهام لازم است.';
  if (currentPriceMissing) return 'برای P/NAV، قیمت فعلی سهم لازم است.';
  if (!navTotalComplete) {
    return 'تعداد سهام و قیمت فعلی موجود است؛ بعد از تکمیل NAV کل، NAV هر سهم و P/NAV قابل محاسبه می‌شود.';
  }
  return 'NAV هر سهم و P/NAV قابل محاسبه است.';
}

function hasSuggestion(result: MonthlyActivityParseResult | undefined, kind: string): boolean {
  return Boolean(
    result?.extractedValues.some((value) => value.kind === kind) ||
      result?.secondarySuggestions.some((value) => value.kind === kind)
  );
}

function guidanceForField(
  field: keyof NavInputs,
  value: number | undefined,
  source: ManualValueSourceMetadata | undefined,
  result: MonthlyActivityParseResult | undefined
): string {
  if (field === 'equity') {
    if (value !== undefined) return 'حقوق صاحبان سهام وارد شده است؛ دوره، واحد و منبع را با گزارش رسمی تطبیق دهید.';
    if (hasSuggestion(result, 'equitySuggestion')) {
      return 'پیشنهاد از صورت مالی موجود است؛ قبل از اعمال، دوره و واحد را بررسی کنید.';
    }
    return 'صورت مالی معتبر برای استخراج حقوق صاحبان سهام پیدا نشد؛ مقدار را دستی وارد کنید.';
  }
  if (field === 'listedPortfolioMarketValue') {
    if (source?.source === 'codal-excel-manual-review') {
      return 'ارزش روز از بررسی دستی Excel اعمال شده؛ منبع و واحد را دوباره بررسی کنید.';
    }
    if (value !== undefined) return 'ارزش روز وارد شده است؛ مطمئن شوید با پرتفوی بورسی همان دوره همخوان است.';
    if (result?.diagnostics.sourceStrategy?.marketValueStatus === 'ambiguous') {
      return 'چند کاندید ارزش روز در Excel پیدا شده؛ یکی را فقط پس از تطبیق دستی اعمال کنید.';
    }
    return 'ارزش روز را از گزارش پرتفوی/کدال به‌صورت دستی وارد کنید.';
  }
  if (field === 'listedPortfolioCostValue') {
    if (value !== undefined && result?.extractedValues.some((item) => item.kind === 'listedPortfolioCostValue')) {
      return 'بهای تمام‌شده به‌تنهایی NAV را کامل نمی‌کند؛ ارزش روز هم لازم است.';
    }
    if (value !== undefined) return 'بهای تمام‌شده وارد شده است؛ دوره و واحد را بررسی کنید.';
    if (hasSuggestion(result, 'listedPortfolioCostValue')) {
      return 'پیشنهاد بهای تمام‌شده موجود است؛ واحد و دوره را بررسی کنید.';
    }
    return 'بهای تمام‌شده پرتفوی بورسی را از گزارش ماهانه یا ورودی دستی تکمیل کنید.';
  }
  if (field === 'unlistedPortfolioSurplus') {
    if (value !== undefined) return 'مازاد پرتفوی غیربورسی وارد شده یا صفر آن تأیید شده است.';
    return 'اگر برای پرتفوی غیربورسی مازاد ارزش محاسبه نکرده‌اید، مقدار را دستی وارد کنید یا صفر را با تأیید خود ثبت کنید.';
  }
  if (field === 'totalShares') {
    if (source?.source === 'tsetmc-suggestion') return 'تعداد سهام از پیشنهاد TSETMC اعمال شده است؛ با منبع رسمی تطبیق دهید.';
    if (value !== undefined) return 'تعداد سهام وارد شده است؛ برای NAV هر سهم و P/NAV استفاده می‌شود.';
    if (hasSuggestion(result, 'totalSharesSuggestion')) {
      return 'پیشنهاد تعداد سهام از TSETMC موجود است؛ با منبع رسمی تطبیق دهید.';
    }
    return 'برای NAV هر سهم و P/NAV، تعداد کل سهام لازم است.';
  }
  if (field === 'currentPrice') {
    if (value !== undefined) return 'قیمت فعلی از آخرین معامله یا ورودی دستی موجود است.';
    return 'برای محاسبه P/NAV، قیمت فعلی لازم است.';
  }
  return 'مقدار را دستی بررسی کنید.';
}

export function buildNavCompletionSummary(
  record: ManualOverrideRecord,
  result?: MonthlyActivityParseResult
): NavCompletionSummary {
  const inputs = record.inputs;
  const completeness = analyzeNavCompleteness(inputs);
  const navTotalMissingFields = navTotalFields.filter((field) => inputs[field] === undefined);
  const navShareMissingFields: Array<keyof NavInputs> = [];
  if (inputs.totalShares === undefined || inputs.totalShares <= 0) navShareMissingFields.push('totalShares');
  if (inputs.currentPrice === undefined) navShareMissingFields.push('currentPrice');

  const fields = workflowFields.map((field): NavCompletionFieldState => {
    const source = record.fieldSources?.[field];
    const value = inputs[field];
    return {
      field,
      label: fieldLabels[field],
      value,
      statusLabel: statusLabelForSource(field, source, value, record),
      present: value !== undefined && Number.isFinite(value),
      needsReview: fieldNeedsReview(source, value),
      canConfirmReview: appliedSuggestionSource(source) && value !== undefined && source?.reviewedByUser !== true,
      canConfirmZero: field === 'unlistedPortfolioSurplus' && value === undefined,
      guidance: guidanceForField(field, value, source, result)
    };
  });

  const pairWarnings = completeness.warnings.filter(
    (warning) => warning.includes('بهای تمام‌شده') || warning.includes('ارزش روز وارد شده')
  );

  const navTotalNeedsReview = fields.some((field) => navTotalFields.includes(field.field) && field.needsReview);
  let status: NavCompletionStatus;
  if (navTotalMissingFields.length > 0) {
    status = 'incomplete';
  } else if (navTotalNeedsReview) {
    status = 'complete-needs-review';
  } else if (navShareMissingFields.length > 0 || pairWarnings.length > 0) {
    status = 'calculable-warning';
  } else {
    status = 'complete-reviewed';
  }

  const statusLabels: Record<NavCompletionStatus, string> = {
    incomplete: 'ناقص',
    'calculable-warning': 'قابل محاسبه با هشدار',
    'complete-needs-review': 'کامل اما نیازمند بررسی دستی',
    'complete-reviewed': 'کامل با ورودی‌های دستی/تأییدشده'
  };

  return {
    status,
    statusLabel: statusLabels[status],
    navTotalMissingFields,
    navShareMissingFields,
    fields,
    pairWarnings,
    summaryText:
      navTotalMissingFields.length > 0
        ? `برای محاسبه NAV کل، ${navTotalMissingFields.length} فیلد دیگر لازم است.`
        : 'NAV کل با ورودی‌های فعلی قابل محاسبه است.',
    navShareGuidance: navShareGuidance(navTotalMissingFields.length === 0, inputs)
  };
}

export { fieldLabels as navCompletionFieldLabels, navTotalFields };
