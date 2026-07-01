import type { NavInputs } from '../core/nav-calculator';
import type { ParseConfidence } from './codal-monthly-parser';

export type ManualValueSourceKind = 'manual' | 'codal-suggestion' | 'system' | 'default';

export interface ManualValueSourceMetadata {
  value: number;
  source: ManualValueSourceKind;
  appliedAt: string;
  touchedByUser?: boolean;
  reportTitle?: string;
  reportDate?: string;
  confidence?: ParseConfidence;
  unit?: string;
}

export interface ManualOverrideRecord {
  symbol: string;
  inputs: NavInputs;
  currentPriceSource:
    | 'page'
    | 'dom-latest-trade'
    | 'dom-closing-price'
    | 'api-latest-trade'
    | 'api-closing-price'
    | 'manual'
    | 'unknown';
  updatedAt: string;
  fieldSources?: Partial<Record<keyof NavInputs, ManualValueSourceMetadata>>;
}

const legacyZeroFinancialFields: Array<keyof NavInputs> = [
  'equity',
  'listedPortfolioMarketValue',
  'listedPortfolioCostValue',
  'unlistedPortfolioSurplus',
  'totalShares'
];

export function normalizeManualOverrideRecord(record: ManualOverrideRecord): ManualOverrideRecord {
  const inputs = { ...record.inputs };
  const fieldSources = { ...(record.fieldSources ?? {}) };

  for (const field of legacyZeroFinancialFields) {
    if (inputs[field] === 0 && !fieldSources[field]) {
      inputs[field] = undefined;
    }
  }

  return {
    ...record,
    inputs,
    fieldSources
  };
}

export function manualFieldMetadata(value: number, appliedAt: string): ManualValueSourceMetadata {
  return {
    value,
    source: 'manual',
    appliedAt,
    touchedByUser: true
  };
}
