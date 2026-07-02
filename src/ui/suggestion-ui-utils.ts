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

export type CandidateApplyState = 'exact-applied' | 'other-suggestion-applied' | 'manual-present' | 'empty';

function equivalentNumber(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined || right === undefined) return true;
  return left === right;
}

function equivalentText(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return true;
  return left.trim() === right.trim();
}

function effectiveSourceForField(
  field: keyof NavInputs,
  source: ManualValueSourceMetadata
): ManualValueSourceMetadata['source'] {
  if (
    field === 'totalShares' &&
    source.source === 'codal-suggestion' &&
    /TSETMC/i.test(`${source.reportTitle ?? ''} ${source.columnLabel ?? ''} ${source.rowLabel ?? ''}`)
  ) {
    return 'tsetmc-suggestion';
  }
  return source.source;
}

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
  const effectiveSource = effectiveSourceForField(field, source);
  if (effectiveSource === 'manual') return `${navFieldLabels[field]}: ثبت‌شده به صورت دستی`;
  return `${navFieldLabels[field]}: اعمال‌شده از ${suggestionSourceLabel(effectiveSource)}${stale}`;
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

function metadataMatchesSuggestion(
  metadata: ManualValueSourceMetadata,
  value: ExtractedPortfolioValue,
  sourceKind: ManualValueSourceMetadata['source'],
  field: keyof NavInputs,
  expectedReportTitle?: string
): boolean {
  const metadataSource = effectiveSourceForField(field, metadata);
  if (metadataSource !== sourceKind) return false;
  if (!equivalentText(metadata.reportTitle, expectedReportTitle)) return false;
  if (metadata.value !== value.value) return false;
  if (!equivalentNumber(metadata.scaledValue, value.scaledValue ?? value.value)) return false;
  if (!equivalentNumber(metadata.rawValue, value.rawValue)) return false;
  if (!equivalentText(metadata.rawText, value.rawText)) return false;
  if (!equivalentNumber(metadata.tableIndex, value.sourceTableIndex)) return false;
  if (!equivalentText(metadata.rowLabel, value.rowLabel)) return false;
  if (!equivalentText(metadata.columnLabel, value.columnLabel)) return false;
  if (!equivalentText(metadata.unit, value.unit)) return false;
  return true;
}

export function isSuggestionAlreadyApplied(
  record: ManualOverrideRecord | undefined,
  value: ExtractedPortfolioValue,
  sourceKind: ManualValueSourceMetadata['source'],
  expectedReportTitle?: string
): boolean {
  const target = suggestionTarget(value.kind);
  if (!target) return false;
  const metadata = record?.fieldSources?.[target];
  if (!metadata || record?.inputs[target] !== value.value) return false;
  return metadataMatchesSuggestion(metadata, value, sourceKind, target, expectedReportTitle);
}

export function candidateApplyState(
  record: ManualOverrideRecord | undefined,
  value: ExtractedPortfolioValue,
  sourceKind: ManualValueSourceMetadata['source'],
  expectedReportTitle?: string
): CandidateApplyState {
  const target = suggestionTarget(value.kind);
  if (!target) return 'empty';
  if (isSuggestionAlreadyApplied(record, value, sourceKind, expectedReportTitle)) return 'exact-applied';

  const fieldValue = record?.inputs[target];
  if (fieldValue === undefined || !Number.isFinite(fieldValue)) return 'empty';
  const metadata = record?.fieldSources?.[target];
  if (isAppliedSuggestionSource(metadata?.source)) return 'other-suggestion-applied';
  return 'manual-present';
}

export function applyFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'خطای نامشخص';
  if (/Extension context invalidated|context invalidated|receiving end does not exist/i.test(message)) {
    return 'افزونه reload شده است؛ صفحه را refresh کنید و دوباره اعمال کنید. این مقدار ذخیره نشد و فقط در صفحه فعلی نمایش داده شده است.';
  }
  return `ذخیره مقدار پیشنهادی ناموفق بود: ${message}. این مقدار ذخیره نشد و فقط در صفحه فعلی نمایش داده شده است.`;
}
