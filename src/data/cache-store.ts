import { storageKeyForSymbol } from '../core/symbol-utils';
import type { ManualOverrideRecord } from './manual-overrides';

const memoryStore = new Map<string, unknown>();

export function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function getLocalValue<T>(key: string): Promise<T | undefined> {
  if (!hasChromeStorage()) {
    return memoryStore.get(key) as T | undefined;
  }

  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

export async function setLocalValue<T>(key: string, value: T): Promise<void> {
  if (!hasChromeStorage()) {
    memoryStore.set(key, value);
    return;
  }

  await chrome.storage.local.set({ [key]: value });
}

export async function getManualOverride(symbol: string): Promise<ManualOverrideRecord | undefined> {
  const key = storageKeyForSymbol(symbol);
  return getLocalValue<ManualOverrideRecord>(key);
}

export async function saveManualOverride(record: ManualOverrideRecord): Promise<void> {
  const key = storageKeyForSymbol(record.symbol);
  await setLocalValue(key, record);
}

export async function getActiveSymbol(): Promise<string | undefined> {
  const key = 'active-symbol';
  return getLocalValue<string>(key);
}

export async function setActiveSymbol(symbol: string): Promise<void> {
  const key = 'active-symbol';
  await setLocalValue(key, symbol);
}
