import type { CodalSourceStrategyDiagnostics } from '../data/codal-client';

export function marketValueStatusText(status: CodalSourceStrategyDiagnostics['marketValueStatus']): string {
  if (status === 'found') return 'پیدا شد';
  if (status === 'ambiguous') return 'نیازمند بررسی دستی';
  if (status === 'unavailable' || status === 'not-checked') return 'قابل بررسی نبود';
  return 'پیدا نشد';
}

export function sourceStrategySummaryText(strategy: CodalSourceStrategyDiagnostics): string {
  return [
    'منبع ارزش روز پرتفوی بورسی',
    `وضعیت: ${marketValueStatusText(strategy.marketValueStatus)}`,
    `Excel: ${strategy.excel.status}`,
    ...strategy.messages
  ].join(' | ');
}

function isDetailedRejectedCandidateWarning(warning: string): boolean {
  return (
    warning.includes('کاندید صفر') ||
    warning.includes('کاندید منفی') ||
    warning.includes('کاندید بسیار کوچک') ||
    warning.includes('کاندید ردیف') ||
    warning.includes('رد شد چون ردیف') ||
    warning.includes('رد شد چون مقدار') ||
    warning.includes('رتبه پایین') ||
    warning.includes('فهرست اصلی حذف شد')
  );
}

export function compactParserWarnings(warnings: string[]): string[] {
  const compact = warnings.filter((warning) => !isDetailedRejectedCandidateWarning(warning));
  return [...new Set(compact)];
}
