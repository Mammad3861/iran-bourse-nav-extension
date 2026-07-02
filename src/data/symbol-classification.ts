import type { CodalReportDiscoveryResult } from './codal-client';
import type { MonthlyActivityParseResult } from './codal-monthly-parser';

export type HoldingSupportStatus = 'likely-holding' | 'unsupported' | 'unknown';

export interface HoldingSupportClassification {
  status: HoldingSupportStatus;
  message?: string;
  reasons: string[];
}

const holdingNamePatterns = [
  /سرمایه\s*گذاری/,
  /سرمایه‌گذاری/,
  /هلدینگ/,
  /گروه\s*مدیریت\s*سرمایه/,
  /تامین\s*اجتماعی/,
  /تأمین\s*اجتماعی/,
  /شستا/
];

const portfolioReportPatterns = [/صورت\s*وضعیت\s*پرتفوی/, /وضعیت\s*پورتفوی/, /پرتفوی/, /پورتفوی/];
const portfolioTablePatterns = [/سرمایه\s*گذاری/, /سرمایه‌گذاری/, /پرتفوی/, /پورتفوی/];

export function classifyHoldingSupport(input: {
  instrumentName?: string;
  discovery?: CodalReportDiscoveryResult;
  parseResult?: MonthlyActivityParseResult;
}): HoldingSupportClassification {
  const reasons: string[] = [];
  const name = input.instrumentName ?? '';
  if (holdingNamePatterns.some((pattern) => pattern.test(name))) {
    reasons.push('نام ابزار شبیه شرکت سرمایه‌گذاری/هلدینگ است.');
    return { status: 'likely-holding', reasons };
  }

  const monthlyTitle = input.discovery?.monthlyActivityReport?.title ?? input.parseResult?.reportTitle ?? '';
  if (portfolioReportPatterns.some((pattern) => pattern.test(monthlyTitle))) {
    reasons.push('گزارش پرتفوی مرتبط پیدا شد.');
    return { status: 'likely-holding', reasons };
  }

  const hasPortfolioValue = Boolean(
    input.parseResult?.extractedValues.some((value) =>
      ['listedPortfolioCostValue', 'listedPortfolioMarketValue', 'unlistedPortfolioCostValue', 'unlistedPortfolioEstimatedValue'].includes(
        value.kind
      )
    ) ||
      input.parseResult?.secondarySuggestions.some((value) => value.kind === 'listedPortfolioMarketValue')
  );
  if (hasPortfolioValue) {
    reasons.push('کاندیدهای پرتفوی/سرمایه‌گذاری در Parser پیدا شد.');
    return { status: 'likely-holding', reasons };
  }

  const hasPortfolioTableSignal = Boolean(
    input.parseResult?.tableCandidates.some((candidate) =>
      candidate.matchedLabels.some((label) => portfolioTablePatterns.some((pattern) => pattern.test(label)))
    )
  );
  if (hasPortfolioTableSignal) {
    reasons.push('برچسب‌های جدول پرتفوی/سرمایه‌گذاری در Parser پیدا شد.');
    return { status: 'likely-holding', reasons };
  }

  const discoveryFinished = input.discovery?.status === 'found' || input.discovery?.status === 'not-found';
  const parseUnsupported =
    input.parseResult?.status === 'unsupported-report' ||
    input.parseResult?.status === 'no-candidate-table' ||
    input.parseResult?.status === 'empty';
  if ((discoveryFinished && !input.discovery?.monthlyActivityReport) || parseUnsupported) {
    reasons.push('گزارش یا جدول پرتفوی/سرمایه‌گذاری قابل اتکا پیدا نشد.');
    return {
      status: 'unsupported',
      message: 'این نماد احتمالاً هلدینگ/سرمایه‌گذاری نیست یا داده کافی برای NAV هلدینگی پیدا نشد.',
      reasons
    };
  }

  reasons.push('برای تشخیص نوع نماد داده کافی وجود ندارد.');
  return {
    status: 'unknown',
    message: 'داده کافی برای محاسبه NAV هلدینگی پیدا نشد.',
    reasons
  };
}
