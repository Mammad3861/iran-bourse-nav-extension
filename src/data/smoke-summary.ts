import type { NavInputs } from '../core/nav-calculator';
import type { CodalReportDiscoveryResult, CodalReportSelectionCandidate, CodalReportSelectionDiagnostics } from './codal-client';
import type { ExtractedPortfolioValue, MonthlyActivityParseResult } from './codal-monthly-parser';
import {
  candidateAvailabilityForSmoke,
  parsedCacheWarnings,
  parserDataStatusFor
} from './codal-parsed-cache';
import { manualReviewMarketValueSummary } from './market-value-review';
import type { ManualOverrideRecord, ManualValueSourceKind } from './manual-overrides';
import type { NavCompletionSummary } from './nav-completion';
import type { HoldingSupportClassification } from './symbol-classification';

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

export function createSmokeSummary(input: SmokeSummaryInput): Record<string, unknown> {
  const monthly = input.discovery?.diagnostics?.monthlyActivity;
  const parserDataStatus = parserDataStatusFor({ discovery: input.discovery, parseResult: input.parseResult });
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
    financialReport: financialReportSummary(input.discovery),
    parserStatus: input.parseResult?.status,
    marketValueStatus: input.parseResult?.diagnostics.sourceStrategy?.marketValueStatus,
    marketReviewCandidateCount: marketReviewVisibleCandidateCount,
    marketReviewVisibleCandidateCount,
    marketReviewHiddenCandidateCount,
    marketReviewRejectedCandidateCount,
    marketReviewTotalCandidateCount,
    extractedCandidates: input.parseResult?.extractedValues.map(compactCandidate) ?? [],
    navCompletionStatus: input.navCompletion?.status,
    missingFields: input.navCompletion?.navTotalMissingFields ?? [],
    navShareMissingFields: input.navCompletion?.navShareMissingFields ?? [],
    userFacingWarnings: [
      ...(parserDataStatus === 'stale-cache' ? [parsedCacheWarnings.stale] : []),
      ...(parserDataStatus === 'unavailable-network-error' ? [parsedCacheWarnings.unavailableNetwork] : []),
      ...(input.parseResult?.warnings.slice(0, 8) ?? []),
      ...((input.support?.status === 'unsupported' || input.support?.status === 'unknown') &&
      !input.discovery?.financialStatementReport
        ? ['گزارش مالی معتبر ناشر اصلی برای NAV پیدا نشد.']
        : [])
    ]
  };
}

export function smokeSummaryText(input: SmokeSummaryInput): string {
  return JSON.stringify(createSmokeSummary(input), null, 2);
}
