import type { NavInputs } from '../core/nav-calculator';
import type { CodalReportDiscoveryResult, CodalReportSelectionCandidate, CodalReportSelectionDiagnostics } from './codal-client';
import {
  isUnsafeEquitySuggestion,
  unsafeEquityColumnReason,
  type ExtractedPortfolioValue,
  type MonthlyActivityParseResult
} from './codal-monthly-parser';
import {
  candidateAvailabilityForSmoke,
  parsedCacheWarnings,
  parserDataStatusFor
} from './codal-parsed-cache';
import { manualReviewMarketValueSummary } from './market-value-review';
import type { ManualOverrideRecord, ManualValueSourceKind } from './manual-overrides';
import type { NavCompletionSummary } from './nav-completion';
import type { HoldingSupportClassification } from './symbol-classification';

export type SmokeReadiness = 'ready' | 'pending' | 'failed' | 'stale-cache' | 'no-report';
export type DetailPipelineStatus =
  | 'not-started'
  | 'fetching-detail'
  | 'parsing'
  | 'completed'
  | 'failed'
  | 'stale-cache-used';

export interface SmokeSummaryInput {
  symbol: string;
  instrumentName?: string;
  insCode?: string;
  codalSymbol?: string;
  currentPrice?: number;
  currentPriceSource: ManualOverrideRecord['currentPriceSource'];
  record?: ManualOverrideRecord;
  discovery?: CodalReportDiscoveryResult;
  parseResult?: MonthlyActivityParseResult;
  navCompletion?: NavCompletionSummary;
  support?: HoldingSupportClassification;
  detailPipelineStatus?: DetailPipelineStatus;
  detailStatusText?: string;
  parserStartedAt?: string;
  parserCompletedAt?: string;
  parserError?: string;
}

function normalizedSourceFor(
  record: ManualOverrideRecord | undefined,
  field: keyof NavInputs
): ManualValueSourceKind | undefined {
  const source = record?.fieldSources?.[field];
  if (
    field === 'totalShares' &&
    source?.source === 'codal-suggestion' &&
    /TSETMC/i.test(`${source.reportTitle ?? ''} ${source.rowLabel ?? ''} ${source.columnLabel ?? ''}`)
  ) {
    return 'tsetmc-suggestion';
  }
  return source?.source;
}

function compactCandidate(value: ExtractedPortfolioValue): Record<string, unknown> {
  return {
    kind: value.kind,
    value: value.value,
    rawValue: value.rawValue,
    rawText: value.rawText,
    confidence: value.confidence,
    unit: value.unit,
    unitMultiplier: value.unitMultiplier,
    tableIndex: value.sourceTableIndex,
    rowLabel: value.rowLabel,
    columnLabel: value.columnLabel,
    periodLabel: value.periodLabel,
    periodMatchStatus: value.periodMatchStatus,
    unitDetectionStatus: value.unitDetectionStatus,
    tableContextStatus: value.tableContextStatus,
    warnings: value.warning ? [value.warning] : [],
    confidenceReason: value.confidenceReason ?? value.reason
  };
}

function fetchCacheStatusFor(discovery: CodalReportDiscoveryResult | undefined): Record<string, unknown> {
  if (!discovery) {
    return { status: 'not-attempted' };
  }
  return {
    status: discovery.status,
    usedCache: discovery.usedCache ?? false,
    stale: discovery.stale ?? false,
    cachedAt: discovery.cachedAt,
    liveFetch: discovery.diagnostics?.liveFetch
  };
}

