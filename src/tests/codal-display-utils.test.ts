import { describe, expect, it } from 'vitest';
import type { CodalReportDiscoveryResult, CodalSourceStrategyDiagnostics } from '../data/codal-client';
import {
  compactParserWarnings,
  discoverySelectionNotice,
  financialReportSummary,
  marketValueStatusText,
  sourceStrategySummaryText
} from '../ui/codal-display-utils';

function strategy(status: CodalSourceStrategyDiagnostics['marketValueStatus']): CodalSourceStrategyDiagnostics {
  return {
    htmlDetailChecked: true,
    reconstructedTableChecked: true,
    alternativeReportsChecked: false,
    marketValueStatus: status,
    messages:
      status === 'ambiguous'
        ? ['ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.']
        : [],
    excel: {
      status: 'fetched',
      tableCount: 13
    }
  };
}

describe('codal display utilities', () => {
  it('renders distinct market value source states', () => {
    expect(marketValueStatusText('found')).toBe('پیدا شد');
    expect(marketValueStatusText('not-found')).toBe('پیدا نشد');
    expect(marketValueStatusText('ambiguous')).toBe('نیازمند بررسی دستی');
    expect(marketValueStatusText('unavailable')).toBe('قابل بررسی نبود');
  });

  it('does not show not-found copy for ambiguous market value diagnostics', () => {
    const text = sourceStrategySummaryText(strategy('ambiguous'));

    expect(text).toContain('وضعیت: نیازمند بررسی دستی');
    expect(text).toContain('Excel: fetched');
    expect(text).toContain('چند مقدار محتمل');
    expect(text).not.toContain('وضعیت: پیدا نشد');
    expect(text).not.toContain('گزارش نیز پیدا نشد');
  });

  it('keeps detailed rejected candidate spam out of compact parser warnings', () => {
    expect(
      compactParserWarnings([
        'کاندید صفر در ردیف 3 ستون 2 رد شد چون مقدار غیرصفر قابل اتکاتری وجود دارد.',
        'کاندید ردیف 2 رد شد چون ردیف جمع دقیق‌تری در انتهای بخش وجود دارد.',
        'کاندید بسیار کوچک از فهرست اصلی حذف شد.',
        'کاندید ستون 3 رد شد چون مربوط به دوره قبلی 1404/12/29 است.',
        'ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.'
      ])
    ).toEqual([
      'کاندید ستون 3 رد شد چون مربوط به دوره قبلی 1404/12/29 است.',
      'ارزش روز پرتفوی بورسی در Excel پیدا شد، اما چند مقدار محتمل وجود دارد و نیاز به بررسی دستی دارد.'
    ]);
  });

  it('does not show issuer warning when a high-confidence selected report has no warnings', () => {
    const result: CodalReportDiscoveryResult = {
      status: 'found',
      symbol: 'وغدير',
      sourceVerified: false,
      checkedAt: '2026-07-01T00:00:00.000Z',
      monthlyActivityReport: {
        symbol: 'وغدیر',
        companyName: 'سرمایه گذاری غدیر',
        title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31'
      },
      diagnostics: {
        requestedSymbol: 'وغدير',
        requestedIssuerName: 'سرمايه‌گذاري‌غدير(هلدينگ‌',
        monthlyActivity: {
          requestedSymbol: 'وغدير',
          requestedIssuerName: 'سرمايه‌گذاري‌غدير(هلدينگ‌',
          reportKind: 'monthly-activity',
          selectedReport: {
            symbol: 'وغدیر',
            companyName: 'سرمایه گذاری غدیر',
            title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31'
          },
          selectedConfidence: 'high',
          selectedWarnings: [],
          candidates: []
        }
      }
    };

    expect(discoverySelectionNotice(result)).toBe('گزارش انتخاب‌شده با نماد/ناشر تطبیق داده شد.');
  });

  it('lets high-confidence normalized monthly symbol match suppress noisy financial warnings', () => {
    const result: CodalReportDiscoveryResult = {
      status: 'found',
      symbol: 'وغدير',
      sourceVerified: false,
      checkedAt: '2026-07-01T00:00:00.000Z',
      diagnostics: {
        requestedSymbol: 'وغدير',
        requestedIssuerName: 'وغدير 14,630',
        monthlyActivity: {
          requestedSymbol: 'وغدير',
          requestedIssuerName: 'وغدير 14,630',
          reportKind: 'monthly-activity',
          selectedReport: {
            symbol: 'وغدیر',
            companyName: 'سرمایه گذاری غدیر',
            title: 'گزارش فعالیت ماهانه دوره 1 ماهه منتهی به 1405/03/31'
          },
          selectedConfidence: 'high',
          selectedWarnings: ['نام ناشر ورودی قابل اتکا نبود.'],
          candidates: []
        },
        financialStatement: {
          requestedSymbol: 'وغدير',
          requestedIssuerName: 'وغدير 14,630',
          reportKind: 'financial-statement',
          selectedReport: {
            symbol: 'وغدیر',
            title: 'اطلاعات و صورت‌های مالی (شرکت دیگر)'
          },
          selectedConfidence: 'low',
          selectedWarnings: ['عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند.'],
          candidates: []
        }
      }
    };

    expect(discoverySelectionNotice(result)).toBe('گزارش انتخاب‌شده با نماد/ناشر تطبیق داده شد.');
  });

  it('shows issuer warning when the selected report itself has warnings', () => {
    const result: CodalReportDiscoveryResult = {
      status: 'found',
      symbol: 'وغدیر',
      sourceVerified: false,
      checkedAt: '2026-07-01T00:00:00.000Z',
      monthlyActivityReport: {
        symbol: 'وغدیر',
        title: 'صورت وضعیت پرتفوی دوره 3 ماهه (شرکت دیگر)'
      },
      diagnostics: {
        requestedSymbol: 'وغدیر',
        monthlyActivity: {
          requestedSymbol: 'وغدیر',
          reportKind: 'monthly-activity',
          selectedReport: {
            symbol: 'وغدیر',
            title: 'صورت وضعیت پرتفوی دوره 3 ماهه (شرکت دیگر)'
          },
          selectedConfidence: 'medium',
          selectedWarnings: ['عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند.'],
          candidates: []
        }
      }
    };

    expect(discoverySelectionNotice(result)).toBe(
      'گزارش انتخاب‌شده ممکن است مربوط به ناشر دیگری باشد؛ تشخیص گزارش را بررسی کنید.'
    );
  });

  it('labels missing financial statements clearly', () => {
    expect(financialReportSummary(undefined)).toBe('صورت مالی معتبر برای ناشر پیدا نشد');
  });
});
