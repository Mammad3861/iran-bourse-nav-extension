import type { ExtractedPortfolioValue, MonthlyActivityParseResult } from './codal-monthly-parser';

const totalRowPatterns = [
  /^جمع$/,
  /^جمع\s*کل$/,
  /^مجموع$/,
  /مانده\s*پایان\s*دوره/,
  /جمع\s*پرتفوی/,
  /جمع\s*سرمایه\s*گذاری/
];

const marketColumnPatterns = [
  /ارزش\s*بازار/,
  /ارزش\s*روز/,
  /ارزش\s*روز\s*بازار/,
  /مبلغ\s*بازار/
];

function normalizeText(value: string | undefined): string {
  return (value ?? '')
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrongTotalRow(label: string | undefined): boolean {
  const normalized = normalizeText(label);
  return totalRowPatterns.some((pattern) => pattern.test(normalized));
}

function isStrongMarketColumn(label: string | undefined): boolean {
  const normalized = normalizeText(label);
  return marketColumnPatterns.some((pattern) => pattern.test(normalized));
}

function isEligibleSource(result: MonthlyActivityParseResult, candidate: ExtractedPortfolioValue): boolean {
  const table = result.diagnostics.tables.find((item) => item.tableIndex === candidate.sourceTableIndex);
  return Boolean(table?.source === 'codal-excel' || table?.sourceGroup === 'monthly-excel' || table?.reconstruction);
}

function isTinyCandidate(candidate: ExtractedPortfolioValue): boolean {
  const raw = Math.abs(candidate.rawValue ?? candidate.value);
  return raw > 0 && raw < 10 && (candidate.unitMultiplier ?? 1) === 1;
}

export function manualReviewMarketValueCandidates(result: MonthlyActivityParseResult): ExtractedPortfolioValue[] {
  const candidates = [...result.secondarySuggestions, ...result.extractedValues].filter(
    (candidate) => candidate.kind === 'listedPortfolioMarketValue'
  );
  const hasCurrentPeriodCandidate = candidates.some((candidate) => candidate.period);
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = [
      candidate.value,
      candidate.rawText,
      candidate.sourceTableIndex,
      candidate.sourceRowIndex,
      candidate.sourceColumnIndex
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);

    if (candidate.value <= 0 || (candidate.rawValue ?? candidate.value) <= 0) return false;
    if (isTinyCandidate(candidate)) return false;
    if (!isStrongTotalRow(candidate.rowLabel)) return false;
    if (!isStrongMarketColumn(candidate.columnLabel)) return false;
    if (!isEligibleSource(result, candidate)) return false;
    if (hasCurrentPeriodCandidate && candidate.periodLabel && !candidate.period) return false;
    if ((candidate.rankingScore ?? 0) < 55) return false;
    return true;
  });
}
