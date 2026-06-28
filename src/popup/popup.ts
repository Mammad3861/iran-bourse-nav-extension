import { calculateNav } from '../core/nav-calculator';
import { formatNumberFa, formatPercentRatioFa } from '../core/number-utils';
import { formatPersianTimestamp } from '../core/persian-date-utils';
import { getActiveSymbol, getManualOverride } from '../data/cache-store';
import {
  discoverLatestCodalReports,
  getReportDetail,
  type CodalReportDetailResult,
  type CodalReportDiscoveryResult,
  type CodalReportReference
} from '../data/codal-client';
import '../ui/styles.css';

function setText(selector: string, value: string): void {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

function reportSummary(report: CodalReportReference | undefined): string {
  if (!report) {
    return 'یافت نشد';
  }

  return report.publishedAt ? `${report.title} - ${report.publishedAt}` : report.title;
}

function updateReportLink(selector: string, report: CodalReportReference | undefined): void {
  const link = document.querySelector<HTMLAnchorElement>(selector);
  if (!link) {
    return;
  }

  if (report?.url) {
    link.href = report.url;
    link.hidden = false;
  } else {
    link.removeAttribute('href');
    link.hidden = true;
  }
}

function renderCodalDiscovery(result: CodalReportDiscoveryResult): void {
  if (result.status === 'found') {
    setText('[data-popup-codal="status"]', 'گزارش‌های مرتبط پیدا شد');
  } else if (result.status === 'not-found') {
    setText('[data-popup-codal="status"]', 'گزارش مرتبطی برای این نماد پیدا نشد');
  } else {
    setText('[data-popup-codal="status"]', `خطا در دریافت کدال: ${result.errorMessage ?? 'نامشخص'}`);
  }

  setText('[data-popup-codal="monthly"]', reportSummary(result.monthlyActivityReport));
  setText('[data-popup-codal="financial"]', reportSummary(result.financialStatementReport));
  updateReportLink('[data-popup-codal-link="monthly"]', result.monthlyActivityReport);
  updateReportLink('[data-popup-codal-link="financial"]', result.financialStatementReport);
}

function detailStatusText(result: CodalReportDetailResult): string {
  if (result.status === 'fetched') {
    const tableText = result.detail?.tables.length
      ? `${result.detail.tables.length} جدول شناسایی شد`
      : 'جدولی شناسایی نشد';
    return `جزئیات دریافت شد - ${tableText}`;
  }
  if (result.status === 'unsupported-format') {
    return 'جزئیات دریافت شد، اما ساختار گزارش پشتیبانی نمی‌شود';
  }
  if (result.status === 'unavailable') {
    return 'جزئیات گزارش در دسترس نیست';
  }
  if (result.status === 'timeout') {
    return 'دریافت جزئیات گزارش به پایان مهلت رسید';
  }
  return `خطا در دریافت جزئیات: ${result.errorMessage ?? 'نامشخص'}`;
}

function renderCodalDetail(result: CodalReportDetailResult): void {
  setText('[data-popup-codal-detail="status"]', detailStatusText(result));
  setText(
    '[data-popup-codal-detail="fetchedAt"]',
    result.detail?.fetchedAt ? formatPersianTimestamp(new Date(result.detail.fetchedAt)) : '-'
  );

  const warning = document.querySelector<HTMLElement>('[data-popup-codal-detail="warning"]');
  if (warning) {
    warning.hidden = result.status === 'fetched' && Boolean(result.detail?.tables.length);
  }
}

async function renderPopup(): Promise<void> {
  const symbol = await getActiveSymbol();
  setText('[data-popup-symbol]', symbol ?? 'نماد نامشخص');

  if (!symbol) {
    document.querySelector<HTMLElement>('[data-popup-empty]')!.hidden = false;
    renderCodalDiscovery({
      status: 'not-found',
      symbol: '',
      sourceVerified: false,
      checkedAt: new Date().toISOString()
    });
    return;
  }

  const record = await getManualOverride(symbol);
  if (!record) {
    document.querySelector<HTMLElement>('[data-popup-empty]')!.hidden = false;
  } else {
    const result = calculateNav(record.inputs);
    setText('[data-popup-result="navTotal"]', formatNumberFa(result.navTotal));
    setText('[data-popup-result="navPerShare"]', formatNumberFa(result.navPerShare, 2));
    setText('[data-popup-result="pToNav"]', formatPercentRatioFa(result.pToNav));
    setText('[data-popup-result="updatedAt"]', formatPersianTimestamp(new Date(record.updatedAt)));
  }

  const codalResult = await discoverLatestCodalReports(symbol);
  renderCodalDiscovery(codalResult);
  const report = codalResult.monthlyActivityReport ?? codalResult.financialStatementReport;
  if (!report) {
    renderCodalDetail({
      status: codalResult.status === 'failed' ? 'network-error' : 'unavailable',
      errorMessage: codalResult.errorMessage
    });
    return;
  }

  renderCodalDetail(await getReportDetail(report));
}

void renderPopup();
