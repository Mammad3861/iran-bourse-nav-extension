import type { NavInputs } from '../core/nav-calculator';
import { calculateNav, emptyNavInputs } from '../core/nav-calculator';
import { formatNumberFa, formatPercentRatioFa, parseLocalizedNumber } from '../core/number-utils';
import { formatPersianTimestamp, toIsoTimestamp } from '../core/persian-date-utils';
import { getManualOverride, saveManualOverride } from '../data/cache-store';
import {
  discoverLatestCodalReports,
  getReportDetail,
  type CodalReportDetailResult,
  type CodalReportDiscoveryResult,
  type CodalReportReference
} from '../data/codal-client';
import {
  parseMonthlyActivityReport,
  type ExtractedPortfolioValue,
  type MonthlyActivityParseResult,
  type PortfolioValueKind
} from '../data/codal-monthly-parser';
import type { ManualOverrideRecord } from '../data/manual-overrides';
import styles from './styles.css?inline';

export interface NavWidgetOptions {
  symbol: string;
  currentPrice?: number;
  currentPriceSource: ManualOverrideRecord['currentPriceSource'];
  mount?: HTMLElement;
}

const fieldLabels: Record<keyof NavInputs, string> = {
  equity: 'حقوق صاحبان سهام',
  listedPortfolioMarketValue: 'ارزش روز پرتفوی بورسی',
  listedPortfolioCostValue: 'بهای تمام‌شده پرتفوی بورسی',
  unlistedPortfolioSurplus: 'مازاد ارزش پرتفوی غیربورسی',
  totalShares: 'تعداد کل سهام',
  currentPrice: 'قیمت فعلی سهم'
};

const inputFields: Array<keyof NavInputs> = [
  'equity',
  'listedPortfolioMarketValue',
  'listedPortfolioCostValue',
  'unlistedPortfolioSurplus',
  'totalShares',
  'currentPrice'
];

