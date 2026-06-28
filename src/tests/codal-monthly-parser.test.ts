import { describe, expect, it } from 'vitest';
import type { CodalReportDetail } from '../data/codal-client';
import { parseMonthlyActivityReport } from '../data/codal-monthly-parser';

function detail(overrides: Partial<CodalReportDetail>): CodalReportDetail {
  return {
    sourceUrl: 'https://www.codal.ir/Reports/Decision.aspx?LetterSerial=test',
    title: 'گزارش فعالیت ماهانه دوره ۱ ماهه منتهی به ۱۴۰۵/۰۳/۳۱',
    symbol: 'وغدیر',
    contentType: 'html',
    plainTextPreview: '',
    tables: [],
    extractedTables: [],
    parserWarnings: [],
    fetchedAt: '2026-06-28T00:00:00.000Z',
    ...overrides
  };
}

describe('parseMonthlyActivityReport', () => {
  it('extracts listed portfolio cost and market values from a monthly activity table', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawHtml: `
          <table>
            <caption>پرتفوی بورسی پذیرفته شده در بورس</caption>
            <tr><th>شرح</th><th>بهای تمام شده</th><th>ارزش بازار</th></tr>
            <tr><td>سرمایه گذاری در سهام</td><td>۱,۲۰۰</td><td>۲,۵۰۰</td></tr>
          </table>
        `
      })
    );

    expect(result.status).toBe('parsed');
    expect(result.reportPeriod).toBe('1405/03/31');
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 1200 }),
        expect.objectContaining({ kind: 'listedPortfolioMarketValue', value: 2500 })
      ])
    );
  });

  it('extracts Arabic digit values from unlisted portfolio tables and suggests surplus', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawHtml: `
          <table>
            <caption>پرتفوی غیر بورسی خارج از بورس</caption>
            <tr><th>شرح</th><th>بهای تمام شده</th><th>ارزش برآوردی</th></tr>
            <tr><td>سرمایه گذاری در سهام</td><td>١٠٠٠</td><td>١٨٠٠</td></tr>
          </table>
        `
      })
    );

    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'unlistedPortfolioCostValue', value: 1000 }),
        expect.objectContaining({ kind: 'unlistedPortfolioEstimatedValue', value: 1800 }),
        expect.objectContaining({ kind: 'unlistedPortfolioSurplusSuggestion', value: 800 })
      ])
    );
  });

  it('returns no-candidate-table when no portfolio table is present', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawHtml: '<table><tr><th>شرح</th><th>مبلغ</th></tr><tr><td>فروش</td><td>100</td></tr></table>'
      })
    );

    expect(result.status).toBe('no-candidate-table');
    expect(result.warnings[0]).toContain('جدول پرتفوی');
  });

  it('returns unsupported-report for non-monthly reports', () => {
    const result = parseMonthlyActivityReport(
      detail({
        title: 'صورت‌های مالی سال مالی منتهی',
        rawHtml: '<table><tr><th>بهای تمام شده</th></tr><tr><td>100</td></tr></table>'
      })
    );

    expect(result.status).toBe('unsupported-report');
  });

  it('warns instead of guessing when numbers are malformed or absent', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawHtml: `
          <table>
            <caption>پرتفوی بورسی پذیرفته شده در بورس</caption>
            <tr><th>شرح</th><th>بهای تمام شده</th><th>ارزش بازار</th></tr>
            <tr><td>سرمایه گذاری در سهام</td><td>---</td><td>نامشخص</td></tr>
          </table>
        `
      })
    );

    expect(result.status).toBe('ambiguous');
    expect(result.extractedValues).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('قابل اتکا');
  });

  it('marks duplicate extracted values as ambiguous', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawHtml: `
          <table>
            <caption>پرتفوی بورسی پذیرفته شده در بورس</caption>
            <tr><th>شرح</th><th>بهای تمام شده</th><th>ارزش بازار</th></tr>
            <tr><td>سرمایه گذاری در سهام</td><td>100</td><td>200</td></tr>
          </table>
          <table>
            <caption>پرتفوی بورسی پذیرفته شده در بورس</caption>
            <tr><th>شرح</th><th>بهای تمام شده</th><th>ارزش بازار</th></tr>
            <tr><td>سرمایه گذاری در سهام</td><td>110</td><td>210</td></tr>
          </table>
        `
      })
    );

    expect(result.status).toBe('ambiguous');
    expect(result.warnings.join(' ')).toContain('چند مقدار');
  });

  it('parses JSON table-like details', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawJson: {
          tables: [
            {
              title: 'پرتفوی بورسی پذیرفته شده در بورس',
              headers: ['شرح', 'بهای تمام شده', 'ارزش روز'],
              rows: [['سرمایه گذاری در سهام', '۳۰۰', '۴۵۰']]
            }
          ]
        }
      })
    );

    expect(result.status).toBe('parsed');
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 300 }),
        expect.objectContaining({ kind: 'listedPortfolioMarketValue', value: 450 })
      ])
    );
  });

  it('parses normalized extracted tables from script-embedded Codal detail data', () => {
    const result = parseMonthlyActivityReport(
      detail({
        extractedTables: [
          {
            index: 0,
            source: 'script-json',
            caption: 'صورت وضعیت پورتفوی پذیرفته شده در بورس',
            headers: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
            rows: [
              ['شرح', 'بهای تمام شده', 'ارزش بازار'],
              ['سرمایه گذاری در سهام', '۱٬۵۰۰', '۲٬۷۰۰']
            ]
          }
        ],
        tables: [
          {
            index: 0,
            rowCount: 2,
            columnCount: 3,
            headers: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
            source: 'script-json'
          }
        ]
      })
    );

    expect(result.status).toBe('parsed');
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 1500 }),
        expect.objectContaining({ kind: 'listedPortfolioMarketValue', value: 2700 })
      ])
    );
  });
});
