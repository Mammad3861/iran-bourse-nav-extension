import { describe, expect, it, vi } from 'vitest';
import type { MonthlyActivityParseResult } from '../data/codal-monthly-parser';
import { copyTextWithFallback, parserDiagnosticsJson, parserTablePreviewText } from '../ui/parser-diagnostics';

const result: MonthlyActivityParseResult = {
  status: 'ambiguous',
  reportTitle: 'گزارش فعالیت ماهانه',
  reportPeriod: '1405/03/31',
  sourceReportUrl: 'https://www.codal.ir/Reports/Decision.aspx?LetterSerial=test',
  tableCandidates: [],
  extractedValues: [],
  tablePreviews: [
    {
      index: 0,
      caption: 'صورت وضعیت پورتفوی',
      detectedUnit: 'نامشخص',
      rawHeaders: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
      normalizedHeaders: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
      rawRows: [
        ['شرح', 'بهای تمام شده', 'ارزش بازار'],
        ['جمع', '---', 'نامشخص']
      ],
      normalizedRows: [
        ['شرح', 'بهای تمام شده', 'ارزش بازار'],
        ['جمع', '---', 'نامشخص']
      ],
      headers: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
      rows: [
        ['شرح', 'بهای تمام شده', 'ارزش بازار'],
        ['جمع', '---', 'نامشخص']
      ],
      textPreview: 'صورت وضعیت پورتفوی شرح بهای تمام شده ارزش بازار جمع',
      detectedLabels: ['بهای تمام شده', 'ارزش بازار', 'جمع'],
      warnings: ['واحد گزارش مشخص نیست']
    }
  ],
  diagnostics: {
    symbol: 'وصندوق',
    codalSymbol: 'وصندوق',
    reportTitle: 'گزارش فعالیت ماهانه',
    reportDate: '1405/03/31',
    reportUrl: 'https://www.codal.ir/Reports/Decision.aspx?LetterSerial=test',
    tracingNo: 'test',
    fetchTimestamp: '2026-06-29T00:00:00.000Z',
    detectedTableCount: 1,
    parserStatus: 'ambiguous',
    parserWarnings: ['واحد گزارش مشخص نیست'],
    extractedCandidates: [],
    rejectedCandidates: [{ tableIndex: 0, reason: 'ستون قابل اتکا پیدا نشد' }],
    tables: [
      {
        tableIndex: 0,
        caption: 'صورت وضعیت پورتفوی',
        detectedUnit: 'نامشخص',
        rawHeaders: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
        normalizedHeaders: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
        firstRawRows: [
          ['شرح', 'بهای تمام شده', 'ارزش بازار'],
          ['جمع', '---', 'نامشخص']
        ],
        firstNormalizedRows: [
          ['شرح', 'بهای تمام شده', 'ارزش بازار'],
          ['جمع', '---', 'نامشخص']
        ],
        firstRows: [
          ['شرح', 'بهای تمام شده', 'ارزش بازار'],
          ['جمع', '---', 'نامشخص']
        ],
        detectedLabels: ['بهای تمام شده', 'ارزش بازار', 'جمع'],
        totalRowCandidates: [{ rowIndex: 1, label: 'جمع', cells: ['جمع', '---', 'نامشخص'], exact: true }],
        costColumnCandidates: [{ index: 1, label: 'بهای تمام شده' }],
        marketValueColumnCandidates: [{ index: 2, label: 'ارزش بازار' }],
        failureReasons: ['واحد گزارش مشخص نیست'],
        textPreview: 'صورت وضعیت پورتفوی شرح بهای تمام شده ارزش بازار جمع'
      }
    ]
  },
  warnings: ['واحد گزارش مشخص نیست'],
  parsedAt: '2026-06-29T00:00:00.000Z'
};

describe('parser diagnostics UI helpers', () => {
  it('serializes readable JSON diagnostics with warnings, headers, and rows', () => {
    const parsed = JSON.parse(parserDiagnosticsJson(result)) as MonthlyActivityParseResult['diagnostics'];

    expect(parsed.symbol).toBe('وصندوق');
    expect(parsed.parserWarnings).toContain('واحد گزارش مشخص نیست');
    expect(parsed.tables[0].rawHeaders).toEqual(['شرح', 'بهای تمام شده', 'ارزش بازار']);
    expect(parsed.tables[0].firstRawRows[1]).toEqual(['جمع', '---', 'نامشخص']);
    expect(parsed.tables[0].firstNormalizedRows[1]).toEqual(['جمع', '---', 'نامشخص']);
    expect(parsed.tables[0].failureReasons).toContain('واحد گزارش مشخص نیست');
  });

  it('builds compact table preview text', () => {
    const text = parserTablePreviewText(result);

    expect(text).toContain('تعداد جدول‌ها: 1');
    expect(text).toContain('### جدول 0');
    expect(text).toContain('شرح | بهای تمام شده | ارزش بازار');
    expect(text).toContain('جمع | --- | نامشخص');
    expect(text).toContain('دلیل عدم استخراج: واحد گزارش مشخص نیست');
  });

  it('falls back without throwing when clipboard is unavailable', async () => {
    const fallback = vi.fn();

    await expect(copyTextWithFallback('payload', undefined, fallback)).resolves.toBe('fallback');
    expect(fallback).toHaveBeenCalledWith('payload');
  });

  it('uses clipboard when available', async () => {
    const fallback = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(copyTextWithFallback('payload', { writeText }, fallback)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('payload');
    expect(fallback).not.toHaveBeenCalled();
  });
});
