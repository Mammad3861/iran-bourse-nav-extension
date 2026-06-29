import { calculateNav } from '../core/nav-calculator';
import { formatNumberFa, formatPercentRatioFa } from '../core/number-utils';
import { formatPersianTimestamp } from '../core/persian-date-utils';
import { getActiveSymbol, getManualOverride } from '../data/cache-store';
import type {
  CodalReportDetailResult,
  CodalReportDiscoveryResult,
  CodalReportReference
} from '../data/codal-client';
import {
  parseMonthlyActivityReport,
  type ExtractedPortfolioValue,
  type MonthlyActivityParseResult
} from '../data/codal-monthly-parser';
import { validateCodalSearchSymbol } from '../data/codal-symbol-validation';
import { requestCodalDiscovery, requestCodalReportDetail } from '../data/codal-transport';
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
    setText('[data-popup-codal="status"]', 'ارتباط با کدال از پس‌زمینه افزونه انجام می‌شود؛ گزارش‌های مرتبط پیدا شد');
  } else if (result.status === 'not-found') {
    setText('[data-popup-codal="status"]', result.errorMessage ?? 'برای این نماد گزارش قابل اتکایی پیدا نشد');
  } else {
    setText('[data-popup-codal="status"]', `خطا در دریافت کدال از پس‌زمینه افزونه: ${result.errorMessage ?? 'نامشخص'}`);
  }

  setText('[data-popup-codal="monthly"]', reportSummary(result.monthlyActivityReport));
  setText('[data-popup-codal="financial"]', reportSummary(result.financialStatementReport));
  updateReportLink('[data-popup-codal-link="monthly"]', result.monthlyActivityReport);
  updateReportLink('[data-popup-codal-link="financial"]', result.financialStatementReport);
}

function detailStatusText(result: CodalReportDetailResult): string {
  if (result.status === 'fetched') {
    if (result.detail?.tables.length) {
      return `جزئیات دریافت شد - تعداد جدول‌های شناسایی‌شده: ${result.detail.tables.length}`;
    }
    return result.errorMessage
      ? `جزئیات دریافت شد، اما جدول قابل پشتیبانی شناسایی نشد: ${result.errorMessage}`
      : 'جزئیات دریافت شد، اما جدول قابل پشتیبانی شناسایی نشد';
  }
  if (result.status === 'unsupported-format') {
    return result.errorMessage ?? 'ساختار این گزارش هنوز در Parser پشتیبانی نمی‌شود';
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

function suggestionText(value: ExtractedPortfolioValue): string {
  const confidence =
    value.confidence === 'high' ? 'اطمینان بالا' : value.confidence === 'medium' ? 'اطمینان متوسط' : 'اطمینان پایین';
  return `${value.label}: ${formatNumberFa(value.value)} (${confidence})`;
}

function appendMonthlyDiagnostics(list: HTMLElement, result: MonthlyActivityParseResult): void {
  const preview = document.createElement('div');
  preview.className = 'ibnav-diagnostics';
  const title = document.createElement('h5');
  title.className = 'ibnav-subtitle';
  title.textContent = 'پیش‌نمایش جدول‌های شناسایی‌شده';
  preview.appendChild(title);

  if (result.tablePreviews.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'ibnav-muted';
    empty.textContent = 'پیش‌نمایش جدولی برای نمایش وجود ندارد.';
    preview.appendChild(empty);
  }

  for (const table of result.tablePreviews.slice(0, 3)) {
    const item = document.createElement('details');
    item.className = 'ibnav-table-preview';
    const summary = document.createElement('summary');
    summary.textContent = `جدول ${table.index}${table.caption ? ` - ${table.caption}` : ''}`;
    item.appendChild(summary);
    const meta = document.createElement('p');
    meta.className = 'ibnav-muted';
    meta.textContent = `برچسب‌ها: ${table.detectedLabels.join('، ') || 'نامشخص'}`;
    item.appendChild(meta);
    const rows = document.createElement('pre');
    rows.className = 'ibnav-preview-code';
    rows.textContent = table.rows.map((row) => row.join(' | ')).join('\n');
    item.appendChild(rows);
    preview.appendChild(item);
  }

  const candidates = document.createElement('h5');
  candidates.className = 'ibnav-subtitle';
  candidates.textContent = 'کاندیدهای استخراج‌شده';
  preview.appendChild(candidates);
  list.appendChild(preview);
}

function renderMonthlySuggestions(result: MonthlyActivityParseResult): void {
  setText(
    '[data-popup-suggestions="status"]',
    result.status === 'parsed'
      ? 'پیشنهادهای قابل بررسی پیدا شد'
      : result.status === 'ambiguous'
        ? 'نتیجه کدال نیاز به بررسی دستی دارد'
        : 'پیشنهاد قابل اتکا پیدا نشد'
  );
  setText(
    '[data-popup-suggestions="source"]',
    result.reportPeriod
      ? `${result.reportTitle ?? 'گزارش کدال'} - ${result.reportPeriod}`
      : result.reportTitle ?? '-'
  );
  setText(
    '[data-popup-suggestions="warnings"]',
    result.warnings.length ? result.warnings.join(' ') : 'پیش از اعمال، اعداد را با گزارش رسمی تطبیق دهید.'
  );

  const list = document.querySelector<HTMLElement>('[data-popup-suggestions="list"]');
  if (!list) return;
  list.textContent = '';
  appendMonthlyDiagnostics(list, result);
  for (const value of result.extractedValues) {
    const item = document.createElement('div');
    item.className = 'ibnav-suggestion';
    const text = document.createElement('span');
    text.textContent = suggestionText(value);
    item.appendChild(text);
    const reason = document.createElement('small');
    reason.className = 'ibnav-muted';
    reason.textContent = value.reason ? `دلیل اطمینان: ${value.reason}` : 'دلیل اطمینان: بر اساس برچسب‌های جدول و مقدار عددی.';
    item.appendChild(reason);
    if (value.warning || value.confidence === 'low') {
      const warning = document.createElement('small');
      warning.className = 'ibnav-muted';
      warning.textContent = value.warning ?? 'این مقدار نیاز به بررسی دستی دارد.';
      item.appendChild(warning);
    }
    list.appendChild(item);
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

  const codalSymbolValidation = validateCodalSearchSymbol(symbol);
  if (!codalSymbolValidation.valid || !codalSymbolValidation.symbol) {
    renderCodalDiscovery({
      status: 'not-found',
      symbol,
      errorMessage: codalSymbolValidation.reason,
      sourceVerified: false,
      checkedAt: new Date().toISOString()
    });
    renderCodalDetail({
      status: 'unavailable',
      errorMessage: codalSymbolValidation.reason
    });
    return;
  }

  const codalResult = await requestCodalDiscovery(codalSymbolValidation.symbol);
  renderCodalDiscovery(codalResult);
  const report = codalResult.monthlyActivityReport ?? codalResult.financialStatementReport;
  if (!report) {
    renderCodalDetail({
      status: codalResult.status === 'failed' ? 'network-error' : 'unavailable',
      errorMessage: codalResult.errorMessage
    });
    return;
  }

  const detailResult = await requestCodalReportDetail(report);
  renderCodalDetail(detailResult);
  if (detailResult.detail) {
    renderMonthlySuggestions(parseMonthlyActivityReport(detailResult.detail));
  }
}

void renderPopup();
