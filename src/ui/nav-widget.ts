import type { NavInputs } from '../core/nav-calculator';
import { analyzeNavCompleteness, calculateNav, emptyNavInputs } from '../core/nav-calculator';
import { formatNumberFa, formatPercentRatioFa, parseLocalizedNumber } from '../core/number-utils';
import { formatPersianTimestamp, toIsoTimestamp } from '../core/persian-date-utils';
import { getManualOverride, saveManualOverride } from '../data/cache-store';
import type {
  CodalReportDetailResult,
  CodalReportDiscoveryResult,
  CodalReportReference
} from '../data/codal-client';
import {
  mergeMonthlyActivityParseResults,
  parseFinancialStatementReport,
  parseMonthlyActivityReport,
  type ExtractedPortfolioValue,
  type MonthlyActivityParseResult
} from '../data/codal-monthly-parser';
import { validateCodalSearchSymbol } from '../data/codal-symbol-validation';
import {
  createLiveNoCandidatesParseResult,
  createUnavailableNetworkParseResult,
  getParsedCodalSummary,
  markParseResultStale,
  parseResultFromParsedCache,
  parserDataStatusFor,
  saveParsedCodalSummary
} from '../data/codal-parsed-cache';
import { requestCodalDiscovery, requestCodalReportDetail } from '../data/codal-transport';
import { manualReviewMarketValueSummary } from '../data/market-value-review';
import type { ManualOverrideRecord, ManualValueSourceMetadata } from '../data/manual-overrides';
import { manualFieldMetadata, normalizeManualOverrideRecord } from '../data/manual-overrides';
import { buildNavCompletionSummary, navCompletionFieldLabels } from '../data/nav-completion';
import { smokeSummaryText, type DetailPipelineStatus } from '../data/smoke-summary';
import { classifyHoldingSupport, type HoldingSupportClassification } from '../data/symbol-classification';
import {
  applySuggestionToRecord,
  confirmZeroField,
  markSuggestionFieldReviewed,
  markFieldAsManual,
  resetCodalSuggestionFields,
  suggestionTarget
} from '../data/suggestion-application';
import {
  appliedSourceLabel,
  appliedSuggestionMessage,
  applyFailureMessage,
  candidateApplyState,
  isAppliedSuggestionSource,
  navFieldLabels as fieldLabels,
  suggestionSourceKindFor
} from './suggestion-ui-utils';
import {
  codalDiscoveryDiagnosticsJson,
  copyTextWithFallback,
  parserDiagnosticsJson,
  parserTablePreviewText
} from './parser-diagnostics';
import {
  compactParserWarnings,
  discoverySelectionNotice as sharedDiscoverySelectionNotice,
  financialReportDiscoverySummary,
  sourceStrategySummaryText
} from './codal-display-utils';
import styles from './styles.css?inline';

const WIDGET_ROOT_ID = 'ibnav-widget';
const EXTENSION_CONTEXT_INVALIDATED_MESSAGE =
  'افزونه reload شده است؛ صفحه را refresh کنید و دوباره تلاش کنید.';
let widgetRenderSequence = 0;

function userFacingErrorMessage(error: unknown, fallback = 'خطای نامشخص'): string {
  const message = error instanceof Error ? error.message : String(error ?? fallback);
  if (/Extension context invalidated|context invalidated/i.test(message)) {
    return EXTENSION_CONTEXT_INVALIDATED_MESSAGE;
  }
  return message || fallback;
}

export interface NavWidgetOptions {
  symbol: string;
  insCode?: string;
  codalSymbol?: string;
  instrumentName?: string;
  currentPrice?: number;
  totalShares?: number;
  currentPriceSource: ManualOverrideRecord['currentPriceSource'];
  mount?: HTMLElement;
}

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
      inputs[field] = parsed;
    }
  }

  return inputs;
}

function updateResults(root: HTMLElement, updatedAt: string): void {
  const inputs = readInputs(root);
  const result = calculateNav(inputs);
  const completeness = analyzeNavCompleteness(inputs);
  root.querySelector('[data-ibnav-result="navTotal"]')!.textContent = completeness.navTotalAvailable
    ? formatNumberFa(result.navTotal)
    : 'محاسبه ناقص';
  root.querySelector('[data-ibnav-result="navPerShare"]')!.textContent = formatNumberFa(
    completeness.navTotalAvailable ? result.navPerShare : null,
    2
  );
  root.querySelector('[data-ibnav-result="pToNav"]')!.textContent = formatPercentRatioFa(
    completeness.navTotalAvailable ? result.pToNav : null
  );
  root.querySelector('[data-ibnav-result="updatedAt"]')!.textContent = updatedAt;
  const status = root.querySelector<HTMLElement>('[data-ibnav-result="status"]');
  const warnings = root.querySelector<HTMLElement>('[data-ibnav-result="warnings"]');
  if (status) {
    const labels = { complete: 'کامل', incomplete: 'ناقص', 'needs-review': 'نیازمند بررسی دستی' };
    status.textContent = labels[completeness.status];
    status.dataset.state = completeness.status;
  }
  if (warnings) {
    const missing = completeness.missingFields.length
      ? `فیلدهای واردنشده: ${completeness.missingFields.map((field) => fieldLabels[field]).join('، ')}.`
      : '';
    const explicitZeros = completeness.explicitZeroFields.length
      ? `صفرهای ثبت‌شده: ${completeness.explicitZeroFields.map((field) => fieldLabels[field]).join('، ')}.`
      : '';
    const details = [...completeness.warnings, missing, explicitZeros].filter(Boolean).join(' ');
    warnings.textContent = details;
    warnings.hidden = details.length === 0;
  }
}

function reportSummary(report: CodalReportReference | undefined): string {
  if (!report) {
    return 'یافت نشد';
  }

  return report.publishedAt ? `${report.title} - ${report.publishedAt}` : report.title;
}

function discoveryUnavailableReportText(result: CodalReportDiscoveryResult): string {
  if (result.status === 'stale-cache') return 'نمایش از داده ذخیره‌شده قدیمی';
  if (result.status === 'not-found') return 'یافت نشد';
  return 'به‌دلیل خطای اتصال بررسی نشد';
}

function monthlySummaryForDiscovery(result: CodalReportDiscoveryResult): string {
  return result.monthlyActivityReport ? reportSummary(result.monthlyActivityReport) : discoveryUnavailableReportText(result);
}

function financialSummaryForDiscovery(result: CodalReportDiscoveryResult): string {
  return financialReportDiscoverySummary(result);
}

