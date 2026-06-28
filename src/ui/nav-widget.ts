import type { NavInputs } from '../core/nav-calculator';
import { calculateNav, emptyNavInputs } from '../core/nav-calculator';
import { formatNumberFa, formatPercentRatioFa, parseLocalizedNumber } from '../core/number-utils';
import { formatPersianTimestamp, toIsoTimestamp } from '../core/persian-date-utils';
import { getManualOverride, saveManualOverride } from '../data/cache-store';
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
