import { analyzeNavCompleteness, calculateNav } from '../core/nav-calculator';
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
import {
  codalDiscoveryDiagnosticsJson,
  copyTextWithFallback,
  parserDiagnosticsJson,
  parserTablePreviewText
} from '../ui/parser-diagnostics';
import { compactParserWarnings, sourceStrategySummaryText } from '../ui/codal-display-utils';
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

function renderDiscoveryDiagnostics(result: CodalReportDiscoveryResult): void {
  const container = document.querySelector<HTMLElement>('[data-popup-codal="diagnostics"]');
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
    setText(
      '[data-popup-suggestions="warnings"]',
      outcome === 'copied'
        ? 'تشخیص انتخاب گزارش کپی شد.'
        : 'کپی خودکار انجام نشد؛ تشخیص انتخاب گزارش برای کپی دستی نمایش داده شد.'
    );
  });
  details.appendChild(copyButton);
  container.appendChild(details);
}

function renderCodalDiscovery(result: CodalReportDiscoveryResult): void {
  if (result.status === 'found') {
    setText(
      '[data-popup-codal="status"]',
      `ارتباط با کدال از پس‌زمینه افزونه انجام می‌شود؛ گزارش‌های مرتبط پیدا شد${
        discoverySelectionNotice(result) ? ` - ${discoverySelectionNotice(result)}` : ''
      }`
    );
  } else if (result.status === 'not-found') {
    setText(
      '[data-popup-codal="status"]',
      result.errorMessage ?? discoverySelectionNotice(result) ?? 'برای این نماد گزارش قابل اتکایی پیدا نشد'
    );
  } else {
    setText('[data-popup-codal="status"]', `خطا در دریافت کدال از پس‌زمینه افزونه: ${result.errorMessage ?? 'نامشخص'}`);
  }

  setText('[data-popup-codal="monthly"]', reportSummary(result.monthlyActivityReport));
  setText('[data-popup-codal="financial"]', reportSummary(result.financialStatementReport));
  updateReportLink('[data-popup-codal-link="monthly"]', result.monthlyActivityReport);
  updateReportLink('[data-popup-codal-link="financial"]', result.financialStatementReport);
  renderDiscoveryDiagnostics(result);
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
  const unit = value.unit ? `، واحد: ${value.unit}` : '';
  const scaled =
    value.unitMultiplier && value.unitMultiplier !== 1
      ? ` | خام: ${value.rawText} | مقدار مقیاس‌گذاری‌شده: ${formatNumberFa(value.value)}`
      : '';
  return `${value.label}: ${formatNumberFa(value.value)} (${confidence}، جدول ${value.sourceTableIndex}${unit}${scaled})`;
}

function showManualCopyFallback(container: HTMLElement, text: string): void {
  container.querySelector('[data-popup-copy-fallback]')?.remove();
  const wrapper = document.createElement('div');
  wrapper.className = 'ibnav-copy-fallback';
  wrapper.dataset.popupCopyFallback = 'true';
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

function appendMonthlyDiagnostics(list: HTMLElement, result: MonthlyActivityParseResult): void {
  const preview = document.createElement('div');
  preview.className = 'ibnav-diagnostics';
  const title = document.createElement('h5');
  title.className = 'ibnav-subtitle';
  title.textContent = 'نمایش جزئیات تشخیص Parser';
  preview.appendChild(title);

  if (result.diagnostics.sourceStrategy) {
    const sourceStrategy = document.createElement('p');
    sourceStrategy.className = 'ibnav-muted';
    sourceStrategy.textContent = [
      'منبع ارزش روز پرتفوی بورسی',
      `وضعیت: ${result.diagnostics.sourceStrategy.marketValueStatus === 'found' ? 'پیدا شد' : 'پیدا نشد'}`,
      `Excel: ${result.diagnostics.sourceStrategy.excel.status}`,
      ...result.diagnostics.sourceStrategy.messages
    ].join(' | ');
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
    setText(
      '[data-popup-suggestions="warnings"]',
      outcome === 'copied'
        ? 'تشخیص Parser کپی شد.'
        : 'کپی خودکار انجام نشد؛ متن تشخیص برای کپی دستی نمایش داده شد.'
    );
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
    setText(
      '[data-popup-suggestions="warnings"]',
      outcome === 'copied'
        ? 'پیش‌نمایش جدول‌ها کپی شد.'
        : 'کپی خودکار انجام نشد؛ پیش‌نمایش برای کپی دستی نمایش داده شد.'
    );
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
    meta.textContent = `واحد: ${table.detectedUnit ?? 'نامشخص'} | برچسب‌ها: ${
      table.detectedLabels.join('، ') || 'نامشخص'
    } | هشدار: ${table.warnings.join('، ') || '-'}`;
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

  const compactWarnings = compactParserWarnings(result.warnings);
  setText(
    '[data-popup-suggestions="warnings"]',
    compactWarnings.length ? compactWarnings.join(' ') : 'Ù¾ÛŒØ´ Ø§Ø² Ø§Ø¹Ù…Ø§Ù„ØŒ Ø§Ø¹Ø¯Ø§Ø¯ Ø±Ø§ Ø¨Ø§ Ú¯Ø²Ø§Ø±Ø´ Ø±Ø³Ù…ÛŒ ØªØ·Ø¨ÛŒÙ‚ Ø¯Ù‡ÛŒØ¯.'
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
    const completeness = analyzeNavCompleteness(record.inputs);
    setText('[data-popup-result="navTotal"]', completeness.navTotalAvailable ? formatNumberFa(result.navTotal) : 'محاسبه ناقص');
    setText('[data-popup-result="navPerShare"]', formatNumberFa(completeness.navTotalAvailable ? result.navPerShare : null, 2));
    setText('[data-popup-result="pToNav"]', formatPercentRatioFa(completeness.navTotalAvailable ? result.pToNav : null));
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