function discoveryStatusText(result: CodalReportDiscoveryResult): string {
  if (result.status === 'found') {
    return `ارتباط با کدال از پس‌زمینه افزونه انجام می‌شود؛ گزارش‌های مرتبط پیدا شد${
      sharedDiscoverySelectionNotice(result) ? ` - ${sharedDiscoverySelectionNotice(result)}` : ''
    }`;
  }
  if (result.status === 'not-found') {
    return result.errorMessage ?? sharedDiscoverySelectionNotice(result) ?? 'برای این نماد گزارش قابل اتکایی پیدا نشد';
  }
  if (result.status === 'stale-cache') {
    return [
      'داده کدال قدیمی / stale نمایش داده می‌شود.',
      result.cachedAt ? `زمان ذخیره: ${formatPersianTimestamp(new Date(result.cachedAt))}.` : undefined,
      result.errorMessage
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [
    'کدال در حال حاضر قابل دریافت نیست؛ محاسبه دستی همچنان قابل استفاده است.',
    result.attemptCount ? `تعداد تلاش: ${result.attemptCount}.` : undefined,
    result.errorMessage,
    'داده ذخیره‌شده‌ای برای این نماد وجود ندارد.'
  ]
    .filter(Boolean)
    .join(' ');
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
  const retry = root.querySelector<HTMLButtonElement>('[data-ibnav-codal="retry"]');

  if (!status || !monthly || !financial) {
    return;
  }

  status.textContent = discoveryStatusText(result);
  if (retry) {
    retry.hidden = result.status === 'found' || result.status === 'not-found';
  }

  monthly.textContent = monthlySummaryForDiscovery(result);
  financial.textContent = financialSummaryForDiscovery(result);
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

function detailPipelineStatusText(status: DetailPipelineStatus): string {
  switch (status) {
    case 'fetching-detail':
      return 'در حال دریافت جزئیات گزارش کدال...';
    case 'parsing':
      return 'در حال تحلیل جدول‌های گزارش...';
    case 'completed':
      return 'تحلیل گزارش کامل شد.';
    case 'failed':
      return 'تحلیل گزارش ناموفق بود؛ جزئیات خطا را بررسی کنید.';
    case 'stale-cache-used':
      return 'داده زنده دریافت نشد؛ نتیجه ذخیره‌شده نمایش داده شده است.';
    case 'not-started':
    default:
      return 'تحلیل گزارش هنوز شروع نشده است.';
  }
}

function smokeReadinessHint(status: DetailPipelineStatus): string {
  if (status === 'fetching-detail' || status === 'parsing') {
    return 'تحلیل گزارش هنوز کامل نشده است؛ چند لحظه صبر کنید و دوباره Smoke بگیرید.';
  }
  if (status === 'failed') {
    return 'Smoke ممکن است ناقص باشد؛ دریافت یا تحلیل جزئیات گزارش ناموفق بود.';
  }
  if (status === 'stale-cache-used') {
    return 'Smoke با نتیجه ذخیره‌شده تهیه می‌شود؛ داده‌ها زنده نیستند.';
  }
  if (status === 'not-started') {
    return 'Smoke هنوز آماده نیست؛ ابتدا دریافت و تحلیل جزئیات گزارش باید انجام شود.';
  }
  return 'Smoke آماده است.';
}

function updateDetailPipelineUi(root: HTMLElement, status: DetailPipelineStatus): void {
  const progress = root.querySelector<HTMLElement>('[data-ibnav-codal-detail="pipeline"]');
  const smokeHint = root.querySelector<HTMLElement>('[data-ibnav-smoke-readiness]');
  if (progress) {
    progress.textContent = detailPipelineStatusText(status);
    progress.dataset.state = status;
  }
  if (smokeHint) {
    smokeHint.textContent = smokeReadinessHint(status);
    smokeHint.dataset.state = status === 'completed' ? 'ok' : 'warning';
  }
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
  const scaled =
    value.unitMultiplier && value.unitMultiplier !== 1
      ? ` | خام: ${value.rawText} | مقدار مقیاس‌گذاری‌شده: ${formatNumberFa(value.value)}`
      : '';
  return `${value.label}: ${formatNumberFa(value.value)} (${confidence}، جدول ${value.sourceTableIndex}${unit}${scaled})`;
}

function suggestionSafetyWarnings(value: ExtractedPortfolioValue, result: MonthlyActivityParseResult): string[] {
  const warnings: string[] = [];
  if (
    value.kind === 'listedPortfolioCostValue' &&
    !result.extractedValues.some((candidate) => candidate.kind === 'listedPortfolioMarketValue')
  ) {
    warnings.push('اعمال بهای تمام‌شده به‌تنهایی NAV را کامل نمی‌کند؛ ارزش روز پرتفوی بورسی هنوز وارد نشده است.');
  }
  if (value.confidence === 'medium' && value.unit === 'نامشخص') {
    warnings.push('واحد گزارش نامشخص است؛ این مقدار خام است و ممکن است نیاز به مقیاس‌گذاری داشته باشد.');
  }
  if (value.kind === 'equitySuggestion') {
    warnings.push('اعمال حقوق صاحبان سهام به‌تنهایی NAV را کامل نمی‌کند؛ سایر ورودی‌های ضروری باید دستی بررسی شوند.');
    if (value.confidence === 'low') {
      warnings.push(
        'پیشنهاد حقوق صاحبان سهام پیدا شد، اما واحد/دوره با اطمینان تشخیص داده نشد؛ قبل از اعمال حتماً با صورت مالی تطبیق دهید.'
      );
    }
  }
  if (value.kind === 'totalSharesSuggestion') {
    warnings.push('اعمال تعداد سهام فقط برای NAV هر سهم/P/NAV استفاده می‌شود و NAV کل را کامل نمی‌کند.');
  }
  return warnings;
}

function tsetmcTotalSharesParseResult(value: number, options: NavWidgetOptions): MonthlyActivityParseResult {
  const parsedAt = new Date().toISOString();
  const suggestion: ExtractedPortfolioValue = {
    kind: 'totalSharesSuggestion',
    label: 'تعداد کل سهام',
    value,
    rawText: String(value),
    rawValue: value,
    unit: 'سهم',
    unitMultiplier: 1,
    confidence: 'medium',
    sourceTableIndex: -1,
    sourceTableCaption: 'TSETMC instrument info',
    rowLabel: 'TSETMC instrument info',
    columnLabel: 'zTitad / totalShares',
    reason: 'TSETMC instrument info، فیلد تعداد سهام (medium)',
    warning: 'تعداد سهام از داده TSETMC خوانده شده و پیش از اعمال باید با منبع رسمی تطبیق داده شود.'
  };

  return {
    status: 'parsed',
    reportTitle: 'TSETMC instrument info',
    sourceReportUrl: options.insCode ? `https://www.tsetmc.com/instInfo/${options.insCode}` : undefined,
    tableCandidates: [],
    extractedValues: [suggestion],
    primarySuggestions: [suggestion],
    secondarySuggestions: [],
    tablePreviews: [],
    diagnostics: {
      symbol: options.symbol,
      codalSymbol: options.codalSymbol,
      reportTitle: 'TSETMC instrument info',
      reportDate: parsedAt,
      reportUrl: options.insCode ? `https://www.tsetmc.com/instInfo/${options.insCode}` : undefined,
      fetchTimestamp: parsedAt,
      detectedTableCount: 0,
      parserStatus: 'parsed',
      parserWarnings: ['تعداد کل سهام از داده TSETMC به‌عنوان پیشنهاد قابل بررسی اضافه شد.'],
      extractedCandidates: [suggestion],
      rejectedCandidates: [],
      tables: []
    },
    warnings: ['تعداد کل سهام از TSETMC پیشنهاد شده است و به‌تنهایی NAV را کامل نمی‌کند.'],
    parsedAt
  };
}

function diagnosticsTableFor(
  result: MonthlyActivityParseResult,
  table: MonthlyActivityParseResult['tablePreviews'][number]
): MonthlyActivityParseResult['diagnostics']['tables'][number] | undefined {
  return result.diagnostics.tables.find(
    (diagnosticTable) =>
      diagnosticTable.tableIndex === table.index &&
      (diagnosticTable.sourceGroup ?? 'monthly') === (table.sourceGroup ?? 'monthly')
  );
}

function diagnosticsGroupLabel(sourceGroup: string | undefined): string {
  if (sourceGroup === 'monthly-excel') return 'نمایش جدول‌های Excel گزارش ماهانه';
  if (sourceGroup === 'financial') return 'نمایش جدول‌های صورت مالی';
  if (sourceGroup === 'financial-excel') return 'نمایش جدول‌های Excel صورت مالی';
  if (sourceGroup === 'tsetmc') return 'TSETMC instrument info';
  return 'نمایش جدول‌های گزارش ماهانه';
}

function hasCodalAppliedFields(record: ManualOverrideRecord | undefined): boolean {
  return Object.values(record?.fieldSources ?? {}).some((source) => isAppliedSuggestionSource(source?.source));
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

  if (result.diagnostics.sourceStrategy) {
    const sourceStrategy = document.createElement('p');
    sourceStrategy.className = 'ibnav-muted';
    sourceStrategy.textContent = sourceStrategySummaryText(result.diagnostics.sourceStrategy);
    preview.appendChild(sourceStrategy);
  }

  const excelCandidates = result.secondarySuggestions.filter((value) => {
    const table = result.diagnostics.tables.find((item) => item.tableIndex === value.sourceTableIndex);
    return table?.source === 'codal-excel';
  });
  if (excelCandidates.length) {
    const details = document.createElement('details');
    details.className = 'ibnav-table-preview';
    const summary = document.createElement('summary');
    summary.textContent = 'نمایش همه کاندیدهای Excel';
    details.appendChild(summary);
    const body = document.createElement('pre');
    body.className = 'ibnav-preview-code';
    body.textContent = excelCandidates
      .map((value) =>
        [
          `${value.kind} | table=${value.sourceTableIndex} | score=${value.rankingScore ?? '-'}`,
          `row=${value.rowLabel ?? '-'} | column=${value.columnLabel ?? '-'}`,
          `raw=${value.rawText} | unit=${value.unit ?? '-'} | scaled=${formatNumberFa(value.value)}`,
          value.warning ? `warning=${value.warning}` : undefined,
          value.reason ? `reason=${value.reason}` : undefined
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n');
    details.appendChild(body);
    preview.appendChild(details);
  }

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

  const groupedTables = new Map<string, typeof result.tablePreviews>();
  for (const table of result.tablePreviews) {
    const group = table.sourceGroup ?? 'monthly';
    groupedTables.set(group, [...(groupedTables.get(group) ?? []), table]);
  }

  for (const [group, tables] of groupedTables.entries()) {
    const groupDetails = document.createElement('details');
    groupDetails.className = 'ibnav-table-preview';
    const groupSummary = document.createElement('summary');
    groupSummary.textContent = `${diagnosticsGroupLabel(group)} (${tables.length})`;
    groupDetails.appendChild(groupSummary);
    for (const table of tables) {
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
    const diagnostic = diagnosticsTableFor(result, table);
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
      groupDetails.appendChild(item);
    }
    preview.appendChild(groupDetails);
  }

  list.appendChild(preview);
}

function reviewCandidateDetails(value: ExtractedPortfolioValue, result: MonthlyActivityParseResult): string {
  const table = result.diagnostics.tables.find((item) => item.tableIndex === value.sourceTableIndex);
  return [
    `مقدار قابل اعمال: ${formatNumberFa(value.value)}`,
    `خام: ${value.rawText}`,
    value.rawValue !== undefined ? `rawValue: ${formatNumberFa(value.rawValue)}` : undefined,
    value.unit ? `واحد: ${value.unit}` : undefined,
    value.unitMultiplier !== undefined ? `ضریب واحد: ${formatNumberFa(value.unitMultiplier)}` : undefined,
    value.unitMultiplier && value.unitMultiplier !== 1 ? `مقدار مقیاس‌گذاری‌شده: ${formatNumberFa(value.value)}` : undefined,
    `گزارش: ${result.reportTitle ?? '-'}`,
    `جدول: ${value.sourceTableIndex}${table?.sourceGroup ? ` (${table.sourceGroup})` : ''}`,
    `ردیف: ${value.rowLabel ?? '-'}`,
    `ستون: ${value.columnLabel ?? '-'}`,
    `اطمینان: ${value.confidence}`,
    value.rankingScore !== undefined ? `امتیاز: ${formatNumberFa(value.rankingScore)}` : undefined,
    value.warning ? `هشدار: ${value.warning}` : undefined
  ]
    .filter(Boolean)
    .join(' | ');
}

function appendManualReviewMarketCandidates(
  list: HTMLElement,
  result: MonthlyActivityParseResult,
  root: HTMLElement,
  options: NavWidgetOptions,
  getRecord: () => ManualOverrideRecord | undefined,
  setRecord: (record: ManualOverrideRecord) => void,
  support?: HoldingSupportClassification
): void {
  const reviewSummary = manualReviewMarketValueSummary(result);
  const shouldShowEmptyState =
    reviewSummary.totalCandidates > 0 || result.diagnostics.sourceStrategy?.marketValueStatus === 'ambiguous';
  if (reviewSummary.visible.length === 0) {
    if (!shouldShowEmptyState) return;
    const empty = document.createElement('p');
    empty.className = 'ibnav-muted';
    empty.textContent = [
      'کاندید قابل نمایش برای بررسی دستی ارزش روز پیدا نشد؛ جزئیات کامل در تشخیص Parser موجود است.',
      `کاندیدهای قابل بررسی: 0`,
      `کاندیدهای حذف‌شده از نمایش: ${formatNumberFa(reviewSummary.hiddenCandidates)}`
    ].join(' ');
    list.appendChild(empty);
    return;
  }

  const stale = result.warnings.some((warning) => warning.includes('داده ذخیره‌شده قدیمی'));
  const details = document.createElement('details');
  details.className = 'ibnav-table-preview';
  const summary = document.createElement('summary');
  summary.textContent = 'بررسی دستی کاندیدهای ارزش روز پرتفوی بورسی';
  details.appendChild(summary);

  const intro = document.createElement('p');
  intro.className = 'ibnav-warning';
  intro.textContent = [
    'این گزینه‌ها مبهم هستند و فقط پس از تطبیق دستی با گزارش کدال باید اعمال شوند.',
    `کاندیدهای قابل بررسی: ${formatNumberFa(reviewSummary.visible.length)}.`,
    `کاندیدهای حذف‌شده از نمایش: ${formatNumberFa(reviewSummary.hiddenCandidates)}.`
  ].join(' ');
  details.appendChild(intro);

  for (const value of reviewSummary.visible) {
    const item = document.createElement('div');
    item.className = 'ibnav-suggestion';
    const text = document.createElement('span');
    text.textContent = reviewCandidateDetails(value, result);
    item.appendChild(text);

    if (stale) {
      const staleWarning = document.createElement('small');
      staleWarning.className = 'ibnav-warning';
      staleWarning.textContent = 'این مقدار از داده ذخیره‌شده قدیمی اعمال خواهد شد.';
      item.appendChild(staleWarning);
    }

    const state = candidateApplyState(getRecord(), value, 'codal-excel-manual-review', result.reportTitle);
    if (state === 'exact-applied') {
      const applied = document.createElement('strong');
      applied.className = 'ibnav-status-badge';
      applied.textContent = 'اعمال‌شده';
      item.appendChild(applied);
      details.appendChild(item);
      continue;
    }
    if (state === 'other-suggestion-applied' || state === 'manual-present') {
      const note = document.createElement('small');
      note.className = 'ibnav-warning';
      note.textContent =
        state === 'other-suggestion-applied'
          ? 'کاندید دیگری برای این فیلد اعمال شده است؛ جایگزینی مقدار فعلی با این کاندید نیازمند تأیید شماست.'
          : 'برای این فیلد مقدار دستی ثبت شده است؛ اعمال این کاندید مقدار فعلی را جایگزین می‌کند.';
      item.appendChild(note);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ibnav-apply';
    button.textContent = state === 'empty' ? 'اعمال با هشدار شدید' : 'جایگزینی مقدار فعلی با این کاندید';
    button.addEventListener('click', async () => {
      const confirmed = window.confirm(
        'این مقدار از بین چند کاندید مبهم انتخاب می‌شود و ممکن است اشتباه باشد. فقط اگر با گزارش کدال تطبیق داده‌اید اعمال کنید.'
      );
      if (!confirmed) return;

      const current = recordFromCurrentInputs(root, options.symbol, options.currentPriceSource, getRecord());
      const next = applySuggestionToRecord(current, value, {
        symbol: options.symbol,
        currentPriceSource: options.currentPriceSource,
        reportTitle: result.reportTitle,
        reportDate: result.reportPeriod,
        sourceKind: 'codal-excel-manual-review',
        stale
      });

      try {
        const saved = await persistAppliedRecord(root, next);
        applyRecordInputsToForm(root, saved);
        setRecord(saved);
        updateResetCodalButton(root, saved);
        updateCompletionWorkflow(root, options, getRecord, setRecord, result, support);
        renderMonthlySuggestions(root, result, options, getRecord, setRecord, support);
        setApplyStatus(root, appliedSuggestionMessage('listedPortfolioMarketValue', 'codal-excel-manual-review'));
      } catch (error) {
        setApplyStatus(
          root,
          applyFailureMessage(error),
          true
        );
      }
    });
    item.appendChild(button);
    details.appendChild(item);
  }

  list.appendChild(details);
}

function recordFromCurrentInputs(
  root: HTMLElement,
  symbol: string,
  currentPriceSource: ManualOverrideRecord['currentPriceSource'],
  previous?: ManualOverrideRecord
): ManualOverrideRecord {
  const timestamp = toIsoTimestamp();
  const inputs = readInputs(root);
  const fieldSources: Partial<Record<keyof NavInputs, ManualValueSourceMetadata>> = { ...(previous?.fieldSources ?? {}) };
  for (const field of inputFields) {
    const input = root.querySelector<HTMLInputElement>(`[data-ibnav-field="${field}"]`);
    if (inputs[field] === undefined) {
      delete fieldSources[field];
    } else if (input?.dataset.ibnavTouched === 'true' && !isAppliedSuggestionSource(fieldSources[field]?.source)) {
      fieldSources[field] = manualFieldMetadata(inputs[field], timestamp);
    }
  }

  return {
    symbol,
    inputs,
    currentPriceSource,
    updatedAt: timestamp,
    fieldSources
  };
}

function manualRecordFromCurrentInputs(
  root: HTMLElement,
  symbol: string,
  currentPriceSource: ManualOverrideRecord['currentPriceSource'],
  previous?: ManualOverrideRecord
): ManualOverrideRecord {
  const timestamp = toIsoTimestamp();
  const inputs = readInputs(root);
  const fieldSources: Partial<Record<keyof NavInputs, ManualValueSourceMetadata>> = { ...(previous?.fieldSources ?? {}) };
  for (const field of inputFields) {
    const value = inputs[field];
    if (value === undefined) {
      delete fieldSources[field];
    } else {
      fieldSources[field] = manualFieldMetadata(value, timestamp);
    }
  }

  return {
    symbol,
    inputs,
    currentPriceSource,
    updatedAt: timestamp,
    fieldSources
  };
}

function setApplyStatus(root: HTMLElement, message: string, isError = false): void {
  const status = root.querySelector<HTMLElement>('[data-ibnav-suggestions="applyStatus"]');
  if (!status) return;
  status.textContent = message;
  status.dataset.state = isError ? 'error' : 'ok';
}

function applyRecordInputsToForm(root: HTMLElement, record: ManualOverrideRecord): void {
  for (const [field, value] of Object.entries(record.inputs) as Array<[keyof NavInputs, number | undefined]>) {
    const input = root.querySelector<HTMLInputElement>(`[data-ibnav-field="${field}"]`);
    if (input) {
      input.value = value === undefined ? '' : String(value);
    }
  }
}

async function persistAppliedRecord(root: HTMLElement, record: ManualOverrideRecord): Promise<ManualOverrideRecord> {
  await saveManualOverride(record);
  const saved = await getManualOverride(record.symbol);
  if (!saved) {
    throw new Error('Saved manual override could not be verified.');
  }
  applyRecordInputsToForm(root, saved);
  updateResults(root, formatPersianTimestamp(new Date(saved.updatedAt)));
  updateFieldSourceBadges(root, saved);
  return saved;
}

function updateResetCodalButton(root: HTMLElement, record: ManualOverrideRecord | undefined): void {
  const button = root.querySelector<HTMLButtonElement>('[data-ibnav-reset-codal]');
  if (button) {
    button.hidden = !hasCodalAppliedFields(record);
  }
}

function updateFieldSourceBadges(root: HTMLElement, record: ManualOverrideRecord | undefined): void {
  const container = root.querySelector<HTMLElement>('[data-ibnav-field-sources]');
  if (!container) return;
  container.textContent = '';
  const fieldSources = record?.fieldSources ?? {};
  for (const [field, source] of Object.entries(fieldSources) as Array<[keyof NavInputs, ManualValueSourceMetadata]>) {
    if (source.source === 'system' || source.source === 'default') continue;
    const item = document.createElement('p');
    item.className = 'ibnav-muted';
    item.textContent = appliedSourceLabel(field, source);
    container.appendChild(item);
  }
}

function updateCompletionWorkflow(
  root: HTMLElement,
  options: NavWidgetOptions,
  getRecord: () => ManualOverrideRecord | undefined,
  setRecord: (record: ManualOverrideRecord) => void,
  latestParseResult?: MonthlyActivityParseResult,
  support?: HoldingSupportClassification
): void {
  const container = root.querySelector<HTMLElement>('[data-ibnav-completion]');
  if (!container) return;

  const record = recordFromCurrentInputs(root, options.symbol, options.currentPriceSource, getRecord());
  const summary = buildNavCompletionSummary(record, latestParseResult, support);
  container.textContent = '';

  const header = document.createElement('div');
  header.className = 'ibnav-row';
  const title = document.createElement('strong');
  title.textContent = 'مسیر تکمیل NAV';
  const badge = document.createElement('span');
  badge.className = 'ibnav-status-badge';
  badge.dataset.state = summary.status === 'incomplete' ? 'incomplete' : summary.status === 'complete-reviewed' ? 'complete' : 'needs-review';
  badge.textContent = summary.statusLabel;
  header.append(title, badge);
  container.appendChild(header);

  const summaryText = document.createElement('p');
  summaryText.className = 'ibnav-muted';
  summaryText.textContent = [
    summary.summaryText,
    summary.navShareGuidance
  ].join(' ');
  container.appendChild(summaryText);

  if (support?.message && support.status !== 'likely-holding') {
    const unsupported = document.createElement('p');
    unsupported.className = 'ibnav-warning';
    unsupported.textContent = support.message;
    container.appendChild(unsupported);
  }

  if (summary.navTotalMissingFields.length) {
    const missing = document.createElement('p');
    missing.className = 'ibnav-warning';
    missing.textContent = `فیلدهای واردنشده: ${summary.navTotalMissingFields.map((field) => navCompletionFieldLabels[field]).join('، ')}.`;
    container.appendChild(missing);
  }

  for (const warning of summary.pairWarnings) {
    const item = document.createElement('p');
    item.className = 'ibnav-warning';
    item.textContent = warning;
    container.appendChild(item);
  }

  const list = document.createElement('div');
  list.className = 'ibnav-completion-list';
  for (const field of summary.fields) {
    const item = document.createElement('div');
    item.className = 'ibnav-completion-item';
    const row = document.createElement('div');
    row.className = 'ibnav-row';
    const label = document.createElement('span');
    label.textContent = field.label;
    const status = document.createElement('strong');
    status.textContent = field.statusLabel;
    row.append(label, status);
    item.appendChild(row);

    const guidance = document.createElement('p');
    guidance.className = field.needsReview || !field.present ? 'ibnav-warning' : 'ibnav-muted';
    guidance.textContent = field.guidance;
    item.appendChild(guidance);

    if (field.canConfirmZero) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ibnav-apply ibnav-secondary';
      button.textContent = 'ثبت صفر با تأیید من';
      button.addEventListener('click', async () => {
        const current = recordFromCurrentInputs(root, options.symbol, options.currentPriceSource, getRecord());
        const next = confirmZeroField(current, field.field);
        try {
          const saved = await persistAppliedRecord(root, next);
          applyRecordInputsToForm(root, saved);
          setRecord(saved);
          updateResetCodalButton(root, saved);
          updateCompletionWorkflow(root, options, getRecord, setRecord, latestParseResult, support);
          setApplyStatus(root, `${field.label} با مقدار صفر و تأیید شما ذخیره شد.`);
        } catch (error) {
          setApplyStatus(root, applyFailureMessage(error), true);
        }
      });
      item.appendChild(button);
    }

    if (field.canConfirmReview) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ibnav-apply ibnav-secondary';
      button.textContent = 'تأیید بررسی دستی';
      button.addEventListener('click', async () => {
        const current = recordFromCurrentInputs(root, options.symbol, options.currentPriceSource, getRecord());
        const next = markSuggestionFieldReviewed(current, field.field);
        try {
          const saved = await persistAppliedRecord(root, next);
          setRecord(saved);
          updateResetCodalButton(root, saved);
          updateCompletionWorkflow(root, options, getRecord, setRecord, latestParseResult, support);
          setApplyStatus(root, `${field.label} به‌عنوان بررسی‌شده علامت‌گذاری شد.`);
        } catch (error) {
          setApplyStatus(root, applyFailureMessage(error), true);
        }
      });
      item.appendChild(button);
    }

    list.appendChild(item);
  }
  container.appendChild(list);
}

function renderMonthlySuggestions(
  root: HTMLElement,
  result: MonthlyActivityParseResult,
  options: NavWidgetOptions,
  getRecord: () => ManualOverrideRecord | undefined,
  setRecord: (record: ManualOverrideRecord) => void,
  support?: HoldingSupportClassification
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

  const financialTables = result.diagnostics.tables.filter((table) => table.sourceGroup?.startsWith('financial'));
  const hasEquitySuggestion = result.extractedValues.some((value) => value.kind === 'equitySuggestion');
  const equityMissingWarning =
    financialTables.length > 0 && !hasEquitySuggestion
      ? financialTables.some((table) => (table.equityRowCandidates?.length ?? 0) > 0)
        ? 'چند ردیف مرتبط با حقوق مالکانه دیده شد اما به‌دلیل ابهام ردیف/ستون/واحد پیشنهاد قابل اعمال ساخته نشد.'
        : 'صورت مالی معتبر پیدا شد، اما ردیف جمع حقوق صاحبان سهام/حقوق مالکانه با اطمینان کافی استخراج نشد؛ جزئیات تشخیص را بررسی کنید یا مقدار را دستی وارد کنید.'
      : undefined;
  const compactWarnings = compactParserWarnings([...result.warnings, ...(equityMissingWarning ? [equityMissingWarning] : [])]);
  warnings.textContent = compactWarnings.length
    ? compactWarnings.join(' ')
    : 'پیش از اعمال، اعداد را با گزارش رسمی تطبیق دهید.';

  list.textContent = '';
  appendMonthlyDiagnostics(list, result, (message, isError) => setApplyStatus(root, message, isError));
  applyAll.hidden = !result.extractedValues.some(
    (value) =>
      value.confidence === 'high' &&
      suggestionTarget(value.kind) &&
      candidateApplyState(getRecord(), value, suggestionSourceKindFor(value, result.reportTitle), result.reportTitle) !==
        'exact-applied'
  );
  applyAll.onclick = async () => {
    const current = recordFromCurrentInputs(root, options.symbol, options.currentPriceSource, getRecord());
    const next = result.extractedValues
      .filter(
        (suggestion) =>
          suggestion.confidence === 'high' &&
          suggestionTarget(suggestion.kind) &&
          candidateApplyState(
            getRecord(),
            suggestion,
            suggestionSourceKindFor(suggestion, result.reportTitle),
            result.reportTitle
          ) !== 'exact-applied'
      )
      .reduce(
        (record, suggestion) =>
          applySuggestionToRecord(record, suggestion, {
            symbol: options.symbol,
            currentPriceSource: options.currentPriceSource,
            reportTitle: result.reportTitle,
            reportDate: result.reportPeriod,
            sourceKind: suggestionSourceKindFor(suggestion, result.reportTitle)
          }),
        current
      );

    try {
      const saved = await persistAppliedRecord(root, next);
      applyRecordInputsToForm(root, saved);
      setRecord(saved);
      updateResetCodalButton(root, saved);
      updateCompletionWorkflow(root, options, getRecord, setRecord, result, support);
      renderMonthlySuggestions(root, result, options, getRecord, setRecord, support);
      setApplyStatus(root, 'همه موارد قابل اعتماد با تأیید شما اعمال و ذخیره شد.');
    } catch (error) {
      setApplyStatus(
        root,
        applyFailureMessage(error),
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

  if (result.extractedValues.length > 0) {
    const title = document.createElement('h5');
    title.className = 'ibnav-subtitle';
    title.textContent = 'پیشنهادهای قابل اعمال';
    list.appendChild(title);
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
    const safetyWarnings = suggestionSafetyWarnings(value, result);
    const sourceKind = suggestionSourceKindFor(value, result.reportTitle);
    if (target && value.confidence !== 'low') {
      const state = candidateApplyState(getRecord(), value, sourceKind, result.reportTitle);
      if (state === 'exact-applied') {
        const applied = document.createElement('strong');
        applied.className = 'ibnav-status-badge';
        applied.textContent = 'اعمال‌شده';
        item.appendChild(applied);
      } else {
        if (state === 'other-suggestion-applied' || state === 'manual-present') {
          const note = document.createElement('small');
          note.className = 'ibnav-warning';
          note.textContent =
            state === 'other-suggestion-applied'
              ? 'کاندید دیگری برای این فیلد اعمال شده است؛ جایگزینی مقدار فعلی با این کاندید نیازمند تأیید شماست.'
              : 'برای این فیلد مقدار دستی ثبت شده است؛ اعمال این کاندید مقدار فعلی را جایگزین می‌کند.';
          item.appendChild(note);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ibnav-apply';
        button.textContent =
          state === 'empty'
            ? safetyWarnings.length > 0
              ? 'اعمال با هشدار'
              : 'اعمال مقدار پیشنهادی'
            : 'جایگزینی مقدار فعلی با این کاندید';
        button.addEventListener('click', async () => {
        const current = recordFromCurrentInputs(root, options.symbol, options.currentPriceSource, getRecord());
        const next = applySuggestionToRecord(current, value, {
          symbol: options.symbol,
          currentPriceSource: options.currentPriceSource,
          reportTitle: result.reportTitle,
          reportDate: result.reportPeriod,
          sourceKind
        });
        try {
          const saved = await persistAppliedRecord(root, next);
          applyRecordInputsToForm(root, saved);
          setRecord(saved);
          updateResetCodalButton(root, saved);
          updateCompletionWorkflow(root, options, getRecord, setRecord, result, support);
          renderMonthlySuggestions(root, result, options, getRecord, setRecord, support);
          setApplyStatus(root, appliedSuggestionMessage(target, sourceKind));
        } catch (error) {
          setApplyStatus(
            root,
            applyFailureMessage(error),
            true
          );
        }
        });
        item.appendChild(button);
      }
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
    for (const warningText of safetyWarnings) {
      const warning = document.createElement('small');
      warning.className = 'ibnav-warning';
      warning.textContent = warningText;
      item.appendChild(warning);
    }
    list.appendChild(item);
  }

  appendManualReviewMarketCandidates(list, result, root, options, getRecord, setRecord, support);
}

export async function renderNavWidget(options: NavWidgetOptions): Promise<HTMLElement> {
  const renderId = ++widgetRenderSequence;
  const mount = options.mount ?? document.body;
  ensureStyle();

  let initialStorageWarning: string | undefined;
  let activeRecord: ManualOverrideRecord | undefined;
  try {
    activeRecord = await getManualOverride(options.symbol);
  } catch (error) {
    initialStorageWarning = userFacingErrorMessage(error);
  }
  activeRecord = activeRecord ? normalizeManualOverrideRecord(activeRecord) : undefined;
  let latestParseResult: MonthlyActivityParseResult | undefined;
  let latestDiscoveryResult: CodalReportDiscoveryResult | undefined;
  let latestSupport: HoldingSupportClassification | undefined;
  const root = (document.getElementById(WIDGET_ROOT_ID) as HTMLElement | null) ?? document.createElement('section');
  let detailPipelineStatus: DetailPipelineStatus = 'not-started';
  let latestDetailStatusText: string | undefined;
  let parserStartedAt: string | undefined;
  let parserCompletedAt: string | undefined;
  let parserError: string | undefined;
  const setDetailPipelineStatus = (status: DetailPipelineStatus, options?: { detailText?: string; error?: string }): void => {
    detailPipelineStatus = status;
    latestDetailStatusText = options?.detailText ?? detailPipelineStatusText(status);
    parserError = options?.error;
    if (status === 'parsing' && !parserStartedAt) {
      parserStartedAt = new Date().toISOString();
    }
    if (status === 'completed' || status === 'failed' || status === 'stale-cache-used') {
      parserCompletedAt = new Date().toISOString();
    }
    updateDetailPipelineUi(root, status);
  };
  const inputs = activeRecord?.inputs ?? emptyNavInputs();
  inputs.currentPrice = inputs.currentPrice ?? options.currentPrice;

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
      <div data-ibnav-field-sources></div>
      <div class="ibnav-results" aria-live="polite">
        <div class="ibnav-row"><span>وضعیت محاسبه</span><strong class="ibnav-status-badge" data-ibnav-result="status">-</strong></div>
        <div class="ibnav-row"><span>NAV کل</span><strong data-ibnav-result="navTotal">-</strong></div>
        <div class="ibnav-row"><span>NAV هر سهم</span><strong data-ibnav-result="navPerShare">-</strong></div>
        <div class="ibnav-row"><span>P/NAV</span><strong data-ibnav-result="pToNav">-</strong></div>
        <div class="ibnav-row"><span>زمان داده</span><span data-ibnav-result="updatedAt">-</span></div>
        <p class="ibnav-warning" data-ibnav-result="warnings" hidden></p>
      </div>
      <section class="ibnav-completion" data-ibnav-completion aria-live="polite"></section>
      <button type="button" class="ibnav-save">ذخیره برای این نماد</button>
      <button type="button" class="ibnav-save ibnav-secondary" data-ibnav-reset-codal hidden>پاک کردن مقادیر پیشنهادی اعمال‌شده</button>
      <section class="ibnav-codal" aria-live="polite">
        <h3 class="ibnav-subtitle">گزارش‌های کدال</h3>
        <p class="ibnav-muted" data-ibnav-codal="status">ارتباط با کدال از پس‌زمینه افزونه انجام می‌شود</p>
        <button type="button" class="ibnav-save ibnav-secondary" data-ibnav-codal="retry" hidden>تلاش دوباره برای دریافت کدال</button>
        <div class="ibnav-row"><span>فعالیت ماهانه</span><span data-ibnav-codal="monthly">-</span></div>
        <a class="ibnav-link" data-ibnav-codal-link="monthly" target="_blank" rel="noreferrer" hidden>مشاهده گزارش فعالیت ماهانه</a>
        <div class="ibnav-row"><span>صورت مالی</span><span data-ibnav-codal="financial">-</span></div>
        <a class="ibnav-link" data-ibnav-codal-link="financial" target="_blank" rel="noreferrer" hidden>مشاهده صورت مالی</a>
        <div data-ibnav-codal="diagnostics"></div>
        <button type="button" class="ibnav-save ibnav-secondary" data-ibnav-codal-connection-copy>کپی وضعیت اتصال کدال</button>
        <button type="button" class="ibnav-save ibnav-secondary" data-ibnav-smoke-copy>کپی خلاصه Smoke Test</button>
        <p class="ibnav-muted" data-ibnav-smoke-readiness>Smoke هنوز آماده نیست؛ ابتدا دریافت و تحلیل جزئیات گزارش باید انجام شود.</p>
        <div class="ibnav-row"><span>جزئیات آخرین گزارش</span><span data-ibnav-codal-detail="status">در انتظار نتیجه جستجو</span></div>
        <div class="ibnav-row"><span>وضعیت تحلیل</span><span data-ibnav-codal-detail="pipeline">تحلیل گزارش هنوز شروع نشده است.</span></div>
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
  updateDetailPipelineUi(root, detailPipelineStatus);
  updateResetCodalButton(root, activeRecord);
  updateFieldSourceBadges(root, activeRecord);
  if (initialStorageWarning) {
    setApplyStatus(root, initialStorageWarning, true);
  }
  updateCompletionWorkflow(root, options, () => activeRecord, (record) => {
    activeRecord = record;
  }, latestParseResult, latestSupport);
  const codalSymbolValidation = validateCodalSearchSymbol(options.codalSymbol ?? options.symbol);
  const loadCodalDiscovery = async (): Promise<void> => {
    const renderCachedOrUnavailableParse = async (discovery: CodalReportDiscoveryResult, reason?: string): Promise<void> => {
      const cached = await getParsedCodalSummary(codalSymbolValidation.symbol ?? options.codalSymbol ?? options.symbol);
      latestParseResult = cached
        ? markParseResultStale(parseResultFromParsedCache(cached), cached.cachedAt)
        : createUnavailableNetworkParseResult({
            symbol: options.symbol,
            codalSymbol: options.codalSymbol,
            reportTitle: discovery.monthlyActivityReport?.title,
            warning: reason
          });
      setDetailPipelineStatus(cached ? 'stale-cache-used' : 'failed', {
        error: cached ? undefined : reason,
        detailText: cached
          ? 'داده زنده دریافت نشد؛ نتیجه ذخیره‌شده نمایش داده شده است.'
          : 'تحلیل گزارش ناموفق بود؛ جزئیات خطا را بررسی کنید.'
      });
      latestSupport = classifyHoldingSupport({
        instrumentName: options.instrumentName,
        discovery,
        parseResult: latestParseResult
      });
      renderMonthlySuggestions(root, latestParseResult, options, () => activeRecord, (record) => {
        activeRecord = record;
      }, latestSupport);
      updateCompletionWorkflow(root, options, () => activeRecord, (record) => {
        activeRecord = record;
      }, latestParseResult, latestSupport);
    };

    if (!codalSymbolValidation.valid || !codalSymbolValidation.symbol) {
      setDetailPipelineStatus('not-started');
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
      return;
    }

    try {
      const result = await requestCodalDiscovery(codalSymbolValidation.symbol, options.instrumentName);
      if (!isActiveWidgetRender(root, renderId)) return;
      latestDiscoveryResult = result;
      latestSupport = classifyHoldingSupport({ instrumentName: options.instrumentName, discovery: result });
      renderCodalDiscovery(root, result);
      const reports = [result.monthlyActivityReport, result.financialStatementReport].filter(
        (report): report is CodalReportReference => Boolean(report)
      );
      if (reports.length === 0) {
        setDetailPipelineStatus('completed', { detailText: 'گزارش قابل بررسی برای تحلیل پیدا نشد.' });
        renderCodalDetail(root, {
          status: result.status === 'network-error' || result.status === 'cors-blocked' || result.status === 'parse-error' ? 'network-error' : 'unavailable',
          errorMessage: result.errorMessage
        });
        if (parserDataStatusFor({ discovery: result }) === 'unavailable-network-error') {
          await renderCachedOrUnavailableParse(result);
        }
        updateCompletionWorkflow(root, options, () => activeRecord, (record) => {
          activeRecord = record;
        }, latestParseResult, latestSupport);
        return;
      }

      const parseResults: MonthlyActivityParseResult[] = [];
      let renderedDetail = false;
      setDetailPipelineStatus('fetching-detail');
      const uniqueReports = reports.filter(
        (report, index, all) =>
          all.findIndex((candidate) => (candidate.url ?? candidate.tracingNo ?? candidate.title) === (report.url ?? report.tracingNo ?? report.title)) === index
      );
      for (const report of uniqueReports) {
        try {
          const detailResult = await requestCodalReportDetail(report);
          if (!isActiveWidgetRender(root, renderId)) return;
          if (!renderedDetail) {
            renderCodalDetail(root, detailResult);
            renderedDetail = true;
          }
          if (detailResult.detail) {
            setDetailPipelineStatus('parsing', { detailText: 'در حال تحلیل جدول‌های گزارش...' });
            parseResults.push(
              report === result.financialStatementReport
                ? parseFinancialStatementReport(detailResult.detail)
                : parseMonthlyActivityReport(detailResult.detail)
            );
          }
        } catch (error) {
          if (!isActiveWidgetRender(root, renderId)) return;
          if (!renderedDetail) {
            const message = userFacingErrorMessage(error, 'خطای نامشخص در دریافت جزئیات کدال');
            renderCodalDetail(root, {
              status: 'network-error',
              errorMessage: message
            });
            setDetailPipelineStatus('failed', { error: message });
            renderedDetail = true;
          }
        }
      }

      if (parseResults.length > 0) {
        if (
          options.totalShares !== undefined &&
          options.totalShares > 0 &&
          !parseResults.some((parseResult) =>
            parseResult.extractedValues.some((value) => value.kind === 'totalSharesSuggestion')
          )
        ) {
          parseResults.push(tsetmcTotalSharesParseResult(options.totalShares, options));
        }
          const mergedResult = mergeMonthlyActivityParseResults(parseResults);
          latestParseResult = result.status === 'stale-cache' ? markParseResultStale(mergedResult, result.cachedAt) : mergedResult;
          setDetailPipelineStatus(result.status === 'stale-cache' ? 'stale-cache-used' : 'completed');
          if (result.status !== 'stale-cache') {
            await saveParsedCodalSummary({
              symbol: options.symbol,
              codalSymbol: codalSymbolValidation.symbol,
              discovery: result,
              parseResult: latestParseResult
            });
          }
          latestSupport = classifyHoldingSupport({
            instrumentName: options.instrumentName,
            discovery: result,
            parseResult: latestParseResult
          });
          renderMonthlySuggestions(root, latestParseResult, options, () => activeRecord, (record) => {
            activeRecord = record;
          }, latestSupport);
          updateCompletionWorkflow(root, options, () => activeRecord, (record) => {
            activeRecord = record;
          }, latestParseResult, latestSupport);
      } else if (parserDataStatusFor({ discovery: result }) === 'unavailable-network-error' || result.status === 'stale-cache') {
        await renderCachedOrUnavailableParse(result);
      } else {
        latestParseResult = createLiveNoCandidatesParseResult({
          symbol: options.symbol,
          codalSymbol: codalSymbolValidation.symbol,
          reportTitle: result.monthlyActivityReport?.title ?? result.financialStatementReport?.title,
          warning: 'گزارش‌های کدال دریافت شدند، اما جزئیات قابل استخراج برای کاندیدهای NAV پیدا نشد.'
        });
        setDetailPipelineStatus('completed', { detailText: 'تحلیل گزارش کامل شد؛ کاندید قابل اتکایی پیدا نشد.' });
        latestSupport = classifyHoldingSupport({
          instrumentName: options.instrumentName,
          discovery: result,
          parseResult: latestParseResult
        });
        renderMonthlySuggestions(root, latestParseResult, options, () => activeRecord, (record) => {
          activeRecord = record;
        }, latestSupport);
        updateCompletionWorkflow(root, options, () => activeRecord, (record) => {
          activeRecord = record;
        }, latestParseResult, latestSupport);
      }
    } catch (error: unknown) {
      if (!isActiveWidgetRender(root, renderId)) return;
      const message = userFacingErrorMessage(error, 'خطای نامشخص در دریافت کدال');
      setDetailPipelineStatus('failed', { error: message });
      renderCodalDiscovery(root, {
        status: 'network-error',
        symbol: options.symbol,
        errorMessage: message,
        sourceVerified: false,
        checkedAt: new Date().toISOString()
      });
      latestDiscoveryResult = {
        status: 'network-error',
        symbol: options.symbol,
        errorMessage: message,
        sourceVerified: false,
        checkedAt: new Date().toISOString()
      };
      renderCodalDetail(root, {
        status: 'network-error',
        errorMessage: message
      });
      await renderCachedOrUnavailableParse(latestDiscoveryResult, message);
    }
  };

  root.querySelector<HTMLButtonElement>('[data-ibnav-codal="retry"]')?.addEventListener('click', () => {
    void loadCodalDiscovery();
  });

  root.querySelector<HTMLButtonElement>('[data-ibnav-codal-connection-copy]')?.addEventListener('click', async () => {
    const payload = JSON.stringify(
      {
        domain: latestDiscoveryResult?.domain ?? latestDiscoveryResult?.diagnostics?.liveFetch?.domain ?? ['search', 'codal', 'ir'].join('.'),
        liveFetch: latestDiscoveryResult?.diagnostics?.liveFetch,
        usedCache: latestDiscoveryResult?.usedCache,
        cachedAt: latestDiscoveryResult?.cachedAt,
        attemptCount: latestDiscoveryResult?.attemptCount ?? latestDiscoveryResult?.diagnostics?.liveFetch?.attemptCount,
        parserDataStatus: parserDataStatusFor({ discovery: latestDiscoveryResult, parseResult: latestParseResult }),
        staleParsedCacheUsed: latestParseResult?.diagnostics.staleParsedCacheUsed ?? false,
        detailPipelineStatus,
        parserStartedAt,
        parserCompletedAt,
        parserError
      },
      null,
      2
    );
    const fallbackContainer =
      root.querySelector<HTMLElement>('[data-ibnav-codal="diagnostics"]') ??
      root.querySelector<HTMLElement>('[data-ibnav-completion]') ??
      root;
    const outcome = await copyTextWithFallback(payload, window.navigator.clipboard, (text) =>
      showManualCopyFallback(fallbackContainer, text)
    );
    setApplyStatus(root, outcome === 'copied' ? 'وضعیت اتصال کدال کپی شد.' : 'متن وضعیت اتصال برای کپی دستی نمایش داده شد.');
  });

  root.querySelector<HTMLButtonElement>('[data-ibnav-smoke-copy]')?.addEventListener('click', async () => {
    const currentRecord = recordFromCurrentInputs(root, options.symbol, options.currentPriceSource, activeRecord);
    const completion = buildNavCompletionSummary(currentRecord, latestParseResult, latestSupport);
    const payload = smokeSummaryText({
      symbol: options.symbol,
      instrumentName: options.instrumentName,
      insCode: options.insCode,
      codalSymbol: options.codalSymbol,
      currentPrice: currentRecord.inputs.currentPrice ?? options.currentPrice,
      currentPriceSource: currentRecord.currentPriceSource,
      record: currentRecord,
      discovery: latestDiscoveryResult,
      parseResult: latestParseResult,
      navCompletion: completion,
      support: latestSupport,
      detailPipelineStatus,
      detailStatusText: latestDetailStatusText,
      parserStartedAt,
      parserCompletedAt,
      parserError
    });
    const fallbackContainer =
      root.querySelector<HTMLElement>('[data-ibnav-codal="diagnostics"]') ??
      root.querySelector<HTMLElement>('[data-ibnav-completion]') ??
      root;
    const outcome = await copyTextWithFallback(payload, window.navigator.clipboard, (text) =>
      showManualCopyFallback(fallbackContainer, text)
    );
    setApplyStatus(
      root,
      outcome === 'copied'
        ? 'خلاصه Smoke Test کپی شد.'
        : 'کپی خودکار انجام نشد؛ خلاصه Smoke Test برای کپی دستی نمایش داده شد.',
      outcome !== 'copied'
    );
  });

  void loadCodalDiscovery();

  root.querySelectorAll<HTMLInputElement>('.ibnav-input').forEach((input) => {
    input.addEventListener('input', () => {
      input.dataset.ibnavTouched = 'true';
      const field = input.dataset.ibnavField as keyof NavInputs | undefined;
      const parsed = parseLocalizedNumber(input.value);
      if (
        field &&
        activeRecord &&
        isAppliedSuggestionSource(activeRecord?.fieldSources?.[field]?.source)
      ) {
        activeRecord = markFieldAsManual(activeRecord, field, parsed);
        updateResetCodalButton(root, activeRecord);
        updateFieldSourceBadges(root, activeRecord);
        setApplyStatus(root, 'ویرایش دستی ثبت شد؛ منبع این مقدار اکنون دستی است.');
      }
      updateResults(root, formatPersianTimestamp());
      updateCompletionWorkflow(root, options, () => activeRecord, (record) => {
        activeRecord = record;
      }, latestParseResult, latestSupport);
    });
  });

  root.querySelector<HTMLButtonElement>('.ibnav-collapse')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    root.classList.toggle('ibnav-collapsed');
    button.textContent = root.classList.contains('ibnav-collapsed') ? '+' : '−';
  });

  root.querySelector<HTMLButtonElement>('.ibnav-save')?.addEventListener('click', async () => {
    const record = manualRecordFromCurrentInputs(root, options.symbol, options.currentPriceSource, activeRecord);
    try {
      await saveManualOverride(record);
      activeRecord = record;
      updateResults(root, formatPersianTimestamp(new Date(record.updatedAt)));
      updateResetCodalButton(root, activeRecord);
      updateFieldSourceBadges(root, activeRecord);
      updateCompletionWorkflow(root, options, () => activeRecord, (nextRecord) => {
        activeRecord = nextRecord;
      }, latestParseResult, latestSupport);
      setApplyStatus(root, 'ورودی‌های دستی ذخیره شد.');
    } catch (error) {
      setApplyStatus(
        root,
        `ذخیره ورودی‌های دستی ناموفق بود: ${userFacingErrorMessage(error)}`,
        true
      );
    }
  });

  root.querySelector<HTMLButtonElement>('[data-ibnav-reset-codal]')?.addEventListener('click', async () => {
    const current = recordFromCurrentInputs(root, options.symbol, options.currentPriceSource, activeRecord);
    const next = resetCodalSuggestionFields(current);
    for (const field of inputFields) {
      const input = root.querySelector<HTMLInputElement>(`[data-ibnav-field="${field}"]`);
      const value = next.inputs[field];
      if (input) {
        input.value = value === undefined ? '' : String(value);
      }
    }
    try {
      await saveManualOverride(next);
      activeRecord = next;
      updateResults(root, formatPersianTimestamp(new Date(next.updatedAt)));
      updateResetCodalButton(root, activeRecord);
      updateFieldSourceBadges(root, activeRecord);
      updateCompletionWorkflow(root, options, () => activeRecord, (record) => {
        activeRecord = record;
      }, latestParseResult, latestSupport);
      if (latestParseResult) {
        renderMonthlySuggestions(root, latestParseResult, options, () => activeRecord, (record) => {
          activeRecord = record;
        }, latestSupport);
      }
      setApplyStatus(root, 'مقادیر پیشنهادی اعمال‌شده پاک شد؛ مقادیر دستی حفظ شد.');
    } catch (error) {
      setApplyStatus(
        root,
        `پاک کردن مقادیر پیشنهادی ناموفق بود: ${userFacingErrorMessage(error)}`,
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
