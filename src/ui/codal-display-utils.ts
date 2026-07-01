import type {
  CodalReportDiscoveryResult,
  CodalReportReference,
  CodalReportSelectionDiagnostics,
  CodalSourceStrategyDiagnostics
} from '../data/codal-client';

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

function isCleanSelectedReport(selection: CodalReportSelectionDiagnostics | undefined): boolean {
  return (
    Boolean(selection?.selectedReport) &&
    (selection?.selectedConfidence === 'high' || selection?.selectedConfidence === 'medium') &&
    (selection?.selectedWarnings.length ?? 0) === 0
  );
}

function hasSelectedWarnings(selection: CodalReportSelectionDiagnostics | undefined): boolean {
  return Boolean(selection?.selectedReport && selection.selectedWarnings.length > 0);
}

function normalizeSymbol(value: string | undefined): string {
  return (value ?? '')
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/\u200c/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function isHighConfidenceMonthlySymbolMatch(selection: CodalReportSelectionDiagnostics | undefined): boolean {
  if (!selection?.selectedReport || selection.reportKind !== 'monthly-activity' || selection.selectedConfidence !== 'high') {
    return false;
  }
  return normalizeSymbol(selection.requestedSymbol) === normalizeSymbol(selection.selectedReport.symbol);
}

export function discoverySelectionNotice(result: CodalReportDiscoveryResult): string | undefined {
  const monthly = result.diagnostics?.monthlyActivity;
  const financial = result.diagnostics?.financialStatement;
  const selections = [monthly, financial];

  if (isCleanSelectedReport(monthly) || isHighConfidenceMonthlySymbolMatch(monthly)) {
    return 'گزارش انتخاب‌شده با نماد/ناشر تطبیق داده شد.';
  }
  if (selections.some(isCleanSelectedReport)) {
    return 'گزارش انتخاب‌شده با نماد/ناشر تطبیق داده شد.';
  }
  if (selections.some(hasSelectedWarnings)) {
    return 'گزارش انتخاب‌شده ممکن است مربوط به ناشر دیگری باشد؛ تشخیص گزارش را بررسی کنید.';
  }
  if (result.diagnostics) {
    return 'گزارش به دلیل عدم تطابق نماد/ناشر نادیده گرفته شد.';
  }
  return undefined;
}

export function reportSummary(report: CodalReportReference | undefined): string {
  if (!report) {
    return 'یافت نشد';
  }

  return report.publishedAt ? `${report.title} - ${report.publishedAt}` : report.title;
}

export function financialReportSummary(report: CodalReportReference | undefined): string {
  return report ? reportSummary(report) : 'صورت مالی معتبر برای ناشر پیدا نشد';
}
