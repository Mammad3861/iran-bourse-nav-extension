import { describe, expect, it } from 'vitest';
import type { CodalSourceStrategyDiagnostics } from '../data/codal-client';
import { compactParserWarnings, marketValueStatusText, sourceStrategySummaryText } from '../ui/codal-display-utils';

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
});
