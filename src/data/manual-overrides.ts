import type { NavInputs } from '../core/nav-calculator';
import type { ParseConfidence } from './codal-monthly-parser';

export type ManualValueSourceKind = 'manual' | 'codal-suggestion';

export interface ManualValueSourceMetadata {
  value: number;
  source: ManualValueSourceKind;
  appliedAt: string;
  reportTitle?: string;
  reportDate?: string;
  confidence?: ParseConfidence;
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
