import { storageKeyForSymbol } from '../core/symbol-utils';
import type { ManualOverrideRecord } from './manual-overrides';

const memoryStore = new Map<string, unknown>();

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function getManualOverride(symbol: string): Promise<ManualOverrideRecord | undefined> {
  const key = storageKeyForSymbol(symbol);

  if (!hasChromeStorage()) {
    return memoryStore.get(key) as ManualOverrideRecord | undefined;
  }

  const result = await chrome.storage.local.get(key);
  return result[key] as ManualOverrideRecord | undefined;
}

export async function saveManualOverride(record: ManualOverrideRecord): Promise<void> {
  const key = storageKeyForSymbol(record.symbol);

  if (!hasChromeStorage()) {
    memoryStore.set(key, record);
    return;
  }

  await chrome.storage.local.set({ [key]: record });
}

export async function getActiveSymbol(): Promise<string | undefined> {
  const key = 'active-symbol';

  if (!hasChromeStorage()) {
    return memoryStore.get(key) as string | undefined;
  }

  const result = await chrome.storage.local.get(key);
  return result[key] as string | undefined;
}

export async function setActiveSymbol(symbol: string): Promise<void> {
  const key = 'active-symbol';

  if (!hasChromeStorage()) {
    memoryStore.set(key, symbol);
    return;
  }

  await chrome.storage.local.set({ [key]: symbol });
}
