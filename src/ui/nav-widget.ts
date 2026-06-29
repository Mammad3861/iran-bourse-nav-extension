import type { NavInputs } from '../core/nav-calculator';
import { calculateNav, emptyNavInputs } from '../core/nav-calculator';
import { formatNumberFa, formatPercentRatioFa, parseLocalizedNumber } from '../core/number-utils';
import { formatPersianTimestamp, toIsoTimestamp } from '../core/persian-date-utils';
import { getManualOverride, saveManualOverride } from '../data/cache-store';
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
import type { ManualOverrideRecord } from '../data/manual-overrides';
import {
  applyHighConfidenceSuggestionsToRecord,
  applySuggestionToRecord,
  markFieldAsManual,
  suggestionTarget
} from '../data/suggestion-application';
import {
  codalDiscoveryDiagnosticsJson,
  copyTextWithFallback,
  parserDiagnosticsJson,
  parserTablePreviewText
} from './parser-diagnostics';
import styles from './styles.css?inline';

const WIDGET_ROOT_ID = 'ibnav-widget';
let widgetRenderSequence = 0;

export interface NavWidgetOptions {
  symbol: string;
  insCode?: string;
  codalSymbol?: string;
  instrumentName?: string;
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

function removeDuplicateWidgetRoots(activeRoot: HTMLElement): void {
  document.querySelectorAll<HTMLElement>(`#${WIDGET_ROOT_ID}`).forEach((root) => {
    if (root !== activeRoot) {
      root.remove();
    }
  });
}

function isActiveWidgetRender(root: HTMLElement, renderId: number): boolean {
  void root;
  return widgetRenderSequence === renderId;
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

function discoverySelectionNotice(result: CodalReportDiscoveryResult): string | undefined {
  const selections = [result.diagnostics?.monthlyActivity, result.diagnostics?.financialStatement].filter(Boolean);
  if (selections.some((selection) => selection?.selectedWarnings.length)) {
    return 'گزارش انتخاب‌شده ممکن است مربوط به ناشر دیگری باشد؛ تشخیص گزارش را بررسی کنید.';
  }
  if (selections.some((selection) => selection?.selectedConfidence === 'high' || selection?.selectedConfidence === 'medium')) {
    return 'گزارش انتخاب‌شده با نماد/ناشر تطبیق داده شد.';
  }
  if (result.diagnostics) {
    return 'گزارش به دلیل عدم تطابق نماد/ناشر نادیده گرفته شد.';
  }
  return undefined;
}

function renderDiscoveryDiagnostics(root: HTMLElement, result: CodalReportDiscoveryResult): void {
  const container = root.querySelector<HTMLElement>('[data-ibnav-codal="diagnostics"]');
  if (!container) return;
  container.textContent = '';
  if (!result.diagnostics) return;

  const details = document.createElement('details');
  details.className = 'ibnav-table-preview';
  const summary = document.createElement('summary');
  summary.textContent = 'تشخیص انتخاب گزارش کدال';
  details.appendChild(summary);

  const monthly = result.diagnostics.monthlyActivity;
  const financial = result.diagnostics.financialStatement;
  const meta = document.createElement('p');
  meta.className = 'ibnav-muted';
  meta.textContent = [
    `نماد: ${result.diagnostics.requestedSymbol}`,
    result.diagnostics.requestedIssuerName ? `ناشر: ${result.diagnostics.requestedIssuerName}` : undefined,
    monthly ? `گزارش ماهانه: ${monthly.selectedConfidence}` : undefined,
    financial ? `صورت مالی: ${financial.selectedConfidence}` : undefined
  ]
    .filter(Boolean)
    .join(' | ');
  details.appendChild(meta);

  const rejected = [...(monthly?.candidates ?? []), ...(financial?.candidates ?? [])]
    .filter((candidate) => candidate.rejectedReasons.length || candidate.warnings.length)
    .slice(0, 6);
  if (rejected.length) {
    const list = document.createElement('pre');
    list.className = 'ibnav-preview-code';
    list.textContent = rejected
      .map((candidate) =>
        [
          candidate.report.symbol,
          candidate.report.title,
          `score=${candidate.score.toFixed(1)}`,
          [...candidate.rejectedReasons, ...candidate.warnings].join('، ')
        ].join(' | ')
      )
      .join('\n');
    details.appendChild(list);
  }

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'ibnav-apply ibnav-secondary';
  copyButton.textContent = 'کپی تشخیص انتخاب گزارش';
  copyButton.addEventListener('click', async () => {
    const outcome = await copyTextWithFallback(codalDiscoveryDiagnosticsJson(result), window.navigator.clipboard, (text) =>
      showManualCopyFallback(details, text)
    );
    setApplyStatus(
      root,
      outcome === 'copied'
        ? 'تشخیص انتخاب گزارش کپی شد.'
        : 'کپی خودکار انجام نشد؛ تشخیص انتخاب گزارش برای کپی دستی نمایش داده شد.',
      outcome !== 'copied'
    );
  });
  details.appendChild(copyButton);
  container.appendChild(details);
}

function currentPriceSourceText(source: ManualOverrideRecord['currentPriceSource']): string {
  if (source === 'dom-latest-trade' || source === 'api-latest-trade' || source === 'page') {
    return 'قیمت فعلی: خوانده‌شده از آخرین معامله';
  }
  if (source === 'dom-closing-price' || source === 'api-closing-price') {
    return 'قیمت فعلی: خوانده‌شده از قیمت پایانی';
  }
  return 'قیمت فعلی قابل تشخیص نبود؛ در صورت نیاز دستی وارد کنید';
}

function detectedPriceSource(options: NavWidgetOptions): ManualOverrideRecord['currentPriceSource'] {
  return options.currentPrice !== undefined && options.currentPriceSource !== 'manual'
    ? options.currentPriceSource
    : 'unknown';
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
    status.textContent = `ارتباط با کدال از پس‌زمینه افزونه انجام می‌شود؛ گزارش‌های مرتبط پیدا شد${
      discoverySelectionNotice(result) ? ` - ${discoverySelectionNotice(result)}` : ''
    }`;
  } else if (result.status === 'not-found') {
    status.textContent =
      result.errorMessage ??
      discoverySelectionNotice(result) ??
      'برای این نماد گزارش قابل اتکایی پیدا نشد';
  } else {
    status.textContent = `خطا در دریافت کدال از پس‌زمینه افزونه: ${result.errorMessage ?? 'نامشخص'}`;
  }

  monthly.textContent = reportSummary(result.monthlyActivityReport);
  financial.textContent = reportSummary(result.financialStatementReport);
  updateReportLink(root, '[data-ibnav-codal-link="monthly"]', result.monthlyActivityReport);
  updateReportLink(root, '[data-ibnav-codal-link="financial"]', result.financialStatementReport);
  renderDiscoveryDiagnostics(root, result);
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

function suggestionText(value: ExtractedPortfolioValue): string {
  const confidence =
    value.confidence === 'high' ? 'اطمینان بالا' : value.confidence === 'medium' ? 'اطمینان متوسط' : 'اطمینان پایین';
  const unit = value.unit ? `، واحد: ${value.unit}` : '';
  return `${value.label}: ${formatNumberFa(value.value)} (${confidence}، جدول ${value.sourceTableIndex}${unit})`;
}

function showManualCopyFallback(container: HTMLElement, text: string): void {
  container.querySelector('[data-ibnav-copy-fallback]')?.remove();
  const wrapper = document.createElement('div');
  wrapper.className = 'ibnav-copy-fallback';
  wrapper.dataset.ibnavCopyFallback = 'true';
  const hint = document.createElement('p');
  hint.className = 'ibnav-muted';
  hint.textContent = 'کپی خودکار در دسترس نبود؛ متن زیر را دستی کپی کنید.';
  const textarea = document.createElement('textarea');
  textarea.className = 'ibnav-copy-textarea';
  textarea.readOnly = true;
  textarea.value = text;
  wrapper.append(hint, textarea);
  container.appendChild(wrapper);
  textarea.focus();
  textarea.select();
}

function appendMonthlyDiagnostics(
  list: HTMLElement,
  result: MonthlyActivityParseResult,
  setStatus: (message: string, isError?: boolean) => void
): void {
  const preview = document.createElement('div');
  preview.className = 'ibnav-diagnostics';

  const previewTitle = document.createElement('h5');
  previewTitle.className = 'ibnav-subtitle';
  previewTitle.textContent = 'نمایش جزئیات تشخیص Parser';
  preview.appendChild(previewTitle);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'ibnav-apply ibnav-secondary';
  copyButton.textContent = 'کپی تشخیص Parser';
  copyButton.addEventListener('click', async () => {
    const outcome = await copyTextWithFallback(parserDiagnosticsJson(result), window.navigator.clipboard, (text) =>
      showManualCopyFallback(preview, text)
    );
    if (outcome === 'copied') {
      setStatus('تشخیص Parser کپی شد.');
    } else {
      setStatus('کپی خودکار انجام نشد؛ متن تشخیص برای کپی دستی نمایش داده شد.', true);
    }
  });
  preview.appendChild(copyButton);

  const copyPreviewButton = document.createElement('button');
  copyPreviewButton.type = 'button';
  copyPreviewButton.className = 'ibnav-apply ibnav-secondary';
  copyPreviewButton.textContent = 'کپی پیش‌نمایش جدول‌ها';
  copyPreviewButton.addEventListener('click', async () => {
    const outcome = await copyTextWithFallback(parserTablePreviewText(result), window.navigator.clipboard, (text) =>
      showManualCopyFallback(preview, text)
    );
    if (outcome === 'copied') {
      setStatus('پیش‌نمایش جدول‌ها کپی شد.');
    } else {
      setStatus('کپی خودکار انجام نشد؛ پیش‌نمایش برای کپی دستی نمایش داده شد.', true);
    }
  });
  preview.appendChild(copyPreviewButton);

  if (result.tablePreviews.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'ibnav-muted';
    empty.textContent = 'پیش‌نمایش جدولی برای نمایش وجود ندارد.';
    preview.appendChild(empty);
  }

  for (const table of result.tablePreviews) {
    const item = document.createElement('details');
    item.className = 'ibnav-table-preview';
    const summary = document.createElement('summary');
    summary.textContent = `جدول ${table.index}${table.caption ? ` - ${table.caption}` : ''}`;
    item.appendChild(summary);
    const meta = document.createElement('p');
    meta.className = 'ibnav-muted';
    meta.textContent = `واحد: ${table.detectedUnit ?? 'نامشخص'} | برچسب‌ها: ${table.detectedLabels.join('، ') || 'نامشخص'} | هشدار: ${
      table.warnings.join('، ') || '-'
    }`;
    item.appendChild(meta);
    const diagnostic = result.diagnostics.tables.find((diagnosticTable) => diagnosticTable.tableIndex === table.index);
    if (diagnostic) {
      if (diagnostic.reconstruction) {
        const reconstruction = document.createElement('p');
        reconstruction.className = 'ibnav-muted';
        reconstruction.textContent = [
          'جدول بازسازی‌شده از داده سلولی کدال',
          `تعداد سلول‌ها: ${diagnostic.reconstruction.rawCellCount}`,
          `ابعاد جدول بازسازی‌شده: ${diagnostic.reconstruction.rowCount}×${diagnostic.reconstruction.columnCount}`,
          `metaTableCode: ${diagnostic.reconstruction.metaTableCode ?? '-'}`,
          `هشدار بازسازی: ${diagnostic.reconstruction.warnings.join('، ') || '-'}`
        ].join(' | ');
        item.appendChild(reconstruction);
      }

      const details = document.createElement('p');
      details.className = 'ibnav-muted';
      details.textContent = [
        `ردیف‌های جمع: ${diagnostic.totalRowCandidates.map((row) => `${row.rowIndex + 1}:${row.label}`).join('، ') || '-'}`,
        `ستون بهای تمام‌شده: ${diagnostic.costColumnCandidates.map((column) => `${column.index + 1}:${column.label}`).join('، ') || '-'}`,
        `ستون ارزش بازار: ${diagnostic.marketValueColumnCandidates.map((column) => `${column.index + 1}:${column.label}`).join('، ') || '-'}`,
        `دلیل عدم استخراج: ${diagnostic.failureReasons.join('، ') || '-'}`
      ].join(' | ');
      item.appendChild(details);

      const headers = document.createElement('pre');
      headers.className = 'ibnav-preview-code';
      headers.textContent = [
        `ستون‌ها (raw): ${diagnostic.rawHeaders.join(' | ') || '-'}`,
        `ستون‌ها (normalized): ${diagnostic.normalizedHeaders.join(' | ') || '-'}`
      ].join('\n');
      item.appendChild(headers);
    }
    const rows = document.createElement('pre');
    rows.className = 'ibnav-preview-code';
    rows.textContent = diagnostic
      ? [
          'ردیف‌های نمونه (raw):',
          ...diagnostic.firstRawRows.slice(0, 5).map((row, index) => `${index + 1}. ${row.join(' | ')}`),
          '',
          'ردیف‌های نمونه (normalized):',
          ...diagnostic.firstNormalizedRows.slice(0, 5).map((row, index) => `${index + 1}. ${row.join(' | ')}`)
        ].join('\n')
      : table.normalizedRows.map((row) => row.join(' | ')).join('\n');
    item.appendChild(rows);
    preview.appendChild(item);
  }

  const candidateTitle = document.createElement('h5');
  candidateTitle.className = 'ibnav-subtitle';
  candidateTitle.textContent = 'کاندیدهای استخراج‌شده';
  preview.appendChild(candidateTitle);
  list.appendChild(preview);
}

function recordFromCurrentInputs(
  root: HTMLElement,
  symbol: string,
  currentPriceSource: ManualOverrideRecord['currentPriceSource'],
  previous?: ManualOverrideRecord
): ManualOverrideRecord {
  return {
    symbol,
    inputs: readInputs(root),
    currentPriceSource,
    updatedAt: toIsoTimestamp(),
    fieldSources: { ...(previous?.fieldSources ?? {}) }
  };
}

function setApplyStatus(root: HTMLElement, message: string, isError = false): void {
  const status = root.querySelector<HTMLElement>('[data-ibnav-suggestions="applyStatus"]');
  if (!status) return;
  status.textContent = message;
  status.dataset.state = isError ? 'error' : 'ok';
}

async function persistAppliedRecord(root: HTMLElement, record: ManualOverrideRecord): Promise<void> {
  await saveManualOverride(record);
  updateResults(root, formatPersianTimestamp(new Date(record.updatedAt)));
}

function renderMonthlySuggestions(
  root: HTMLElement,
  result: MonthlyActivityParseResult,
  options: NavWidgetOptions,
  getRecord: () => ManualOverrideRecord | undefined,
  setRecord: (record: ManualOverrideRecord) => void
): void {
  const status = root.querySelector('[data-ibnav-suggestions="status"]');
  const source = root.querySelector('[data-ibnav-suggestions="source"]');
  const list = root.querySelector<HTMLElement>('[data-ibnav-suggestions="list"]');
  const warnings = root.querySelector('[data-ibnav-suggestions="warnings"]');
  const applyAll = root.querySelector<HTMLButtonElement>('[data-ibnav-suggestions="applyAll"]');

  if (!status || !source || !list || !warnings || !applyAll) {
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
  appendMonthlyDiagnostics(list, result, (message, isError) => setApplyStatus(root, message, isError));
  applyAll.hidden = !result.extractedValues.some(
    (value) => value.confidence === 'high' && suggestionTarget(value.kind)
  );
  applyAll.onclick = async () => {
    const current = recordFromCurrentInputs(root, options.symbol, options.currentPriceSource, getRecord());
    const next = applyHighConfidenceSuggestionsToRecord(current, result, {
      symbol: options.symbol,
      currentPriceSource: options.currentPriceSource,
      reportTitle: result.reportTitle,
      reportDate: result.reportPeriod
    });

    for (const [field, value] of Object.entries(next.inputs) as Array<[keyof NavInputs, number | undefined]>) {
      const input = root.querySelector<HTMLInputElement>(`[data-ibnav-field="${field}"]`);
      if (input && value !== undefined) {
        input.value = String(value);
      }
    }

    try {
      await persistAppliedRecord(root, next);
      setRecord(next);
      setApplyStatus(root, 'همه موارد قابل اعتماد با تأیید شما اعمال و ذخیره شد.');
    } catch (error) {
      setApplyStatus(
        root,
        `ذخیره مقدارهای پیشنهادی ناموفق بود: ${error instanceof Error ? error.message : 'خطای نامشخص'}`,
        true
      );
    }
  };

  if (result.extractedValues.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'ibnav-muted';
    empty.textContent = 'مقدار پیشنهادی قابل اعمالی پیدا نشد.';
    list.appendChild(empty);
  }

  for (const value of result.extractedValues) {
    const item = document.createElement('div');
    item.className = 'ibnav-suggestion';
    const text = document.createElement('span');
    text.textContent = suggestionText(value);
    item.appendChild(text);
    const sourceLine = document.createElement('small');
    sourceLine.className = 'ibnav-muted';
    sourceLine.textContent = result.reportPeriod
      ? `${result.reportTitle ?? 'گزارش کدال'} - ${result.reportPeriod}`
      : result.reportTitle ?? 'گزارش کدال';
    item.appendChild(sourceLine);

    const reason = document.createElement('small');
    reason.className = 'ibnav-muted';
    reason.textContent = value.reason ? `دلیل اطمینان: ${value.reason}` : 'دلیل اطمینان: بر اساس برچسب‌های جدول و مقدار عددی.';
    item.appendChild(reason);

    const target = suggestionTarget(value.kind);
    if (target && value.confidence !== 'low') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ibnav-apply';
      button.textContent = 'اعمال مقدار پیشنهادی';
      button.addEventListener('click', async () => {
        const input = root.querySelector<HTMLInputElement>(`[data-ibnav-field="${target}"]`);
        if (!input) return;
        input.value = String(value.value);
        const current = recordFromCurrentInputs(root, options.symbol, options.currentPriceSource, getRecord());
        const next = applySuggestionToRecord(current, value, {
          symbol: options.symbol,
          currentPriceSource: options.currentPriceSource,
          reportTitle: result.reportTitle,
          reportDate: result.reportPeriod
        });
        try {
          await persistAppliedRecord(root, next);
          setRecord(next);
          setApplyStatus(root, 'مقدار پیشنهادی با تأیید شما اعمال و ذخیره شد.');
        } catch (error) {
          setApplyStatus(
            root,
            `ذخیره مقدار پیشنهادی ناموفق بود: ${error instanceof Error ? error.message : 'خطای نامشخص'}`,
            true
          );
        }
      });
      item.appendChild(button);
    }

    const ignoreButton = document.createElement('button');
    ignoreButton.type = 'button';
    ignoreButton.className = 'ibnav-apply ibnav-secondary';
    ignoreButton.textContent = 'نادیده گرفتن';
    ignoreButton.addEventListener('click', () => {
      item.remove();
      setApplyStatus(root, 'پیشنهاد نادیده گرفته شد.');
    });
    item.appendChild(ignoreButton);

    if (value.warning || value.confidence === 'low') {
      const warning = document.createElement('small');
      warning.className = 'ibnav-muted';
      warning.textContent = value.warning ?? 'این مقدار نیاز به بررسی دستی دارد.';
      item.appendChild(warning);
    }
    list.appendChild(item);
  }
}

export async function renderNavWidget(options: NavWidgetOptions): Promise<HTMLElement> {
  const renderId = ++widgetRenderSequence;
  const mount = options.mount ?? document.body;
  ensureStyle();

  let activeRecord = await getManualOverride(options.symbol);
  const inputs = activeRecord?.inputs ?? emptyNavInputs();
  inputs.currentPrice = inputs.currentPrice ?? options.currentPrice;

  const root = (document.getElementById(WIDGET_ROOT_ID) as HTMLElement | null) ?? document.createElement('section');
  root.id = WIDGET_ROOT_ID;
  root.className = 'ibnav-root ibnav-widget';
  root.innerHTML = `
    <header class="ibnav-header">
      <div>
        <h2 class="ibnav-title">محاسبه NAV</h2>
        <div class="ibnav-symbol">نماد: ${options.symbol}</div>
        ${options.instrumentName ? `<div class="ibnav-muted">${options.instrumentName}</div>` : ''}
        ${options.insCode ? `<div class="ibnav-muted">InsCode: ${options.insCode}</div>` : ''}
        ${options.codalSymbol ? `<div class="ibnav-muted">نماد کدال: ${options.codalSymbol}</div>` : ''}
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
        <p class="ibnav-muted" data-ibnav-codal="status">ارتباط با کدال از پس‌زمینه افزونه انجام می‌شود</p>
        <div class="ibnav-row"><span>فعالیت ماهانه</span><span data-ibnav-codal="monthly">-</span></div>
        <a class="ibnav-link" data-ibnav-codal-link="monthly" target="_blank" rel="noreferrer" hidden>مشاهده گزارش فعالیت ماهانه</a>
        <div class="ibnav-row"><span>صورت مالی</span><span data-ibnav-codal="financial">-</span></div>
        <a class="ibnav-link" data-ibnav-codal-link="financial" target="_blank" rel="noreferrer" hidden>مشاهده صورت مالی</a>
        <div data-ibnav-codal="diagnostics"></div>
        <div class="ibnav-row"><span>جزئیات آخرین گزارش</span><span data-ibnav-codal-detail="status">در انتظار نتیجه جستجو</span></div>
        <div class="ibnav-row"><span>زمان دریافت جزئیات</span><span data-ibnav-codal-detail="fetchedAt">-</span></div>
        <p class="ibnav-muted" data-ibnav-codal-detail="warning">ساختار گزارش ممکن است در این نسخه پشتیبانی نشود.</p>
        <div class="ibnav-suggestions">
          <h4 class="ibnav-subtitle">مقادیر پیشنهادی از کدال</h4>
          <p class="ibnav-muted" data-ibnav-suggestions="status">در انتظار دریافت جزئیات گزارش</p>
          <p class="ibnav-muted" data-ibnav-suggestions="source">-</p>
          <button type="button" class="ibnav-save" data-ibnav-suggestions="applyAll" hidden>اعمال همه موارد قابل اعتماد</button>
          <div class="ibnav-suggestion-list" data-ibnav-suggestions="list"></div>
          <p class="ibnav-warning" data-ibnav-suggestions="warnings">هیچ مقداری بدون تأیید شما جایگزین نمی‌شود.</p>
          <p class="ibnav-muted" data-ibnav-suggestions="applyStatus"></p>
        </div>
        <p class="ibnav-warning">منبع کدال در این نسخه تأییدشده و پایدار فرض نمی‌شود؛ محاسبه NAV همچنان فقط از ورودی‌های دستی انجام می‌شود.</p>
      </section>
      <p class="ibnav-muted">${currentPriceSourceText(detectedPriceSource(options))}</p>
      <p class="ibnav-warning">این خروجی فقط یک برآورد محلی است و توصیه سرمایه‌گذاری محسوب نمی‌شود.</p>
    </div>
  `;

  const updatedAt = activeRecord ? formatPersianTimestamp(new Date(activeRecord.updatedAt)) : formatPersianTimestamp();
  updateResults(root, updatedAt);
  const codalSymbolValidation = validateCodalSearchSymbol(options.codalSymbol ?? options.symbol);
  if (!codalSymbolValidation.valid || !codalSymbolValidation.symbol) {
    renderCodalDiscovery(root, {
      status: 'not-found',
      symbol: options.symbol,
      errorMessage: codalSymbolValidation.reason,
      sourceVerified: false,
      checkedAt: new Date().toISOString()
    });
    renderCodalDetail(root, {
      status: 'unavailable',
      errorMessage: codalSymbolValidation.reason
    });
  } else {
    requestCodalDiscovery(codalSymbolValidation.symbol, options.instrumentName)
      .then(async (result) => {
        if (!isActiveWidgetRender(root, renderId)) return;
        renderCodalDiscovery(root, result);
        const report = result.monthlyActivityReport ?? result.financialStatementReport;
        if (!report) {
          renderCodalDetail(root, {
            status: result.status === 'failed' ? 'network-error' : 'unavailable',
            errorMessage: result.errorMessage
          });
          return;
        }
        const detailResult = await requestCodalReportDetail(report);
        if (!isActiveWidgetRender(root, renderId)) return;
        renderCodalDetail(root, detailResult);
        if (detailResult.detail) {
          renderMonthlySuggestions(
            root,
            parseMonthlyActivityReport(detailResult.detail),
            options,
            () => activeRecord,
            (record) => {
              activeRecord = record;
            }
          );
        }
      })
      .catch((error: unknown) => {
        if (!isActiveWidgetRender(root, renderId)) return;
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
      });
  }

  root.querySelectorAll<HTMLInputElement>('.ibnav-input').forEach((input) => {
    input.addEventListener('input', () => {
      const field = input.dataset.ibnavField as keyof NavInputs | undefined;
      const parsed = parseLocalizedNumber(input.value);
      if (field && activeRecord?.fieldSources?.[field]?.source === 'codal-suggestion') {
        activeRecord = markFieldAsManual(activeRecord, field, parsed);
        setApplyStatus(root, 'ویرایش دستی ثبت شد؛ منبع این مقدار اکنون دستی است.');
      }
      updateResults(root, formatPersianTimestamp());
    });
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
      updatedAt: toIsoTimestamp(),
      fieldSources: activeRecord?.fieldSources
    };
    try {
      await saveManualOverride(record);
      activeRecord = record;
      updateResults(root, formatPersianTimestamp(new Date(record.updatedAt)));
      setApplyStatus(root, 'ورودی‌های دستی ذخیره شد.');
    } catch (error) {
      setApplyStatus(
        root,
        `ذخیره ورودی‌های دستی ناموفق بود: ${error instanceof Error ? error.message : 'خطای نامشخص'}`,
        true
      );
    }
  });

  removeDuplicateWidgetRoots(root);
  if (!root.isConnected) {
    mount.appendChild(root);
  }
  removeDuplicateWidgetRoots(root);
  return root;
}
