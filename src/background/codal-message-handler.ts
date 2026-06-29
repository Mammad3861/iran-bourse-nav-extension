import {
  discoverLatestCodalReports,
  getLatestFinancialStatement,
  getLatestMonthlyActivityReport,
  getReportDetail,
  searchReportsBySymbol
} from '../data/codal-client';
import {
  isCodalRuntimeMessage,
  type CodalRuntimeMessage,
  type CodalRuntimeResponse
} from '../data/codal-messages';
import { validateCodalSearchSymbol } from '../data/codal-symbol-validation';

export interface CodalMessageHandlerDependencies {
  searchReportsBySymbol: typeof searchReportsBySymbol;
  getLatestMonthlyActivityReport: typeof getLatestMonthlyActivityReport;
  getLatestFinancialStatement: typeof getLatestFinancialStatement;
  discoverLatestCodalReports: typeof discoverLatestCodalReports;
  getReportDetail: typeof getReportDetail;
}

const defaultDependencies: CodalMessageHandlerDependencies = {
  searchReportsBySymbol,
  getLatestMonthlyActivityReport,
  getLatestFinancialStatement,
  discoverLatestCodalReports,
  getReportDetail
};

const inFlightRequests = new Map<string, Promise<CodalRuntimeResponse>>();

function invalidSymbolResponse(symbol: string): CodalRuntimeResponse<'CODAL_DISCOVER_LATEST_REPORTS'> {
  return {
    ok: true,
    data: {
      status: 'not-found',
      symbol,
      errorMessage: 'نماد معتبر تشخیص داده نشد؛ جستجوی کدال انجام نشد',
      sourceVerified: false,
      checkedAt: new Date().toISOString()
    }
  };
}

function invalidSymbolError(): CodalRuntimeResponse {
  return {
    ok: false,
    errorMessage: 'نماد معتبر تشخیص داده نشد؛ جستجوی کدال انجام نشد'
  };
}

function requestKey(message: CodalRuntimeMessage): string {
  if ('symbol' in message) {
    return `${message.type}:${message.symbol}:${'issuerName' in message ? (message.issuerName ?? '') : ''}`;
  }

  return `${message.type}:${message.report.url ?? message.report.tracingNo ?? message.report.reportId ?? message.report.title}`;
}

async function runRequest(
  message: CodalRuntimeMessage,
  dependencies: CodalMessageHandlerDependencies
): Promise<CodalRuntimeResponse> {
  try {
    if ('symbol' in message) {
      const validation = validateCodalSearchSymbol(message.symbol);
      if (!validation.valid || !validation.symbol) {
        return message.type === 'CODAL_DISCOVER_LATEST_REPORTS'
          ? invalidSymbolResponse(message.symbol)
          : invalidSymbolError();
      }

      if (message.type === 'CODAL_SEARCH_REPORTS') {
        return { ok: true, data: await dependencies.searchReportsBySymbol(validation.symbol) };
      }
      if (message.type === 'CODAL_GET_LATEST_MONTHLY_ACTIVITY') {
        return { ok: true, data: await dependencies.getLatestMonthlyActivityReport(validation.symbol) };
      }
      if (message.type === 'CODAL_GET_LATEST_FINANCIAL_STATEMENT') {
        return { ok: true, data: await dependencies.getLatestFinancialStatement(validation.symbol) };
      }

      const issuerName = 'issuerName' in message ? message.issuerName : undefined;
      return {
        ok: true,
        data: issuerName
          ? await dependencies.discoverLatestCodalReports(validation.symbol, { requestedIssuerName: issuerName })
          : await dependencies.discoverLatestCodalReports(validation.symbol)
      };
    }

    return { ok: true, data: await dependencies.getReportDetail(message.report) };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : 'خطای نامشخص در ارتباط با کدال'
    };
  }
}

export function createCodalMessageHandler(dependencies = defaultDependencies) {
  return async function handleCodalMessage(message: unknown): Promise<CodalRuntimeResponse | undefined> {
    if (!isCodalRuntimeMessage(message)) {
      return undefined;
    }

    const key = requestKey(message);
    const existing = inFlightRequests.get(key);
    if (existing) {
      return existing;
    }

    const request = runRequest(message, dependencies).finally(() => {
      inFlightRequests.delete(key);
    });
    inFlightRequests.set(key, request);
    return request;
  };
}
