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
    expect(result.warnings.join(' ')).toContain('چند کاندید');
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

  it('extracts listed market value from an accessible Codal ExcelUrl table suggestion only', () => {
    const result = parseMonthlyActivityReport(
      detail({
        extractedTables: [
          {
            index: 0,
            source: 'codal-excel',
            caption: 'Codal ExcelUrl - صورت وضعیت پورتفوی پذیرفته شده در بورس',
            headers: ['شرح', 'بهای تمام شده', 'ارزش روز بازار'],
            rows: [
              ['شرح', 'بهای تمام شده', 'ارزش روز بازار'],
              ['سرمایه گذاری در سهام شرکت الف', '100', '180'],
              ['جمع', '100', '180']
            ]
          }
        ],
        excelUrl: 'https://www.codal.ir/Reports/ExportExcel.aspx?LetterSerial=test',
        excelDiagnostics: {
          url: 'https://www.codal.ir/Reports/ExportExcel.aspx?LetterSerial=test',
          status: 'fetched',
          tableCount: 1
        },
        sourceStrategy: {
          htmlDetailChecked: true,
          reconstructedTableChecked: false,
          alternativeReportsChecked: false,
          marketValueStatus: 'found',
          messages: ['ExcelUrl بررسی شد؛ 1 جدول قابل بررسی پیدا شد.'],
          excel: {
            url: 'https://www.codal.ir/Reports/ExportExcel.aspx?LetterSerial=test',
            status: 'fetched',
            tableCount: 1
          }
        }
      })
    );

    expect(result.status).toBe('parsed');
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'listedPortfolioMarketValue', value: 180, sourceTableIndex: 0 })
      ])
    );
    expect(result.diagnostics.sourceStrategy?.excel.status).toBe('fetched');
  });

  it('warns clearly when Excel was checked but has no listed market value', () => {
    const result = parseMonthlyActivityReport(
      detail({
        extractedTables: [
          {
            index: 0,
            source: 'codal-excel',
            caption: 'Codal ExcelUrl - سرمایه گذاری ها',
            headers: ['شرح', 'بهای تمام شده'],
            rows: [
              ['شرح', 'بهای تمام شده'],
              ['سرمایه گذاری در سهام', '100'],
              ['جمع', '100']
            ]
          }
        ],
        excelDiagnostics: {
          status: 'fetched',
          tableCount: 1
        },
        sourceStrategy: {
          htmlDetailChecked: true,
          reconstructedTableChecked: false,
          alternativeReportsChecked: false,
          marketValueStatus: 'not-found',
          messages: ['ارزش روز پرتفوی بورسی در Excel گزارش نیز پیدا نشد.'],
          excel: {
            status: 'fetched',
            tableCount: 1
          }
        }
      })
    );

    expect(result.extractedValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 100 })])
    );
    expect(result.extractedValues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue' })])
    );
    expect(result.warnings).toContain('ارزش روز پرتفوی بورسی در Excel گزارش نیز پیدا نشد.');
  });

  it('extracts values from a Codal-like total row labeled جمع', () => {
    const result = parseMonthlyActivityReport(
      detail({
        extractedTables: [
          {
            index: 2,
            source: 'script-json',
            caption: 'پرتفوی بورسی پذیرفته شده در بورس - مبالغ به ریال',
            headers: ['نام شرکت', 'مبلغ تمام شده', 'مبلغ بازار'],
            rows: [
              ['نام شرکت', 'مبلغ تمام شده', 'مبلغ بازار'],
              ['شرکت الف', '۱۰۰', '۱۳۰'],
              ['شرکت ب', '۲۰۰', '۲۷۰'],
              ['جمع', '۳۰۰', '۴۰۰']
            ]
          }
        ]
      })
    );

    expect(result.status).toBe('parsed');
    expect(result.tablePreviews[0]).toEqual(
      expect.objectContaining({
        index: 2,
        detectedLabels: expect.arrayContaining(['مبلغ تمام شده', 'مبلغ بازار', 'جمع'])
      })
    );
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'listedPortfolioCostValue',
          value: 300,
          confidence: 'high',
          sourceTableIndex: 2,
          sourceRowIndex: 3,
          reason: expect.stringContaining('ردیف جمع')
        }),
        expect.objectContaining({ kind: 'listedPortfolioMarketValue', value: 400, confidence: 'high' })
      ])
    );
  });

  it('extracts suggestions from reconstructed Codal cell-model tables', () => {
    const result = parseMonthlyActivityReport(
      detail({
        extractedTables: [
          {
            index: 3,
            source: 'codal-cell-model',
            caption: 'SummaryOfCompanyInvestments - سرمایه گذاری های شرکت',
            headers: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
            rows: [
              ['شرح', 'بهای تمام شده', 'ارزش بازار'],
              ['سهام شرکت های قابل معامله پذیرفته شده در بورس', '۱۰۰', '۱۸۰'],
              ['جمع', '۱۰۰', '۱۸۰']
            ],
            reconstruction: {
              kind: 'codal-cell-model',
              metaTableCode: '2570',
              metaTableId: '10',
              alias: 'SummaryOfCompanyInvestments',
              rawCellCount: 9,
              rowCount: 3,
              columnCount: 3,
              warnings: []
            }
          }
        ]
      })
    );

    expect(result.status).toBe('parsed');
    expect(result.diagnostics.tables[0]).toEqual(
      expect.objectContaining({
        source: 'codal-cell-model',
        reconstruction: expect.objectContaining({ metaTableCode: '2570', rawCellCount: 9 }),
        normalizedHeaders: ['شرح', 'بهای تمام شده', 'ارزش بازار']
      })
    );
    expect(result.diagnostics.tables[0].normalizedHeaders).not.toContain('metaTableId');
    expect(result.diagnostics.tables[0].normalizedHeaders).not.toContain('address');
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 100, confidence: 'medium' }),
        expect.objectContaining({ kind: 'listedPortfolioMarketValue', value: 180, confidence: 'medium' })
      ])
    );
  });

  it('reconstructs flattened Codal technical cell rows before parsing business values', () => {
    const technicalHeaders = [
      'metaTableId',
      'metaTableCode',
      'address',
      'cellGroupName',
      'rowSequence',
      'columnSequence',
      'value'
    ];
    const result = parseMonthlyActivityReport(
      detail({
        extractedTables: [
          {
            index: 3,
            source: 'json',
            caption: 'SummaryOfCompanyInvestments - سرمایه گذاری های شرکت',
            headers: technicalHeaders,
            rows: [
              technicalHeaders,
              ['3848', '2570', 'A1', 'SummaryOfCompanyInvestments', '1', '1', 'شرح'],
              ['3848', '2570', 'B1', 'SummaryOfCompanyInvestments', '1', '2', 'بهای تمام شده'],
              [
                '3848',
                '2570',
                'A2',
                'SummaryOfCompanyInvestments',
                '2',
                '1',
                'سهام شرکت های قابل معامله در بازار سرمایه'
              ],
              ['3848', '2570', 'B2', 'SummaryOfCompanyInvestments', '2', '2', '۱۰۰'],
              ['3848', '2570', 'A3', 'SummaryOfCompanyInvestments', '3', '1', 'جمع'],
              ['3848', '2570', 'B3', 'SummaryOfCompanyInvestments', '3', '2', '۱۰۰']
            ]
          }
        ]
      })
    );

    expect(result.status).toBe('parsed');
    expect(result.diagnostics.tables[0]).toEqual(
      expect.objectContaining({
        source: 'codal-cell-model',
        reconstruction: expect.objectContaining({
          metaTableCode: '2570',
          metaTableId: '3848',
          rawCellCount: 6,
          rowCount: 3,
          columnCount: 2
        }),
        normalizedHeaders: ['شرح', 'بهای تمام شده'],
        firstNormalizedRows: expect.arrayContaining([
          ['سهام شرکت های قابل معامله در بازار سرمایه', '100'],
          ['جمع', '100']
        ]),
        costColumnCandidates: [expect.objectContaining({ index: 1, label: 'بهای تمام شده' })],
        totalRowCandidates: [expect.objectContaining({ rowIndex: 2, label: 'جمع' })],
        marketValueColumnCandidates: [],
        failureReasons: expect.arrayContaining(['ستون ارزش بازار در جدول بازسازی‌شده پیدا نشد.'])
      })
    );
    expect(result.diagnostics.tables[0].normalizedHeaders).not.toContain('metaTableId');
    expect(result.diagnostics.tables[0].normalizedHeaders).not.toContain('address');
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'listedPortfolioCostValue',
          value: 100,
          sourceTableIndex: 3,
          sourceRowIndex: 2,
          sourceColumnIndex: 1
        })
      ])
    );
    expect(result.extractedValues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue' })])
    );
    expect(result.warnings).toContain('جدول 3: ستون ارزش بازار در جدول بازسازی‌شده پیدا نشد.');
  });

  it('selects the current-period non-zero aggregate from reconstructed investment summary tables', () => {
    const result = parseMonthlyActivityReport(
      detail({
        extractedTables: [
          {
            index: 3,
            source: 'codal-cell-model',
            caption: 'SummaryOfCompanyInvestments - سرمایه گذاری های شرکت',
            headers: [
              'شرح',
              'دوره مالی منتهی به 1405/03/31',
              'سال مالی منتهی به 1404/12/29'
            ],
            rows: [
              ['شرح', 'دوره مالی منتهی به 1405/03/31', 'سال مالی منتهی به 1404/12/29'],
              ['', 'بهای تمام شده', 'بهای تمام شده'],
              ['جمع', '۰', '۰'],
              ['پذیرفته شده در بورس', '۰', '۰'],
              ['سهام شرکت های قابل معامله در بازار سرمایه', '136,494,769', '135,404,798'],
              ['جمع', '136,494,769', '135,404,798']
            ],
            reconstruction: {
              kind: 'codal-cell-model',
              metaTableCode: '2570',
              metaTableId: '3848',
              alias: 'SummaryOfCompanyInvestments',
              rawCellCount: 18,
              rowCount: 6,
              columnCount: 3,
              warnings: []
            }
          }
        ]
      })
    );

    const costValues = result.extractedValues.filter((value) => value.kind === 'listedPortfolioCostValue');

    expect(result.status).toBe('parsed');
    expect(costValues).toHaveLength(1);
    expect(costValues[0]).toEqual(
      expect.objectContaining({
        value: 136_494_769,
        confidence: 'medium',
        period: '1405/03/31',
        periodLabel: 'دوره مالی منتهی به 1405/03/31',
        sourceTableIndex: 3,
        sourceRowIndex: 5,
        sourceColumnIndex: 1,
        unit: 'نامشخص',
        warning: expect.stringContaining('واحد')
      })
    );
    expect(result.extractedValues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 0 })])
    );
    expect(result.extractedValues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 135_404_798 })])
    );
    expect(result.extractedValues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue' })])
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('دوره قبلی'),
        'جدول 3: ستون ارزش بازار در جدول بازسازی‌شده پیدا نشد.'
      ])
    );
    expect(result.diagnostics.rejectedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringContaining('1404/12/29') }),
        expect.objectContaining({ reason: expect.stringContaining('کاندید صفر') })
      ])
    );
  });

  it('supports Arabic digits, commas, whitespace, and parenthesized negative values', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawHtml: `
          <table>
            <caption>پرتفوی بورسی پذیرفته شده در بورس</caption>
            <tr><th>شرح</th><th>بهای تمام شده</th><th>ارزش روز</th></tr>
            <tr><td>جمع کل</td><td> ١,٢٣٤ </td><td>(٢٣٤)</td></tr>
          </table>
        `
      })
    );

    expect(result.extractedValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 1234 })])
    );
    expect(result.extractedValues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue' })])
    );
    expect(result.secondarySuggestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue', value: -234 })])
    );
    expect(result.diagnostics.rejectedCandidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('منفی') })])
    );
  });

  it('scales explicitly million-rial tables', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawHtml: `
          <table>
            <caption>پرتفوی بورسی پذیرفته شده در بورس - مبالغ به میلیون ریال</caption>
            <tr><th>شرح</th><th>بهای تمام شده</th><th>ارزش بازار</th></tr>
            <tr><td>جمع</td><td>۲</td><td>۳</td></tr>
          </table>
        `
      })
    );

    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'listedPortfolioCostValue', value: 2_000_000 }),
        expect.objectContaining({ kind: 'listedPortfolioMarketValue', value: 3_000_000 })
      ])
    );
  });

  it('marks multiple total rows as low-confidence candidates instead of guessing', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawHtml: `
          <table>
            <caption>پرتفوی بورسی پذیرفته شده در بورس</caption>
            <tr><th>شرح</th><th>بهای تمام شده</th><th>ارزش بازار</th></tr>
            <tr><td>جمع صنعت اول</td><td>۱۰۰</td><td>۱۵۰</td></tr>
            <tr><td>جمع صنعت دوم</td><td>۲۰۰</td><td>۲۵۰</td></tr>
          </table>
        `
      })
    );

    expect(result.status).toBe('ambiguous');
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioCostValue', confidence: 'low' })])
    );
    expect(result.extractedValues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue' })])
    );
    expect(result.secondarySuggestions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'listedPortfolioMarketValue', confidence: 'low' })])
    );
    expect(result.warnings.join(' ')).toContain('چند کاندید');
  });

  it('returns table diagnostics when no reliable numeric values exist', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawHtml: `
          <table>
            <caption>پرتفوی بورسی پذیرفته شده در بورس</caption>
            <tr><th>شرح</th><th>بهای تمام شده</th><th>ارزش بازار</th></tr>
            <tr><td>جمع</td><td>---</td><td>نامشخص</td></tr>
          </table>
        `
      })
    );

    expect(result.status).toBe('ambiguous');
    expect(result.extractedValues).toHaveLength(0);
    expect(result.tablePreviews[0]).toEqual(
      expect.objectContaining({
        headers: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
        detectedLabels: expect.arrayContaining(['بهای تمام شده', 'ارزش بازار', 'جمع'])
      })
    );
    expect(result.warnings.join(' ')).toContain('پیش‌نمایش جدول');
  });

  it('extracts reliable listed values from a real-like وصندوق diagnostics fixture', () => {
    const result = parseMonthlyActivityReport(
      detail({
        title: 'صورت وضعیت پورتفوی دوره ۱ ماهه منتهی به ۱۴۰۵/۰۳/۳۱',
        symbol: 'وصندوق',
        extractedTables: [
          {
            index: 0,
            source: 'script-json',
            caption: 'مشخصات گزارش',
            headers: ['شرح', 'مقدار'],
            rows: [
              ['شرح', 'مقدار'],
              ['دوره', '۱۴۰۵/۰۳/۳۱']
            ]
          },
          {
            index: 1,
            source: 'script-json',
            caption: 'خلاصه وضعیت',
            headers: ['شرح', 'مبلغ'],
            rows: [
              ['شرح', 'مبلغ'],
              ['درآمد سود سهام', '۱۰۰']
            ]
          },
          {
            index: 2,
            source: 'script-json',
            caption: 'صورت وضعیت پورتفوی شرکتهای پذیرفته شده در بورس - مبالغ به میلیون ریال',
            headers: ['نام شرکت', 'تعداد سهام', 'بهای تمام شده', 'ارزش بازار', 'افزایش/کاهش'],
            rows: [
              ['نام شرکت', 'تعداد سهام', 'بهای تمام شده', 'ارزش بازار', 'افزایش/کاهش'],
              ['سرمایه گذاری در سهام شرکت الف', '۱,۰۰۰', '۲,۵۰۰', '۳,۷۰۰', '۱,۲۰۰'],
              ['سرمایه گذاری در سهام شرکت ب', '۲,۰۰۰', '۳,۵۰۰', '۴,۳۰۰', '۸۰۰'],
              ['مانده پایان دوره', '', '۶,۰۰۰', '۸,۰۰۰', '۲,۰۰۰']
            ]
          },
          {
            index: 3,
            source: 'script-json',
            caption: 'صورت وضعیت پورتفوی شرکتهای خارج از بورس',
            headers: ['شرح', 'بهای تمام شده'],
            rows: [
              ['شرح', 'بهای تمام شده'],
              ['فاقد ارزش برآوردی قابل اتکا', '۵۰۰']
            ]
          },
          {
            index: 4,
            source: 'script-json',
            caption: 'سایر اطلاعات',
            headers: ['شرح', 'مقدار'],
            rows: [
              ['شرح', 'مقدار'],
              ['توضیحات', 'بدون مقدار']
            ]
          }
        ]
      })
    );

    expect(result.status).toBe('parsed');
    expect(result.tableCandidates.map((candidate) => candidate.index)).toContain(2);
    expect(result.diagnostics.detectedTableCount).toBe(5);
    expect(result.diagnostics.symbol).toBe('وصندوق');
    expect(result.diagnostics.tables[2]).toEqual(
      expect.objectContaining({
        tableIndex: 2,
        rawHeaders: ['نام شرکت', 'تعداد سهام', 'بهای تمام شده', 'ارزش بازار', 'افزایش/کاهش'],
        normalizedHeaders: ['نام شرکت', 'تعداد سهام', 'بهای تمام شده', 'ارزش بازار', 'افزایش/کاهش'],
        firstRawRows: expect.arrayContaining([
          ['مانده پایان دوره', '', '۶,۰۰۰', '۸,۰۰۰', '۲,۰۰۰']
        ]),
        firstNormalizedRows: expect.arrayContaining([
          ['مانده پایان دوره', '', '6,000', '8,000', '2,000']
        ]),
        totalRowCandidates: expect.arrayContaining([
          expect.objectContaining({ rowIndex: 3, label: 'مانده پایان دوره' })
        ]),
        costColumnCandidates: expect.arrayContaining([expect.objectContaining({ index: 2 })]),
        marketValueColumnCandidates: expect.arrayContaining([expect.objectContaining({ index: 3 })])
      })
    );
    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'listedPortfolioCostValue',
          value: 6_000_000_000,
          confidence: 'high',
          sourceTableIndex: 2,
          unit: 'میلیون ریال',
          reason: expect.stringContaining('ردیف جمع')
        }),
        expect.objectContaining({
          kind: 'listedPortfolioMarketValue',
          value: 8_000_000_000,
          confidence: 'high',
          sourceTableIndex: 2,
          unit: 'میلیون ریال'
        })
      ])
    );
  });

  it('returns raw values with warnings when the table unit is unclear', () => {
    const result = parseMonthlyActivityReport(
      detail({
        rawHtml: `
          <table>
            <caption>پرتفوی بورسی پذیرفته شده در بورس</caption>
            <tr><th>شرح</th><th>بهای تمام شده</th><th>ارزش بازار</th></tr>
            <tr><td>جمع</td><td>۶۰۰۰</td><td>۸۰۰۰</td></tr>
          </table>
        `
      })
    );

    expect(result.extractedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'listedPortfolioCostValue',
          value: 6000,
          confidence: 'medium',
          unit: 'نامشخص',
          warning: expect.stringContaining('واحد')
        })
      ])
    );
  });

  it('keeps noisy Excel market candidates out of primary suggestions while preserving diagnostics', () => {
    const result = parseMonthlyActivityReport(
      detail({
        symbol: 'وصندوق',
        extractedTables: [
          {
            index: 3,
            source: 'codal-cell-model',
            caption: 'SummaryOfCompanyInvestments - سرمایه گذاری های شرکت',
            headers: ['شرح', 'دوره مالی منتهی به 1405/03/31', 'سال مالی منتهی به 1404/12/29'],
            rows: [
              ['شرح', 'دوره مالی منتهی به 1405/03/31', 'سال مالی منتهی به 1404/12/29'],
              ['', 'بهای تمام شده', 'بهای تمام شده'],
              ['سهام شرکت های قابل معامله در بازار سرمایه', '136,494,769', '135,404,798'],
              ['جمع', '136,494,769', '135,404,798']
            ],
            reconstruction: {
              kind: 'codal-cell-model',
              metaTableCode: '2570',
              metaTableId: '3848',
              alias: 'SummaryOfCompanyInvestments',
              rawCellCount: 12,
              rowCount: 4,
              columnCount: 3,
              warnings: []
            }
          },
          {
            index: 10,
            source: 'codal-excel',
            caption: 'Codal ExcelUrl - صورت وضعیت پرتفوی پذیرفته شده در بورس',
            headers: ['شرح', 'بهای تمام شده', 'ارزش بازار'],
            rows: [
              ['شرح', 'بهای تمام شده', 'ارزش بازار'],
              ['جمع', '136,494,769', '170,000']
            ]
          },
          {
            index: 11,
            source: 'codal-excel',
            caption: 'Codal ExcelUrl - صورت وضعیت پرتفوی بورسی',
            headers: ['شرح', 'ارزش روز بازار'],
            rows: [
              ['شرح', 'ارزش روز بازار'],
              ['جمع', '171,000']
            ]
          },
          {
            index: 12,
            source: 'codal-excel',
            caption: 'Codal ExcelUrl - صورت وضعیت پرتفوی بورسی - کاندیدهای نامعتبر',
            headers: ['شرح', 'ارزش بازار', 'ارزش روز'],
            rows: [
              ['شرح', 'ارزش بازار', 'ارزش روز'],
              ['جمع', '0', '(9)']
            ]
          },
          {
            index: 13,
            source: 'codal-excel',
            caption: 'Codal ExcelUrl - صورت وضعیت پرتفوی بورسی - مبالغ به میلیون ریال',
            headers: ['شرح', 'ارزش بازار'],
            rows: [
              ['شرح', 'ارزش بازار'],
              ['جمع', '5']
            ]
          }
        ],
        excelDiagnostics: {
          status: 'fetched',
          tableCount: 4
        },
        sourceStrategy: {
          htmlDetailChecked: true,
          reconstructedTableChecked: true,
          alternativeReportsChecked: false,
          marketValueStatus: 'not-found',
          messages: ['چند کاندید Excel برای ارزش روز پیدا شد.'],
          excel: {
            status: 'fetched',
            tableCount: 4
          }
        }
      })
    );

    const primaryCosts = result.extractedValues.filter((value) => value.kind === 'listedPortfolioCostValue');
    const primaryMarkets = result.extractedValues.filter((value) => value.kind === 'listedPortfolioMarketValue');
    const secondaryMarkets = result.secondarySuggestions.filter((value) => value.kind === 'listedPortfolioMarketValue');

    expect(result.status).toBe('ambiguous');
    expect(primaryCosts).toHaveLength(1);
    expect(primaryCosts[0]).toEqual(
      expect.objectContaining({
        value: 136_494_769,
        sourceTableIndex: 3
      })
    );
    expect(primaryMarkets).toHaveLength(0);
    expect(secondaryMarkets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceTableIndex: 10, value: 170_000 }),
        expect.objectContaining({ sourceTableIndex: 11, value: 171_000 }),
        expect.objectContaining({ sourceTableIndex: 12, rawValue: 0 }),
        expect.objectContaining({ sourceTableIndex: 12, value: -9 }),
        expect.objectContaining({ sourceTableIndex: 13, rawValue: 5, value: 5_000_000 })
      ])
    );
    expect(result.diagnostics.extractedCandidates.length).toBeGreaterThan(result.extractedValues.length);
    expect(result.diagnostics.sourceStrategy?.marketValueStatus).toBe('ambiguous');
    expect(result.diagnostics.sourceStrategy?.messages.join(' ')).toContain('چند مقدار محتمل');
    expect(result.diagnostics.sourceStrategy?.messages.join(' ')).not.toContain('گزارش نیز پیدا نشد');
    expect(result.warnings.join(' ')).not.toContain('گزارش نیز پیدا نشد');
    expect(result.warnings.join(' ')).not.toContain('ناموفق بود: fetched');
    expect(result.warnings.join(' ')).not.toContain('کاندید صفر');
    expect(result.diagnostics.rejectedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringContaining('کاندید صفر') }),
        expect.objectContaining({ reason: expect.stringContaining('منفی') })
      ])
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.'
      ])
    );
  });
});
