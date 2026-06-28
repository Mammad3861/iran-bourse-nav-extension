import type { NavInputs } from '../core/nav-calculator';

export interface ManualOverrideRecord {
  symbol: string;
  inputs: NavInputs;
  currentPriceSource: 'page' | 'manual' | 'unknown';
  updatedAt: string;
}
