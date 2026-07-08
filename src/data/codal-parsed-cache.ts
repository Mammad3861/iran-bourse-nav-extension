import { getLocalValue, setLocalValue } from './cache-store';
import type { CodalReportDiscoveryResult, CodalReportReference } from './codal-client';
import type {
  ExtractedPortfolioValue,
  MonthlyActivityParseResult,
  ParserRejectedCandidate
} from './codal-monthly-parser';
import { isUnsafeEquitySuggestion } from './codal-monthly-parser';
import { manualReviewMarketValueSummary } from './market-value-review';

export type ParserDataStatus = 'live' | 'stale-cache' | 'unavailable-network-error' | 'not-attempted';
export type CandidateAvailability =
  | 'live-nav-candidates'
  | 'live-basic-candidates-only'
  | 'no-nav-candidates-live'
  | 'stale-candidates'
  | 'unavailable-network-error'
  | 'not-attempted';

export interface ParsedCodalCacheRecord {
  symbol: string;
  codalSymbol?: string;
  monthlyReport?: Pick<CodalReportReference, 'symbol' | 'title' | 'publishedAt' | 'tracingNo' | 'reportId' | 'url'>;
  financialReport?: Pick<CodalReportReference, 'symbol' | 'title' | 'publishedAt' | 'tracingNo' | 'reportId' | 'url'>;
  parserStatus: MonthlyActivityParseResult['status'];
  marketValueStatus?: string;
  marketReviewCandidateCount: number;
  marketReviewVisibleCandidateCount: number;
  marketReviewHiddenCandidateCount: number;
  extractedCandidates: ExtractedPortfolioValue[];
  primarySuggestions: ExtractedPortfolioValue[];
  secondarySuggestions: ExtractedPortfolioValue[];
  rejectedCandidates: ParserRejectedCandidate[];
  userFacingWarnings: string[];
  sourceReportUrl?: string;
  reportTitle?: string;
  reportPeriod?: string;
  parsedAt: string;
  cachedAt: string;
}

const STALE_PARSED_WARNING =
  'داده کدال زنده دریافت نشد؛ آخرین نتیجه ذخیره‌شده نمایش داده شده است.';
const UNAVAILABLE_NETWORK_WARNING =
  'کدال در حال حاضر قابل دریافت نیست؛ محاسبه دستی همچنان قابل استفاده است. به دلیل خطای اتصال، کاندیدهای کدال بررسی نشدند.';

function parsedCacheKey(symbol: string): string {
  return `codal-parsed-summary:${symbol.trim()}`;
}

function reportSummary(
  report: CodalReportReference | undefined
): ParsedCodalCacheRecord['monthlyReport'] | undefined {
  if (!report) return undefined;
  return {
    symbol: report.symbol,
    title: report.title,
    publishedAt: report.publishedAt,
    tracingNo: report.tracingNo,
    reportId: report.reportId,
    url: report.url
  };
}

function compactValue(value: ExtractedPortfolioValue): ExtractedPortfolioValue {
  return {
    kind: value.kind,
    label: value.label,
    value: value.value,
    scaledValue: value.scaledValue,
    rawText: value.rawText,
    rawValue: value.rawValue,
    period: value.period,
    periodLabel: value.periodLabel,
    unit: value.unit,
    unitMultiplier: value.unitMultiplier,
    confidence: value.confidence,
    sourceTableIndex: value.sourceTableIndex,
    sourceRowIndex: value.sourceRowIndex,
    sourceColumnIndex: value.sourceColumnIndex,
    sourceTableCaption: value.sourceTableCaption,
    rowLabel: value.rowLabel,
    columnLabel: value.columnLabel,
    periodMatchStatus: value.periodMatchStatus,
    unitDetectionStatus: value.unitDetectionStatus,
    tableContextStatus: value.tableContextStatus,
    confidenceReason: value.confidenceReason,
    rankingScore: value.rankingScore,
    reason: value.reason,
    warning: value.warning
  };
}

