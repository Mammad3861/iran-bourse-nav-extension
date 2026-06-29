import type {
  CodalReportDetailResult,
  CodalReportDiscoveryResult,
  CodalReportReference
} from './codal-client';
import type { CodalRuntimeMessage, CodalRuntimeResponse } from './codal-messages';

function sendCodalMessage<T extends CodalRuntimeMessage>(message: T): Promise<CodalRuntimeResponse<T['type']>> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      resolve({
        ok: false,
        errorMessage: 'ارتباط با پس‌زمینه افزونه در دسترس نیست'
      });
      return;
    }

    chrome.runtime.sendMessage(message, (response?: CodalRuntimeResponse<T['type']>) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        resolve({
          ok: false,
          errorMessage: runtimeError.message ?? 'خطا در ارتباط با پس‌زمینه افزونه'
        });
        return;
      }

      resolve(response ?? { ok: false, errorMessage: 'پاسخ کدال از پس‌زمینه افزونه دریافت نشد' });
    });
  });
}

async function unwrapResponse<T>(response: CodalRuntimeResponse): Promise<T> {
  if (response.ok) {
    return response.data as T;
  }

  throw new Error(response.errorMessage);
}

export async function requestCodalDiscovery(
  symbol: string,
  issuerName?: string
): Promise<CodalReportDiscoveryResult> {
  const message = issuerName
    ? { type: 'CODAL_DISCOVER_LATEST_REPORTS' as const, symbol, issuerName }
    : { type: 'CODAL_DISCOVER_LATEST_REPORTS' as const, symbol };
  return unwrapResponse<CodalReportDiscoveryResult>(
    await sendCodalMessage(message)
  );
}

export async function requestCodalReportDetail(
  report: CodalReportReference
): Promise<CodalReportDetailResult> {
  return unwrapResponse<CodalReportDetailResult>(
    await sendCodalMessage({ type: 'CODAL_GET_REPORT_DETAIL', report })
  );
}

export async function requestCodalSearchReports(symbol: string): Promise<CodalReportReference[]> {
  return unwrapResponse<CodalReportReference[]>(await sendCodalMessage({ type: 'CODAL_SEARCH_REPORTS', symbol }));
}
