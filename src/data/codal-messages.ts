import type {
  CodalReportDetailResult,
  CodalReportDiscoveryResult,
  CodalReportReference
} from './codal-client';

export type CodalMessageType =
  | 'CODAL_SEARCH_REPORTS'
  | 'CODAL_GET_LATEST_MONTHLY_ACTIVITY'
  | 'CODAL_GET_LATEST_FINANCIAL_STATEMENT'
  | 'CODAL_DISCOVER_LATEST_REPORTS'
  | 'CODAL_GET_REPORT_DETAIL';

export interface CodalSearchReportsMessage {
  type: 'CODAL_SEARCH_REPORTS';
  symbol: string;
}

export interface CodalLatestMonthlyActivityMessage {
  type: 'CODAL_GET_LATEST_MONTHLY_ACTIVITY';
  symbol: string;
}

export interface CodalLatestFinancialStatementMessage {
  type: 'CODAL_GET_LATEST_FINANCIAL_STATEMENT';
  symbol: string;
}

export interface CodalDiscoverLatestReportsMessage {
  type: 'CODAL_DISCOVER_LATEST_REPORTS';
  symbol: string;
  issuerName?: string;
}

export interface CodalGetReportDetailMessage {
  type: 'CODAL_GET_REPORT_DETAIL';
  report: CodalReportReference;
}

export type CodalRuntimeMessage =
  | CodalSearchReportsMessage
  | CodalLatestMonthlyActivityMessage
  | CodalLatestFinancialStatementMessage
  | CodalDiscoverLatestReportsMessage
  | CodalGetReportDetailMessage;

export type CodalMessageDataByType = {
  CODAL_SEARCH_REPORTS: CodalReportReference[];
  CODAL_GET_LATEST_MONTHLY_ACTIVITY: CodalReportReference | undefined;
  CODAL_GET_LATEST_FINANCIAL_STATEMENT: CodalReportReference | undefined;
  CODAL_DISCOVER_LATEST_REPORTS: CodalReportDiscoveryResult;
  CODAL_GET_REPORT_DETAIL: CodalReportDetailResult;
};

export type CodalRuntimeResponse<T extends CodalMessageType = CodalMessageType> =
  | {
      ok: true;
      data: CodalMessageDataByType[T];
    }
  | {
      ok: false;
      status?: 'network-error' | 'cors-blocked' | 'unavailable' | 'parse-error';
      errorMessage: string;
      attemptCount?: number;
      domain?: string;
      usedCache?: boolean;
      cachedAt?: string;
    };

export function isCodalRuntimeMessage(message: unknown): message is CodalRuntimeMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const type = (message as { type?: unknown }).type;
  return (
    type === 'CODAL_SEARCH_REPORTS' ||
    type === 'CODAL_GET_LATEST_MONTHLY_ACTIVITY' ||
    type === 'CODAL_GET_LATEST_FINANCIAL_STATEMENT' ||
    type === 'CODAL_DISCOVER_LATEST_REPORTS' ||
    type === 'CODAL_GET_REPORT_DETAIL'
  );
}