function compactRejectedCandidate(candidate: ParserRejectedCandidate): ParserRejectedCandidate {
  return {
    tableIndex: candidate.tableIndex,
    reason: candidate.reason,
    candidate: candidate.candidate ? compactValue(candidate.candidate) : undefined
  };
}

function safeValues(values: ExtractedPortfolioValue[]): ExtractedPortfolioValue[] {
  return values.filter((value) => !isUnsafeEquitySuggestion(value));
}

function candidateAvailabilityFor(
  result: MonthlyActivityParseResult,
  parserDataStatus: ParserDataStatus
): CandidateAvailability {
  const review = manualReviewMarketValueSummary(result);
  const safeExtractedValues = safeValues(result.extractedValues);
  const safePrimarySuggestions = safeValues(result.primarySuggestions);
  const safeSecondarySuggestions = safeValues(result.secondarySuggestions);
  const allKinds = [
    ...safeExtractedValues.map((value) => value.kind),
    ...safePrimarySuggestions.map((value) => value.kind),
    ...safeSecondarySuggestions.map((value) => value.kind)
  ];
  const hasNavCandidates =
    review.totalCandidates > 0 ||
    allKinds.some((kind) =>
      [
        'equitySuggestion',
        'listedPortfolioCostValue',
        'listedPortfolioMarketValue',
        'unlistedPortfolioCostValue',
        'unlistedPortfolioEstimatedValue',
        'unlistedPortfolioSurplusSuggestion'
      ].includes(kind)
    );
  const hasBasicCandidates = allKinds.some((kind) => kind === 'totalSharesSuggestion');
  if (parserDataStatus === 'not-attempted') return 'not-attempted';
  if (parserDataStatus === 'unavailable-network-error') return 'unavailable-network-error';
  if (parserDataStatus === 'stale-cache') return hasNavCandidates || hasBasicCandidates ? 'stale-candidates' : 'unavailable-network-error';
  if (hasNavCandidates) return 'live-nav-candidates';
  if (hasBasicCandidates) return 'live-basic-candidates-only';
  return 'no-nav-candidates-live';
}

export function markParseResultStale(result: MonthlyActivityParseResult, cachedAt?: string): MonthlyActivityParseResult {
  const staleWarning = cachedAt ? `${STALE_PARSED_WARNING} زمان ذخیره: ${cachedAt}.` : STALE_PARSED_WARNING;
  const markValue = (value: ExtractedPortfolioValue): ExtractedPortfolioValue => ({
    ...value,
    confidence: value.confidence === 'high' ? 'medium' : value.confidence,
    warning: value.warning ? `${value.warning} ${staleWarning}` : staleWarning
  });
  const next: MonthlyActivityParseResult = {
    ...result,
    status: result.status === 'parsed' ? 'ambiguous' : result.status,
    extractedValues: result.extractedValues.map(markValue),
    primarySuggestions: result.primarySuggestions.map(markValue),
    secondarySuggestions: result.secondarySuggestions.map(markValue),
    warnings: [...new Set([staleWarning, ...result.warnings])],
    diagnostics: {
      ...result.diagnostics,
      parserStatus: result.status === 'parsed' ? 'ambiguous' : result.status,
      parserDataStatus: 'stale-cache',
      staleParsedCacheUsed: true,
      parsedCacheCachedAt: cachedAt,
      parserWarnings: [...new Set([staleWarning, ...result.diagnostics.parserWarnings])],
      extractedCandidates: result.diagnostics.extractedCandidates.map(markValue)
    }
  };
  return {
    ...next,
    diagnostics: {
      ...next.diagnostics,
      candidateAvailability: candidateAvailabilityFor(next, 'stale-cache')
    }
  };
}

