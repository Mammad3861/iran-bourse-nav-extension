import type { NavInputs } from '../core/nav-calculator';
import type { CodalReportDiscoveryResult } from './codal-client';
import type { ExtractedPortfolioValue, MonthlyActivityParseResult } from './codal-monthly-parser';
import type { ManualOverrideRecord } from './manual-overrides';
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

function sourceFor(record: ManualOverrideRecord | undefined, field: keyof NavInputs): string | undefined {
  return record?.fieldSources?.[field]?.source;
}

function compactCandidate(value: ExtractedPortfolioValue): Record<string, unknown> {
  return {
    kind: value.kind,
    value: value.value,
    confidence: value.confidence,
    unit: value.unit,
    tableIndex: value.sourceTableIndex,
    rowLabel: value.rowLabel,
    columnLabel: value.columnLabel
  };
}

export function createSmokeSummary(input: SmokeSummaryInput): Record<string, unknown> {
  const monthly = input.discovery?.diagnostics?.monthlyActivity;
  const financial = input.discovery?.diagnostics?.financialStatement;
  const marketReviewCandidateCount =
    input.parseResult?.secondarySuggestions.filter((value) => value.kind === 'listedPortfolioMarketValue').length ?? 0;
  return {
    symbol: input.symbol,
    instrumentName: input.instrumentName,
    insCode: input.insCode,
    codalSymbol: input.codalSymbol,
    holdingSupport: input.support,
    currentPrice: input.currentPrice ?? input.record?.inputs.currentPrice,
    currentPriceSource: input.currentPriceSource,
    totalShares: input.record?.inputs.totalShares,
    totalSharesSource: sourceFor(input.record, 'totalShares'),
    codalDiscoveryStatus: input.discovery?.status,
    fetchCacheStatus: {
      usedCache: input.discovery?.usedCache,
      stale: input.discovery?.stale,
      cachedAt: input.discovery?.cachedAt,
      liveFetch: input.discovery?.diagnostics?.liveFetch
    },
    monthlyReport: input.discovery?.monthlyActivityReport
      ? {
          title: input.discovery.monthlyActivityReport.title,
          confidence: monthly?.selectedConfidence,
          warnings: monthly?.selectedWarnings ?? []
        }
      : undefined,
    financialReport: input.discovery?.financialStatementReport
      ? {
          title: input.discovery.financialStatementReport.title,
          confidence: financial?.selectedConfidence,
          warnings: financial?.selectedWarnings ?? []
        }
      : {
          status: financial?.selectedConfidence === 'none' ? 'no-valid-issuer-financial-report' : input.discovery?.status,
          confidence: financial?.selectedConfidence,
          warnings: financial?.selectedWarnings ?? []
        },
    parserStatus: input.parseResult?.status,
    marketValueStatus: input.parseResult?.diagnostics.sourceStrategy?.marketValueStatus,
    marketReviewCandidateCount,
    extractedCandidates: input.parseResult?.extractedValues.map(compactCandidate) ?? [],
    navCompletionStatus: input.navCompletion?.status,
    missingFields: input.navCompletion?.navTotalMissingFields ?? [],
    navShareMissingFields: input.navCompletion?.navShareMissingFields ?? [],
    userFacingWarnings: input.parseResult?.warnings.slice(0, 8) ?? []
  };
}

export function smokeSummaryText(input: SmokeSummaryInput): string {
  return JSON.stringify(createSmokeSummary(input), null, 2);
}
