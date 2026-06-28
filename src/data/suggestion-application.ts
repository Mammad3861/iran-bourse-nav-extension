import type { NavInputs } from '../core/nav-calculator';
import { emptyNavInputs } from '../core/nav-calculator';
import type { ExtractedPortfolioValue, MonthlyActivityParseResult, PortfolioValueKind } from './codal-monthly-parser';
import type { ManualOverrideRecord, ManualValueSourceMetadata } from './manual-overrides';

export interface SuggestionApplyContext {
  symbol: string;
  currentPriceSource: ManualOverrideRecord['currentPriceSource'];
  reportTitle?: string;
  reportDate?: string;
  appliedAt?: string;
}

export function suggestionTarget(kind: PortfolioValueKind): keyof NavInputs | undefined {
  if (kind === 'listedPortfolioCostValue') return 'listedPortfolioCostValue';
  if (kind === 'listedPortfolioMarketValue') return 'listedPortfolioMarketValue';
  if (kind === 'unlistedPortfolioSurplusSuggestion') return 'unlistedPortfolioSurplus';
  return undefined;
}

export function sourceMetadataForSuggestion(
  suggestion: ExtractedPortfolioValue,
  context: SuggestionApplyContext
): ManualValueSourceMetadata {
  return {
    value: suggestion.value,
    source: 'codal-suggestion',
    appliedAt: context.appliedAt ?? new Date().toISOString(),
    reportTitle: context.reportTitle,
    reportDate: context.reportDate,
    confidence: suggestion.confidence
  };
}

function baseRecord(
  current: ManualOverrideRecord | undefined,
  context: SuggestionApplyContext
): ManualOverrideRecord {
  return {
    symbol: context.symbol,
    inputs: current?.inputs ?? emptyNavInputs(),
    currentPriceSource: current?.currentPriceSource ?? context.currentPriceSource,
    updatedAt: current?.updatedAt ?? new Date().toISOString(),
    fieldSources: { ...(current?.fieldSources ?? {}) }
  };
}

export function applySuggestionToRecord(
  current: ManualOverrideRecord | undefined,
  suggestion: ExtractedPortfolioValue,
  context: SuggestionApplyContext
): ManualOverrideRecord {
  const target = suggestionTarget(suggestion.kind);
  if (!target) {
    return baseRecord(current, context);
  }

  const record = baseRecord(current, context);
  record.inputs = { ...record.inputs, [target]: suggestion.value };
  record.fieldSources = {
    ...(record.fieldSources ?? {}),
    [target]: sourceMetadataForSuggestion(suggestion, context)
  };
  record.updatedAt = context.appliedAt ?? new Date().toISOString();
  return record;
}

export function applyHighConfidenceSuggestionsToRecord(
  current: ManualOverrideRecord | undefined,
  parseResult: MonthlyActivityParseResult,
  context: SuggestionApplyContext
): ManualOverrideRecord {
  return parseResult.extractedValues
    .filter((suggestion) => suggestion.confidence === 'high' && suggestionTarget(suggestion.kind))
    .reduce(
      (record, suggestion) => applySuggestionToRecord(record, suggestion, context),
      baseRecord(current, context)
    );
}

export function markFieldAsManual(
  current: ManualOverrideRecord,
  field: keyof NavInputs,
  value: number | undefined,
  editedAt = new Date().toISOString()
): ManualOverrideRecord {
  const fieldSources = { ...(current.fieldSources ?? {}) };
  if (value === undefined) {
    delete fieldSources[field];
  } else {
    fieldSources[field] = {
      value,
      source: 'manual',
      appliedAt: editedAt
    };
  }

  return {
    ...current,
    inputs: { ...current.inputs, [field]: value ?? (field === 'currentPrice' ? undefined : 0) },
    fieldSources,
    updatedAt: editedAt
  };
}
