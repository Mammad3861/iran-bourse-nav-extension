import { describe, expect, it } from 'vitest';
import type { CodalReportDiscoveryResult } from '../data/codal-client';
import type { MonthlyActivityParseResult } from '../data/codal-monthly-parser';
import { classifyHoldingSupport } from '../data/symbol-classification';

function discovery(monthlyTitle?: string): CodalReportDiscoveryResult {
  return {
    status: 'found',
    symbol: 'فولاد',
    monthlyActivityReport: monthlyTitle
      ? {
          symbol: 'فولاد',
          title: monthlyTitle
        }
      : undefined,
    sourceVerified: false,
    checkedAt: '2026-07-02T00:00:00.000Z'
  };
}

function parseResult(overrides: Partial<MonthlyActivityParseResult>): MonthlyActivityParseResult {
  return {
    status: 'empty',
    tableCandidates: [],
    extractedValues: [],
    primarySuggestions: [],
    secondarySuggestions: [],
    tablePreviews: [],
    diagnostics: {
      detectedTableCount: 0,
      parserStatus: 'empty',
      parserWarnings: [],
      extractedCandidates: [],
      rejectedCandidates: [],
      tables: []
    },
    warnings: [],
    parsedAt: '2026-07-02T00:00:00.000Z',
    ...overrides
  };
}

describe('holding support classification', () => {
  it('classifies investment and holding instrument names as likely holding symbols', () => {
    expect(classifyHoldingSupport({ instrumentName: 'سرمایه‌گذاری صندوق بازنشستگی' }).status).toBe('likely-holding');
    expect(classifyHoldingSupport({ instrumentName: 'سرمایه گذاری غدیر (هلدینگ)' }).status).toBe('likely-holding');
    expect(classifyHoldingSupport({ instrumentName: 'سرمایه گذاری تامین اجتماعی شستا' }).status).toBe('likely-holding');
    expect(classifyHoldingSupport({ instrumentName: 'سرمايه‌گذاري‌صندوق‌بازنشستگي‌' }).status).toBe('likely-holding');
    expect(classifyHoldingSupport({ instrumentName: 'سرمايه گذاري گروه توسعه ملي' }).status).toBe('likely-holding');
    expect(classifyHoldingSupport({ instrumentName: 'گروه مديريت سرمايه گذاري اميد' }).status).toBe('likely-holding');
  });

  it('does not classify a generic monthly activity report as holding support by itself', () => {
    const result = classifyHoldingSupport({
      instrumentName: 'فولاد مبارکه اصفهان',
      discovery: discovery('گزارش فعالیت ماهانه دوره ۱ ماهه منتهی به ۱۴۰۵/۰۳/۳۱')
    });

    expect(result.status).toBe('unknown');
    expect(result.message).toContain('محاسبه دستی');
  });

  it('classifies portfolio report wording and parser portfolio values as likely holding support', () => {
    expect(
      classifyHoldingSupport({
        discovery: discovery('صورت وضعیت پورتفوی دوره ۱ ماهه منتهی به ۱۴۰۵/۰۳/۳۱')
      }).status
    ).toBe('likely-holding');

    expect(
      classifyHoldingSupport({
        parseResult: parseResult({
          status: 'parsed',
          extractedValues: [
            {
              kind: 'listedPortfolioCostValue',
              label: 'بهای تمام شده',
              value: 136_494_769,
              rawText: '136,494,769',
              confidence: 'high',
              sourceTableIndex: 3
            }
          ]
        })
      }).status
    ).toBe('likely-holding');
  });

  it('does not classify industrial symbols as holding from generic parser labels alone', () => {
    const result = classifyHoldingSupport({
      instrumentName: 'ملي‌ صنايع‌ مس‌ ايران‌',
      parseResult: parseResult({
        status: 'ambiguous',
        tableCandidates: [
          {
            index: 0,
            rowCount: 2,
            columnCount: 2,
            matchedLabels: ['سرمایه گذاری ها', 'پرتفوی'],
            confidence: 'medium'
          }
        ],
        extractedValues: [
          {
            kind: 'totalSharesSuggestion',
            label: 'تعداد سهام',
            value: 60_000_000_000,
            rawText: '60,000,000,000',
            confidence: 'high',
            sourceTableIndex: 0
          }
        ]
      })
    });

    expect(result.status).toBe('unknown');
    expect(result.reasons.join(' ')).toContain('کافی نیستند');
  });

  it('keeps فولاد unknown or unsupported when no holding name or NAV portfolio candidates exist', () => {
    const result = classifyHoldingSupport({
      instrumentName: 'فولاد مبارکه اصفهان',
      parseResult: parseResult({
        status: 'ambiguous',
        tableCandidates: [],
        extractedValues: [
          {
            kind: 'totalSharesSuggestion',
            label: 'تعداد سهام',
            value: 800_000_000_000,
            rawText: '800,000,000,000',
            confidence: 'high',
            sourceTableIndex: 0
          }
        ]
      })
    });

    expect(result.status).not.toBe('likely-holding');
  });

  it('classifies strong usable NAV portfolio candidates as likely holding even when the name is weak', () => {
    const result = classifyHoldingSupport({
      instrumentName: 'نماد نمونه',
      parseResult: parseResult({
        status: 'parsed',
        extractedValues: [
          {
            kind: 'listedPortfolioCostValue',
            label: 'بهای تمام شده',
            value: 136_494_769,
            rawText: '136,494,769',
            confidence: 'high',
            sourceTableIndex: 3
          }
        ]
      })
    });

    expect(result.status).toBe('likely-holding');
  });

  it('marks completed discovery without portfolio support as unsupported', () => {
    const result = classifyHoldingSupport({
      instrumentName: 'فولاد مبارکه اصفهان',
      discovery: {
        status: 'not-found',
        symbol: 'فولاد',
        sourceVerified: false,
        checkedAt: '2026-07-02T00:00:00.000Z'
      }
    });

    expect(result.status).toBe('unsupported');
    expect(result.message).toContain('محاسبه دستی');
  });
});