export function createUnavailableNetworkParseResult(input: {
  symbol: string;
  codalSymbol?: string;
  reportTitle?: string;
  warning?: string;
}): MonthlyActivityParseResult {
  const warning = input.warning ?? UNAVAILABLE_NETWORK_WARNING;
  return {
    status: 'empty',
    reportTitle: input.reportTitle,
    tableCandidates: [],
    extractedValues: [],
    primarySuggestions: [],
    secondarySuggestions: [],
    tablePreviews: [],
    diagnostics: {
      symbol: input.symbol,
      codalSymbol: input.codalSymbol,
      reportTitle: input.reportTitle,
      detectedTableCount: 0,
      parserStatus: 'empty',
      parserDataStatus: 'unavailable-network-error',
      staleParsedCacheUsed: false,
      candidateAvailability: 'unavailable-network-error',
      parserWarnings: [warning],
      extractedCandidates: [],
      rejectedCandidates: [],
      tables: []
    },
    warnings: [warning],
    parsedAt: new Date().toISOString()
  };
}

export function createLiveNoCandidatesParseResult(input: {
  symbol: string;
  codalSymbol?: string;
  reportTitle?: string;
  warning?: string;
}): MonthlyActivityParseResult {
  const warning = input.warning ?? 'جزئیات گزارش بررسی شد، اما کاندید قابل اتکایی برای NAV پیدا نشد.';
  return {
    status: 'empty',
    reportTitle: input.reportTitle,
    tableCandidates: [],
    extractedValues: [],
    primarySuggestions: [],
    secondarySuggestions: [],
    tablePreviews: [],
    diagnostics: {
      symbol: input.symbol,
      codalSymbol: input.codalSymbol,
      reportTitle: input.reportTitle,
      detectedTableCount: 0,
      parserStatus: 'empty',
      parserDataStatus: 'live',
      staleParsedCacheUsed: false,
      candidateAvailability: 'no-nav-candidates-live',
      parserWarnings: [warning],
      extractedCandidates: [],
      rejectedCandidates: [],
      tables: []
    },
    warnings: [warning],
    parsedAt: new Date().toISOString()
  };
}

export function compactParsedCodalSummary(input: {
  symbol: string;
  codalSymbol?: string;
  discovery?: CodalReportDiscoveryResult;
  parseResult: MonthlyActivityParseResult;
}): ParsedCodalCacheRecord {
  const review = manualReviewMarketValueSummary(input.parseResult);
  const marketRejected = input.parseResult.diagnostics.rejectedCandidates.filter(
    (candidate) => candidate.candidate?.kind === 'listedPortfolioMarketValue'
  );
  return {
    symbol: input.symbol,
    codalSymbol: input.codalSymbol,
    monthlyReport: reportSummary(input.discovery?.monthlyActivityReport),
    financialReport: reportSummary(input.discovery?.financialStatementReport),
    parserStatus: input.parseResult.status,
    marketValueStatus: input.parseResult.diagnostics.sourceStrategy?.marketValueStatus,
    marketReviewCandidateCount: review.totalCandidates,
    marketReviewVisibleCandidateCount: review.visible.length,
    marketReviewHiddenCandidateCount: review.hiddenCandidates,
    extractedCandidates: safeValues(input.parseResult.extractedValues).map(compactValue),
    primarySuggestions: safeValues(input.parseResult.primarySuggestions).map(compactValue),
    secondarySuggestions: safeValues(input.parseResult.secondarySuggestions).map(compactValue),
    rejectedCandidates: marketRejected.map(compactRejectedCandidate),
    userFacingWarnings: input.parseResult.warnings.slice(0, 8),
    sourceReportUrl: input.parseResult.sourceReportUrl,
    reportTitle: input.parseResult.reportTitle,
    reportPeriod: input.parseResult.reportPeriod,
    parsedAt: input.parseResult.parsedAt,
    cachedAt: new Date().toISOString()
  };
}

