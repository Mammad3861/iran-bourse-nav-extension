import type { NavInputs } from '../core/nav-calculator';
import type { ExtractedPortfolioValue } from '../data/codal-monthly-parser';
import type { ManualOverrideRecord, ManualValueSourceMetadata } from '../data/manual-overrides';
import { appliedSuggestionSourceKinds, suggestionTarget } from '../data/suggestion-application';

export const navFieldLabels: Record<keyof NavInputs, string> = {
  equity: 'حقوق صاحبان سهام',
  listedPortfolioMarketValue: 'ارزش روز پرتفوی بورسی',
  listedPortfolioCostValue: 'بهای تمام‌شده پرتفوی بورسی',
  unlistedPortfolioSurplus: 'مازاد ارزش پرتفوی غیربورسی',
  totalShares: 'تعداد کل سهام',
  currentPrice: 'قیمت فعلی سهم'
};

export function suggestionSourceLabel(source: ManualValueSourceMetadata['source']): string {
  if (source === 'tsetmc-suggestion') return 'پیشنهاد TSETMC';
  if (source === 'financial-statement-suggestion') return 'پیشنهاد صورت مالی';
  if (source === 'codal-excel-manual-review') return 'بررسی دستی Excel کدال';
  if (source === 'codal-suggestion') return 'پیشنهاد کدال';
  if (source === 'manual') return 'ورودی دستی';
  return 'مقدار سیستمی';
}

export function appliedSourceLabel(field: keyof NavInputs, source: ManualValueSourceMetadata): string {
  const stale = source.stale ? ' - این مقدار از داده ذخیره‌شده قدیمی اعمال شده است.' : '';
  if (source.source === 'manual') return `${navFieldLabels[field]}: ثبت‌شده به صورت دستی`;
  return `${navFieldLabels[field]}: اعمال‌شده از ${suggestionSourceLabel(source.source)}${stale}`;
}

export function appliedSuggestionMessage(field: keyof NavInputs, source: ManualValueSourceMetadata['source']): string {
  return `${navFieldLabels[field]} از ${suggestionSourceLabel(source)} اعمال و ذخیره شد.`;
}

export function suggestionSourceKindFor(
  value: ExtractedPortfolioValue,
  reportTitle: string | undefined
): ManualValueSourceMetadata['source'] {
  const title = reportTitle ?? '';
  if (value.kind === 'totalSharesSuggestion' && /TSETMC/i.test(title + ' ' + (value.sourceTableCaption ?? ''))) {
    return 'tsetmc-suggestion';
  }
  if (value.kind === 'equitySuggestion') {
    return 'financial-statement-suggestion';
  }
  return 'codal-suggestion';
}

export function isAppliedSuggestionSource(source: ManualValueSourceMetadata['source'] | undefined): boolean {
  return Boolean(source && appliedSuggestionSourceKinds.has(source));
}

export function isSuggestionAlreadyApplied(
  record: ManualOverrideRecord | undefined,
  value: ExtractedPortfolioValue,
  sourceKind: ManualValueSourceMetadata['source']
): boolean {
  const target = suggestionTarget(value.kind);
  if (!target) return false;
  const metadata = record?.fieldSources?.[target];
  return metadata?.source === sourceKind && metadata.value === value.value && record?.inputs[target] === value.value;
}