function ensureStyle(): void {
  if (document.getElementById('ibnav-style')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'ibnav-style';
  style.textContent = styles;
  document.documentElement.appendChild(style);
}

function numberToInputValue(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '' : String(value);
}

function readInputs(root: HTMLElement): NavInputs {
  const inputs = emptyNavInputs();

  for (const field of inputFields) {
    const input = root.querySelector<HTMLInputElement>(`[data-ibnav-field="${field}"]`);
    const parsed = parseLocalizedNumber(input?.value);
    if (field === 'currentPrice') {
      inputs.currentPrice = parsed;
    } else {
      inputs[field] = parsed ?? 0;
    }
  }

  return inputs;
}

function updateResults(root: HTMLElement, updatedAt: string): void {
  const result = calculateNav(readInputs(root));
  root.querySelector('[data-ibnav-result="navTotal"]')!.textContent = formatNumberFa(result.navTotal);
  root.querySelector('[data-ibnav-result="navPerShare"]')!.textContent = formatNumberFa(
    result.navPerShare,
    2
  );
  root.querySelector('[data-ibnav-result="pToNav"]')!.textContent = formatPercentRatioFa(result.pToNav);
  root.querySelector('[data-ibnav-result="updatedAt"]')!.textContent = updatedAt;
}

function reportSummary(report: CodalReportReference | undefined): string {
  if (!report) {
    return 'یافت نشد';
  }

  return report.publishedAt ? `${report.title} - ${report.publishedAt}` : report.title;
}

function updateReportLink(root: HTMLElement, selector: string, report: CodalReportReference | undefined): void {
  const link = root.querySelector<HTMLAnchorElement>(selector);
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

function renderCodalDiscovery(root: HTMLElement, result: CodalReportDiscoveryResult): void {
  const status = root.querySelector('[data-ibnav-codal="status"]');
  const monthly = root.querySelector('[data-ibnav-codal="monthly"]');
  const financial = root.querySelector('[data-ibnav-codal="financial"]');

  if (!status || !monthly || !financial) {
    return;
  }

  if (result.status === 'found') {
    status.textContent = 'گزارش‌های مرتبط پیدا شد';
  } else if (result.status === 'not-found') {
    status.textContent = 'گزارش مرتبطی برای این نماد پیدا نشد';
  } else {
    status.textContent = `خطا در دریافت کدال: ${result.errorMessage ?? 'نامشخص'}`;
  }

  monthly.textContent = reportSummary(result.monthlyActivityReport);
  financial.textContent = reportSummary(result.financialStatementReport);
  updateReportLink(root, '[data-ibnav-codal-link="monthly"]', result.monthlyActivityReport);
  updateReportLink(root, '[data-ibnav-codal-link="financial"]', result.financialStatementReport);
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

function renderCodalDetail(root: HTMLElement, result: CodalReportDetailResult): void {
  const status = root.querySelector('[data-ibnav-codal-detail="status"]');
  const fetchedAt = root.querySelector('[data-ibnav-codal-detail="fetchedAt"]');
  const warning = root.querySelector<HTMLElement>('[data-ibnav-codal-detail="warning"]');

  if (!status || !fetchedAt || !warning) {
    return;
  }

  status.textContent = detailStatusText(result);
  fetchedAt.textContent = result.detail?.fetchedAt
    ? formatPersianTimestamp(new Date(result.detail.fetchedAt))
    : '-';
  warning.hidden = result.status === 'fetched' && Boolean(result.detail?.tables.length);
}

function suggestionTarget(kind: PortfolioValueKind): keyof NavInputs | undefined {
  if (kind === 'listedPortfolioCostValue') return 'listedPortfolioCostValue';
  if (kind === 'listedPortfolioMarketValue') return 'listedPortfolioMarketValue';
  if (kind === 'unlistedPortfolioSurplusSuggestion') return 'unlistedPortfolioSurplus';
  return undefined;
}

function suggestionText(value: ExtractedPortfolioValue): string {
  const confidence =
    value.confidence === 'high' ? 'اطمینان بالا' : value.confidence === 'medium' ? 'اطمینان متوسط' : 'اطمینان پایین';
  return `${value.label}: ${formatNumberFa(value.value)} (${confidence})`;
}

function renderMonthlySuggestions(root: HTMLElement, result: MonthlyActivityParseResult): void {
  const status = root.querySelector('[data-ibnav-suggestions="status"]');
  const source = root.querySelector('[data-ibnav-suggestions="source"]');
  const list = root.querySelector<HTMLElement>('[data-ibnav-suggestions="list"]');
  const warnings = root.querySelector('[data-ibnav-suggestions="warnings"]');

  if (!status || !source || !list || !warnings) {
    return;
  }

  status.textContent =
    result.status === 'parsed'
      ? 'پیشنهادهای قابل بررسی پیدا شد'
      : result.status === 'ambiguous'
        ? 'نتیجه کدال نیاز به بررسی دستی دارد'
        : 'پیشنهاد قابل اتکا پیدا نشد';
  source.textContent = result.reportPeriod
    ? `${result.reportTitle ?? 'گزارش کدال'} - ${result.reportPeriod}`
    : result.reportTitle ?? '-';
  warnings.textContent = result.warnings.length ? result.warnings.join(' ') : 'پیش از اعمال، اعداد را با گزارش رسمی تطبیق دهید.';

  list.textContent = '';
  for (const value of result.extractedValues) {
    const item = document.createElement('div');
    item.className = 'ibnav-suggestion';
    const text = document.createElement('span');
    text.textContent = suggestionText(value);
    item.appendChild(text);

    const target = suggestionTarget(value.kind);
    if (target) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ibnav-apply';
      button.textContent = 'اعمال دستی';
      button.addEventListener('click', () => {
        const input = root.querySelector<HTMLInputElement>(`[data-ibnav-field="${target}"]`);
        if (!input) return;
        input.value = String(value.value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      item.appendChild(button);
    }

    if (value.warning) {
      const warning = document.createElement('small');
      warning.className = 'ibnav-muted';
      warning.textContent = value.warning;
      item.appendChild(warning);
    }
    list.appendChild(item);
  }
}

export async function renderNavWidget(options: NavWidgetOptions): Promise<HTMLElement> {
  ensureStyle();

  const existing = document.getElementById('ibnav-widget');
  existing?.remove();

  const saved = await getManualOverride(options.symbol);
  const inputs = saved?.inputs ?? emptyNavInputs();
  inputs.currentPrice = inputs.currentPrice ?? options.currentPrice;

  const root = document.createElement('section');
  root.id = 'ibnav-widget';
  root.className = 'ibnav-root ibnav-widget';
  root.innerHTML = `
    <header class="ibnav-header">
      <div>
        <h2 class="ibnav-title">محاسبه NAV</h2>
        <div class="ibnav-symbol">${options.symbol}</div>
      </div>
      <button type="button" class="ibnav-collapse" title="باز و بسته کردن">−</button>
    </header>
    <div class="ibnav-body">
      <form class="ibnav-grid">
        ${inputFields
          .map(
            (field) => `
              <label class="ibnav-field">
                <span class="ibnav-label">${fieldLabels[field]}</span>
                <input class="ibnav-input" inputmode="decimal" data-ibnav-field="${field}" value="${numberToInputValue(
                  inputs[field]
                )}" />
              </label>
            `
          )
          .join('')}
      </form>
      <div class="ibnav-results" aria-live="polite">
        <div class="ibnav-row"><span>NAV کل</span><strong data-ibnav-result="navTotal">-</strong></div>
        <div class="ibnav-row"><span>NAV هر سهم</span><strong data-ibnav-result="navPerShare">-</strong></div>
        <div class="ibnav-row"><span>P/NAV</span><strong data-ibnav-result="pToNav">-</strong></div>
        <div class="ibnav-row"><span>زمان داده</span><span data-ibnav-result="updatedAt">-</span></div>
      </div>
      <button type="button" class="ibnav-save">ذخیره برای این نماد</button>
      <section class="ibnav-codal" aria-live="polite">
        <h3 class="ibnav-subtitle">گزارش‌های کدال</h3>
        <p class="ibnav-muted" data-ibnav-codal="status">در حال جستجوی گزارش‌ها...</p>
        <div class="ibnav-row"><span>فعالیت ماهانه</span><span data-ibnav-codal="monthly">-</span></div>
        <a class="ibnav-link" data-ibnav-codal-link="monthly" target="_blank" rel="noreferrer" hidden>مشاهده گزارش فعالیت ماهانه</a>
        <div class="ibnav-row"><span>صورت مالی</span><span data-ibnav-codal="financial">-</span></div>
        <a class="ibnav-link" data-ibnav-codal-link="financial" target="_blank" rel="noreferrer" hidden>مشاهده صورت مالی</a>
        <div class="ibnav-row"><span>جزئیات آخرین گزارش</span><span data-ibnav-codal-detail="status">در انتظار نتیجه جستجو</span></div>
        <div class="ibnav-row"><span>زمان دریافت جزئیات</span><span data-ibnav-codal-detail="fetchedAt">-</span></div>
        <p class="ibnav-muted" data-ibnav-codal-detail="warning">ساختار گزارش ممکن است در این نسخه پشتیبانی نشود.</p>
        <div class="ibnav-suggestions">
          <h4 class="ibnav-subtitle">مقادیر پیشنهادی از کدال</h4>
          <p class="ibnav-muted" data-ibnav-suggestions="status">در انتظار دریافت جزئیات گزارش</p>
          <p class="ibnav-muted" data-ibnav-suggestions="source">-</p>
          <div class="ibnav-suggestion-list" data-ibnav-suggestions="list"></div>
          <p class="ibnav-warning" data-ibnav-suggestions="warnings">هیچ مقدار پیشنهادی به صورت خودکار اعمال نمی‌شود.</p>
        </div>
        <p class="ibnav-warning">منبع کدال در این نسخه تأییدشده و پایدار فرض نمی‌شود؛ محاسبه NAV همچنان فقط از ورودی‌های دستی انجام می‌شود.</p>
      </section>
      <p class="ibnav-muted">قیمت فعلی: ${
        options.currentPriceSource === 'page'
          ? 'خوانده‌شده از صفحه'
          : 'از صفحه تشخیص داده نشد؛ در صورت نیاز دستی وارد کنید'
      }</p>
      <p class="ibnav-warning">این خروجی فقط یک برآورد محلی است و توصیه سرمایه‌گذاری محسوب نمی‌شود.</p>
    </div>
  `;

  const updatedAt = saved ? formatPersianTimestamp(new Date(saved.updatedAt)) : formatPersianTimestamp();
  updateResults(root, updatedAt);
  discoverLatestCodalReports(options.symbol)
    .then(async (result) => {
      renderCodalDiscovery(root, result);
      const report = result.monthlyActivityReport ?? result.financialStatementReport;
      if (!report) {
        renderCodalDetail(root, {
          status: result.status === 'failed' ? 'network-error' : 'unavailable',
          errorMessage: result.errorMessage
        });
        return;
      }
      const detailResult = await getReportDetail(report);
      renderCodalDetail(root, detailResult);
      if (detailResult.detail) {
        renderMonthlySuggestions(root, parseMonthlyActivityReport(detailResult.detail));
      }
    })
    .catch((error: unknown) =>
      {
        renderCodalDiscovery(root, {
        status: 'failed',
        symbol: options.symbol,
        errorMessage: error instanceof Error ? error.message : 'خطای نامشخص در دریافت کدال',
        sourceVerified: false,
        checkedAt: new Date().toISOString()
      });
        renderCodalDetail(root, {
          status: 'network-error',
          errorMessage: error instanceof Error ? error.message : 'خطای نامشخص در دریافت جزئیات کدال'
        });
      }
    );

  root.querySelectorAll<HTMLInputElement>('.ibnav-input').forEach((input) => {
    input.addEventListener('input', () => updateResults(root, formatPersianTimestamp()));
  });

  root.querySelector<HTMLButtonElement>('.ibnav-collapse')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    root.classList.toggle('ibnav-collapsed');
    button.textContent = root.classList.contains('ibnav-collapsed') ? '+' : '−';
  });

  root.querySelector<HTMLButtonElement>('.ibnav-save')?.addEventListener('click', async () => {
    const record: ManualOverrideRecord = {
      symbol: options.symbol,
      inputs: readInputs(root),
      currentPriceSource: options.currentPriceSource,
      updatedAt: toIsoTimestamp()
    };
    await saveManualOverride(record);
    updateResults(root, formatPersianTimestamp(new Date(record.updatedAt)));
  });

  (options.mount ?? document.body).appendChild(root);
  return root;
}