export function parseResultFromParsedCache(record: ParsedCodalCacheRecord): MonthlyActivityParseResult {
  const result: MonthlyActivityParseResult = {
    status: record.parserStatus,
    reportTitle: record.reportTitle ?? record.monthlyReport?.title,
    reportPeriod: record.reportPeriod,
    sourceReportUrl: record.sourceReportUrl ?? record.monthlyReport?.url,
    tableCandidates: [],
    extractedValues: safeValues(record.extractedCandidates),
    primarySuggestions: safeValues(record.primarySuggestions),
    secondarySuggestions: safeValues(record.secondarySuggestions),
    tablePreviews: [],
    diagnostics: {
      symbol: record.symbol,
      codalSymbol: record.codalSymbol,
      reportTitle: record.reportTitle ?? record.monthlyReport?.title,
      reportDate: record.monthlyReport?.publishedAt,
      reportUrl: record.sourceReportUrl ?? record.monthlyReport?.url,
      tracingNo: record.monthlyReport?.tracingNo,
      reportId: record.monthlyReport?.reportId,
      detectedTableCount: 0,
      parserStatus: record.parserStatus,
      parserDataStatus: 'live',
      parserWarnings: record.userFacingWarnings,
      extractedCandidates: safeValues(record.extractedCandidates),
      rejectedCandidates: record.rejectedCandidates,
      tables: [],
      sourceStrategy: record.marketValueStatus
        ? {
            htmlDetailChecked: true,
            reconstructedTableChecked: true,
            excel: { status: 'not-requested', tableCount: 0 },
            alternativeReportsChecked: false,
            marketValueStatus: record.marketValueStatus as never,
            messages: record.userFacingWarnings
          }
        : undefined
    },
    warnings: record.userFacingWarnings,
    parsedAt: record.parsedAt
  };
  return {
    ...result,
    diagnostics: {
      ...result.diagnostics,
      candidateAvailability: candidateAvailabilityFor(result, 'live')
    }
  };
}

export async function saveParsedCodalSummary(input: {
  symbol: string;
  codalSymbol?: string;
  discovery?: CodalReportDiscoveryResult;
  parseResult: MonthlyActivityParseResult;
}): Promise<ParsedCodalCacheRecord> {
  const record = compactParsedCodalSummary(input);
  await setLocalValue(parsedCacheKey(input.codalSymbol ?? input.symbol), record);
  if (input.codalSymbol && input.codalSymbol !== input.symbol) {
    await setLocalValue(parsedCacheKey(input.symbol), record);
  }
  return record;
}

export async function getParsedCodalSummary(symbol: string | undefined): Promise<ParsedCodalCacheRecord | undefined> {
  return symbol ? getLocalValue<ParsedCodalCacheRecord>(parsedCacheKey(symbol)) : undefined;
}

export function parserDataStatusFor(input: {
  discovery?: CodalReportDiscoveryResult;
  parseResult?: MonthlyActivityParseResult;
}): ParserDataStatus {
  if (input.parseResult?.diagnostics.parserDataStatus) {
    return input.parseResult.diagnostics.parserDataStatus;
  }
  if (input.parseResult) {
    return input.discovery?.status === 'stale-cache' ? 'stale-cache' : 'live';
  }
  const liveStatus = input.discovery?.diagnostics?.liveFetch?.status ?? input.discovery?.errorStatus ?? input.discovery?.status;
  if (['network-error', 'cors-blocked', 'unavailable', 'parse-error', 'failed'].includes(liveStatus ?? '')) {
    return 'unavailable-network-error';
  }
  return 'not-attempted';
}

export function candidateAvailabilityForSmoke(input: {
  discovery?: CodalReportDiscoveryResult;
  parseResult?: MonthlyActivityParseResult;
}): CandidateAvailability | undefined {
  const status = parserDataStatusFor(input);
  if (!input.parseResult) {
    if (status === 'unavailable-network-error') return 'unavailable-network-error';
    return status === 'not-attempted' ? 'not-attempted' : 'no-nav-candidates-live';
  }
  return candidateAvailabilityFor(input.parseResult, status);
}

export const parsedCacheWarnings = {
  stale: STALE_PARSED_WARNING,
  unavailableNetwork: UNAVAILABLE_NETWORK_WARNING
} as const;
