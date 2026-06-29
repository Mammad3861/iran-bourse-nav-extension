import type { MonthlyActivityParseResult, ParserTablePreview } from '../data/codal-monthly-parser';
import type { CodalReportDiscoveryResult } from '../data/codal-client';

export interface ClipboardLike {
  writeText?: (text: string) => Promise<void>;
}

export function parserDiagnosticsJson(result: MonthlyActivityParseResult): string {
  return JSON.stringify(result.diagnostics, null, 2);
}

export function codalDiscoveryDiagnosticsJson(result: CodalReportDiscoveryResult): string {
  return JSON.stringify(result.diagnostics ?? result, null, 2);
}

function tablePreviewMarkdown(table: ParserTablePreview): string {
  const lines = [
    `### جدول ${table.index}${table.caption ? ` - ${table.caption}` : ''}`,
    `واحد: ${table.detectedUnit ?? 'نامشخص'}`,
    `برچسب‌ها: ${table.detectedLabels.join('، ') || 'نامشخص'}`,
    `هشدارها: ${table.warnings.join('، ') || '-'}`,
    '',
    `ستون‌ها: ${table.headers.join(' | ') || '-'}`,
    '',
    ...table.rows.slice(0, 10).map((row, index) => `${index + 1}. ${row.join(' | ')}`)
  ];
  return lines.join('\n');
}

export function parserTablePreviewText(result: MonthlyActivityParseResult): string {
  const header = [
    `گزارش: ${result.reportTitle ?? '-'}`,
    `دوره/تاریخ: ${result.reportPeriod ?? '-'}`,
    `وضعیت Parser: ${result.status}`,
    `تعداد جدول‌ها: ${result.diagnostics.detectedTableCount}`,
    `هشدارها: ${result.warnings.join(' | ') || '-'}`
  ].join('\n');

  return [header, ...result.tablePreviews.map(tablePreviewMarkdown)].join('\n\n');
}

export async function copyTextWithFallback(
  text: string,
  clipboard: ClipboardLike | undefined,
  showFallback: (text: string) => void
): Promise<'copied' | 'fallback'> {
  try {
    if (!clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable.');
    }
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    showFallback(text);
    return 'fallback';
  }
}
