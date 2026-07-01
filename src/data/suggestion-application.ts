import type { NavInputs } from '../core/nav-calculator';
import { emptyNavInputs } from '../core/nav-calculator';
import type { ExtractedPortfolioValue, MonthlyActivityParseResult, PortfolioValueKind } from './codal-monthly-parser';
import type { ManualOverrideRecord, ManualValueSourceMetadata } from './manual-overrides';
import { manualFieldMetadata, normalizeManualOverrideRecord } from './manual-overrides';

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
  if (kind === 'equitySuggestion') return 'equity';
  if (kind === 'totalSharesSuggestion') return 'totalShares';
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
    confidence: suggestion.confidence,
    unit: suggestion.unit
  };
}

function baseRecord(
  current: ManualOverrideRecord | undefined,
  context: SuggestionApplyContext
): ManualOverrideRecord {
  const normalizedCurrent = current ? normalizeManualOverrideRecord(current) : undefined;
  return {
    symbol: context.symbol,
    inputs: normalizedCurrent?.inputs ?? emptyNavInputs(),
    currentPriceSource: normalizedCurrent?.currentPriceSource ?? context.currentPriceSource,
    updatedAt: normalizedCurrent?.updatedAt ?? new Date().toISOString(),
    fieldSources: { ...(normalizedCurrent?.fieldSources ?? {}) }
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
    fieldSources[field] = manualFieldMetadata(value, editedAt);
  }

  return {
    ...current,
    inputs: { ...current.inputs, [field]: value },
    fieldSources,
    updatedAt: editedAt
  };
}

export function resetCodalSuggestionFields(current: ManualOverrideRecord, resetAt = new Date().toISOString()): ManualOverrideRecord {
  const inputs = { ...current.inputs };
  const fieldSources = { ...(current.fieldSources ?? {}) };

  for (const field of Object.keys(fieldSources) as Array<keyof NavInputs>) {
    if (fieldSources[field]?.source !== 'codal-suggestion') {
      continue;
    }
    if (field === 'currentPrice') {
      inputs.currentPrice = undefined;
    } else {
      inputs[field] = undefined;
    }
    delete fieldSources[field];
  }

  return {
    ...current,
    inputs,
    fieldSources,
    updatedAt: resetAt
  };
}