function normalizeIssuerToken(value: string | undefined): string {
  return (value ?? '')
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/\u200c/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function selectedCandidate(
  selection: CodalReportSelectionDiagnostics | undefined
): CodalReportSelectionCandidate | undefined {
  return selection?.candidates.find((candidate) => candidate.selected) ?? selection?.candidates[0];
}

function candidateMentionsOtherCompany(candidate: CodalReportSelectionCandidate | undefined): boolean {
  const text = [...(candidate?.rejectedReasons ?? []), ...(candidate?.warnings ?? [])].join(' ');
  return /پرانتز.*(?:دیگر|دیگری)|شرکت\/ناشر دیگر|ناشر دیگری|parentheses|another issuer|other company/i.test(text);
}

function financialIssuerMatchStatus(
  selection: CodalReportSelectionDiagnostics | undefined
):
  | 'exact-symbol'
  | 'strong-name'
  | 'weak-name'
  | 'subsidiary-or-other-company'
  | 'unknown' {
  const candidate = selectedCandidate(selection);
  if (!selection || !candidate) return 'unknown';
  if (candidateMentionsOtherCompany(candidate)) return 'subsidiary-or-other-company';
  if (!candidate.selected && (candidate.warnings.length > 0 || candidate.rejectedReasons.length > 0)) {
    return 'weak-name';
  }
  if (normalizeIssuerToken(candidate.report.symbol) === normalizeIssuerToken(selection.requestedSymbol)) {
    return 'exact-symbol';
  }
  if (candidate.reasons.some((reason) => /ناشر\/شرکت|strong issuer/i.test(reason))) {
    return 'strong-name';
  }
  if (candidate.warnings.length > 0 || candidate.rejectedReasons.length > 0) {
    return 'weak-name';
  }
  return 'unknown';
}

function financialRejectionReason(selection: CodalReportSelectionDiagnostics | undefined): string | undefined {
  const candidate = selectedCandidate(selection);
  return candidate ? [...candidate.rejectedReasons, ...candidate.warnings][0] : undefined;
}

function financialReportSummary(
  discovery: CodalReportDiscoveryResult | undefined
): Record<string, unknown> | undefined {
  const financial = discovery?.diagnostics?.financialStatement;
  const issuerMatchStatus = financialIssuerMatchStatus(financial);
  const rejectionReason = financialRejectionReason(financial);
  if (discovery?.financialStatementReport) {
    return {
      status: 'valid-issuer-financial-report',
      title: discovery.financialStatementReport.title,
      confidence: financial?.selectedConfidence,
      warnings: financial?.selectedWarnings ?? [],
      issuerMatchStatus,
      rejectionReason
    };
  }
  return {
    status: issuerMatchStatus === 'subsidiary-or-other-company' ? 'issuer-mismatch' : 'no-valid-issuer-financial-report',
    confidence: financial?.selectedConfidence,
    warnings: financial?.selectedWarnings ?? [],
    issuerMatchStatus,
    rejectionReason
  };
}

function financialEquityExtractionSummary(
  input: SmokeSummaryInput,
  financialReport: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const selected = input.parseResult?.extractedValues.find((value) => value.kind === 'equitySuggestion' && !isUnsafeEquitySuggestion(value));
  const unsafeSelected = input.parseResult?.extractedValues.find(isUnsafeEquitySuggestion);
  if (selected && !input.discovery?.financialStatementReport && !input.parseResult?.diagnostics.tables.some((table) => table.sourceGroup?.startsWith('financial'))) {
    return {
      status: 'ambiguous',
      reason: 'کاندید حقوق صاحبان سهام در کش ذخیره‌شده وجود دارد، اما تشخیص جدول مالی برای تأیید آن در Smoke موجود نیست.',
      reportTitle: input.parseResult?.diagnostics.reportTitle,
      reportPeriod: input.parseResult?.reportPeriod ?? input.parseResult?.diagnostics.reportDate,
      scannedTableCount: 0,
      candidateTableCount: 0,
      balanceSheetTableCandidates: [],
      rejectedRows: [],
      rejectedColumns: [],
      unitDetectionStatus: selected.unitDetectionStatus ?? 'unknown'
    };
  }
  const reportStatus = financialReport?.status;
  if (reportStatus && reportStatus !== 'valid-issuer-financial-report' && !unsafeSelected) {
    return {
      status: 'skipped-invalid-financial-report',
      reason: 'صورت مالی معتبر ناشر اصلی برای استخراج حقوق صاحبان سهام وجود ندارد.',
      reportTitle: input.discovery?.financialStatementReport?.title,
      scannedTableCount: 0,
      candidateTableCount: 0,
      balanceSheetTableCandidates: [],
      rejectedRows: [],
      rejectedColumns: [],
      unitDetectionStatus: 'unknown'
    };
  }
  if (!selected && !unsafeSelected && !input.discovery?.financialStatementReport && !input.parseResult?.diagnostics.tables.some((table) => table.sourceGroup?.startsWith('financial'))) {
    return undefined;
  }

  const financialTables = input.parseResult?.diagnostics.tables.filter((table) => table.sourceGroup?.startsWith('financial')) ?? [];
  const rejectedRows = financialTables
    .flatMap((table) =>
      (table.equityRowCandidates ?? [])
        .filter((row) => row.matchType.startsWith('rejected'))
        .map((row) => ({
          tableIndex: table.tableIndex,
          rowIndex: row.rowIndex,
          rowLabel: row.rowLabel,
          matchType: row.matchType
        }))
    )
    .slice(0, 12);
  const rejectedColumns = financialTables
    .flatMap((table) =>
      (table.equityColumnCandidates ?? [])
        .filter((column) => column.rejectionReason || column.periodMatchStatus !== 'exact-current-period' || column.unitDetectionStatus === 'unknown')
        .map((column) => ({
          tableIndex: table.tableIndex,
          columnIndex: column.columnIndex,
          columnLabel: column.columnLabel,
          periodMatchStatus: column.periodMatchStatus,
          unitDetectionStatus: column.unitDetectionStatus,
          reason: column.rejectionReason
        }))
    )
    .concat(
      unsafeSelected
        ? [
            {
              tableIndex: unsafeSelected.sourceTableIndex,
              columnIndex: unsafeSelected.sourceColumnIndex ?? -1,
              columnLabel: unsafeSelected.columnLabel,
              periodMatchStatus: unsafeSelected.periodMatchStatus ?? 'unknown',
              unitDetectionStatus: unsafeSelected.unitDetectionStatus ?? 'unknown',
              reason: unsafeEquityColumnReason(unsafeSelected.columnLabel)
            }
          ]
        : []
    )
    .slice(0, 12);
  const balanceSheetTableCandidates = financialTables
    .filter((table) => table.financialTableContext === 'balance-sheet-strong' || (table.equityRowCandidates?.length ?? 0) > 0)
    .slice(0, 8)
    .map((table) => ({
      tableIndex: table.tableIndex,
      caption: table.caption,
      sourceGroup: table.sourceGroup,
      financialTableContext: table.financialTableContext,
      matchedLabels: table.financialMatchedLabels ?? [],
      equityRowCandidateCount: table.equityRowCandidates?.length ?? 0
    }));
  const candidateTableCount = balanceSheetTableCandidates.length;
  const anyUnitDetected =
    selected?.unitDetectionStatus === 'detected' ||
    financialTables.some((table) => table.equityColumnCandidates?.some((column) => column.unitDetectionStatus === 'detected'));
  const canBeFound = Boolean(selected && financialTables.length > 0 && candidateTableCount > 0);
  const status = canBeFound ? 'found' : rejectedRows.length > 0 || rejectedColumns.length > 0 || candidateTableCount > 0 || unsafeSelected ? 'ambiguous' : 'not-found';
  const reason = selected
    ? canBeFound
      ? 'حقوق صاحبان سهام با قواعد محافظه‌کارانه به‌عنوان پیشنهاد استخراج شد.'
      : 'کاندید حقوق صاحبان سهام بدون تشخیص جدول مالی کافی قابل اتکا نیست.'
    : rejectedRows.length > 0 || rejectedColumns.length > 0 || candidateTableCount > 0
      ? 'چند ردیف یا ستون مرتبط دیده شد، اما ابهام ردیف/ستون/واحد مانع پیشنهاد قابل اتکا شد.'
      : 'صورت مالی معتبر پیدا شد، اما ردیف جمع حقوق صاحبان سهام/حقوق مالکانه با اطمینان کافی استخراج نشد.';

  return {
    status,
    reason,
    reportTitle: input.discovery?.financialStatementReport?.title ?? input.parseResult?.diagnostics.reportTitle,
    reportPeriod: input.parseResult?.reportPeriod ?? input.parseResult?.diagnostics.reportDate,
    scannedTableCount: financialTables.length,
    candidateTableCount,
    balanceSheetTableCandidates,
    rejectedRows,
    rejectedColumns,
    unitDetectionStatus: anyUnitDetected ? 'detected' : 'unknown',
    selectedCandidate: canBeFound && selected ? compactCandidate(selected) : undefined
  };
}

function smokeReadinessFor(input: SmokeSummaryInput, parserDataStatus: string): SmokeReadiness {
  if (input.detailPipelineStatus === 'stale-cache-used' || parserDataStatus === 'stale-cache') return 'stale-cache';
  if (input.discovery?.status === 'network-error' || input.discovery?.errorStatus === 'network-error') return 'failed';
  if (input.detailPipelineStatus === 'failed' || parserDataStatus === 'unavailable-network-error') return 'failed';
  if (input.parseResult || input.detailPipelineStatus === 'completed') return 'ready';
  if (input.detailPipelineStatus === 'fetching-detail' || input.detailPipelineStatus === 'parsing') return 'pending';
  if (input.discovery?.monthlyActivityReport || input.discovery?.financialStatementReport) return 'pending';
  return 'no-report';
}

function smokeReadinessWarning(readiness: SmokeReadiness): string | undefined {
  if (readiness === 'pending') {
    return 'تحلیل گزارش هنوز کامل نشده است؛ این Smoke Summary ممکن است ناقص باشد.';
  }
  if (readiness === 'failed') {
    return 'دریافت یا تحلیل جزئیات گزارش ناموفق بود؛ خطا و وضعیت اتصال را بررسی کنید.';
  }
  if (readiness === 'stale-cache') {
    return parsedCacheWarnings.stale;
  }
  if (readiness === 'no-report') {
    return 'گزارش قابل بررسی برای Smoke پیدا نشده یا جستجو هنوز انجام نشده است.';
  }
  return undefined;
}

export function createSmokeSummary(input: SmokeSummaryInput): Record<string, unknown> {
  const monthly = input.discovery?.diagnostics?.monthlyActivity;
  const financialReport = financialReportSummary(input.discovery);
  const parserDataStatus = parserDataStatusFor({ discovery: input.discovery, parseResult: input.parseResult });
  const smokeReadiness = smokeReadinessFor(input, parserDataStatus);
  const readinessWarning = smokeReadinessWarning(smokeReadiness);
  const detailPipelineStatus: DetailPipelineStatus =
    smokeReadiness === 'failed'
      ? 'failed'
      : smokeReadiness === 'stale-cache'
        ? 'stale-cache-used'
        : input.detailPipelineStatus ?? (input.parseResult ? 'completed' : 'not-started');
  const candidateAvailability = candidateAvailabilityForSmoke({
    discovery: input.discovery,
    parseResult: input.parseResult
  });
  const marketReview = input.parseResult ? manualReviewMarketValueSummary(input.parseResult) : undefined;
  const marketReviewRejectedCandidateCount =
    input.parseResult?.diagnostics.rejectedCandidates.filter(
      (item) => item.candidate?.kind === 'listedPortfolioMarketValue'
    ).length ?? 0;
  const marketReviewVisibleCandidateCount = marketReview?.visible.length ?? 0;
  const marketReviewHiddenCandidateCount = marketReview?.hiddenCandidates ?? 0;
  const marketReviewTotalCandidateCount = (marketReview?.totalCandidates ?? 0) + marketReviewRejectedCandidateCount;
  const userFacingWarnings = [
    ...(readinessWarning ? [readinessWarning] : []),
    ...(parserDataStatus === 'stale-cache' ? [parsedCacheWarnings.stale] : []),
    ...(parserDataStatus === 'unavailable-network-error' ? [parsedCacheWarnings.unavailableNetwork] : []),
    ...(input.parseResult?.warnings.slice(0, 8) ?? []),
    ...((input.support?.status === 'unsupported' || input.support?.status === 'unknown') &&
    !input.discovery?.financialStatementReport
      ? ['گزارش مالی معتبر ناشر اصلی برای NAV پیدا نشد.']
      : [])
  ].filter((warning, index, all) => all.indexOf(warning) === index);

  return {
    symbol: input.symbol,
    instrumentName: input.instrumentName,
    insCode: input.insCode,
    codalSymbol: input.codalSymbol,
    holdingSupport: input.support,
    currentPrice: input.currentPrice ?? input.record?.inputs.currentPrice,
    currentPriceSource: input.currentPriceSource,
    equity: input.record?.inputs.equity,
    equitySource: normalizedSourceFor(input.record, 'equity'),
    totalShares: input.record?.inputs.totalShares,
    totalSharesSource: normalizedSourceFor(input.record, 'totalShares'),
    codalDiscoveryStatus: input.discovery?.status,
    smokeReadiness,
    smokeReadinessWarning: readinessWarning,
    detailPipelineStatus,
    detailStatusText:
      smokeReadiness === 'failed'
        ? input.detailStatusText ?? 'تحلیل گزارش ناموفق بود؛ جزئیات خطا را بررسی کنید.'
        : input.detailStatusText,
    parserStartedAt: input.parserStartedAt,
    parserCompletedAt: input.parserCompletedAt,
    parserError: input.parserError,
    parserDataStatus,
    staleParsedCacheUsed: input.parseResult?.diagnostics.staleParsedCacheUsed ?? false,
    parsedCacheCachedAt: input.parseResult?.diagnostics.parsedCacheCachedAt,
    codalLiveFetchStatus: input.discovery?.diagnostics?.liveFetch?.status,
    codalLiveFetchError: input.discovery?.diagnostics?.liveFetch?.errorMessage ?? input.discovery?.errorMessage,
    candidateAvailability,
    fetchCacheStatus: fetchCacheStatusFor(input.discovery),
    monthlyReport: input.discovery?.monthlyActivityReport
      ? {
          title: input.discovery.monthlyActivityReport.title,
          confidence: monthly?.selectedConfidence,
          warnings: monthly?.selectedWarnings ?? []
        }
      : undefined,
    financialReport,
    financialEquityExtraction: financialEquityExtractionSummary(input, financialReport),
    parserStatus: input.parseResult?.status,
    marketValueStatus: input.parseResult?.diagnostics.sourceStrategy?.marketValueStatus,
    marketReviewCandidateCount: marketReviewVisibleCandidateCount,
    marketReviewVisibleCandidateCount,
    marketReviewHiddenCandidateCount,
    marketReviewRejectedCandidateCount,
    marketReviewTotalCandidateCount,
    extractedCandidates: input.parseResult?.extractedValues.filter((value) => !isUnsafeEquitySuggestion(value)).map(compactCandidate) ?? [],
    navCompletionStatus: input.navCompletion?.status,
    missingFields: input.navCompletion?.navTotalMissingFields ?? [],
    navShareMissingFields: input.navCompletion?.navShareMissingFields ?? [],
    userFacingWarnings
  };
}

export function smokeSummaryText(input: SmokeSummaryInput): string {
  return JSON.stringify(createSmokeSummary(input), null, 2);
}
