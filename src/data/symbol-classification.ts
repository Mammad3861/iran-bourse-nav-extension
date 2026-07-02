import type { CodalReportDiscoveryResult } from './codal-client';
import type { MonthlyActivityParseResult } from './codal-monthly-parser';

export type HoldingSupportStatus = 'likely-holding' | 'unsupported' | 'unknown';

export interface HoldingSupportClassification {
  status: HoldingSupportStatus;
  message?: string;
  reasons: string[];
}

const unsupportedMessage =
  'این نماد احتمالاً برای محاسبه NAV هلدینگی پشتیبانی نمی‌شود یا داده کافی ندارد. محاسبه دستی همچنان ممکن است.';

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
const strongPortfolioValueKinds = new Set([
  'listedPortfolioCostValue',
  'listedPortfolioMarketValue',
  'unlistedPortfolioCostValue',
  'unlistedPortfolioEstimatedValue'
]);

function normalizeClassificationText(value: string | undefined): string {
  return (value ?? '')
    .replace(/[يى]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyHoldingSupport(input: {
  instrumentName?: string;
  discovery?: CodalReportDiscoveryResult;
  parseResult?: MonthlyActivityParseResult;
}): HoldingSupportClassification {
  const reasons: string[] = [];
  const name = normalizeClassificationText(input.instrumentName);
  if (holdingNamePatterns.some((pattern) => pattern.test(name))) {
    reasons.push('نام ابزار شبیه شرکت سرمایه‌گذاری/هلدینگ است.');
    return { status: 'likely-holding', reasons };
  }

  const monthlyTitle = normalizeClassificationText(
    input.discovery?.monthlyActivityReport?.title ?? input.parseResult?.reportTitle
  );
  if (portfolioReportPatterns.some((pattern) => pattern.test(monthlyTitle))) {
    reasons.push('گزارش پرتفوی مرتبط پیدا شد.');
    return { status: 'likely-holding', reasons };
  }

  const hasPortfolioValue = Boolean(
    input.parseResult?.extractedValues.some((value) => strongPortfolioValueKinds.has(value.kind)) ||
      input.parseResult?.secondarySuggestions.some((value) => value.kind === 'listedPortfolioMarketValue')
  );
  if (hasPortfolioValue) {
    reasons.push('کاندیدهای پرتفوی/سرمایه‌گذاری در Parser پیدا شد.');
    return { status: 'likely-holding', reasons };
  }

  const hasPortfolioTableSignal = Boolean(
    input.parseResult?.tableCandidates.some((candidate) =>
      candidate.matchedLabels.some((label) =>
        portfolioTablePatterns.some((pattern) => pattern.test(normalizeClassificationText(label)))
      )
    )
  );
  if (hasPortfolioTableSignal) {
    reasons.push('برچسب‌های جدول پرتفوی/سرمایه‌گذاری در Parser پیدا شد.');
    reasons.push('این برچسب‌ها بدون کاندید NAV قابل اتکا برای تشخیص هلدینگ بودن کافی نیستند.');
    return {
      status: 'unknown',
      message: unsupportedMessage,
      reasons
    };
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
      message: unsupportedMessage,
      reasons
    };
  }

  reasons.push('برای تشخیص نوع نماد داده کافی وجود ندارد.');
  return {
    status: 'unknown',
    message: unsupportedMessage,
    reasons
  };
}
