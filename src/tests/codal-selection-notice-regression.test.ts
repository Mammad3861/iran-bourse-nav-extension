import { describe, expect, it } from 'vitest';
import type { CodalReportDiscoveryResult, CodalReportSelectionCandidate } from '../data/codal-client';
import { discoverySelectionNotice } from '../ui/codal-display-utils';

function selectedReportResult(extraCandidates: CodalReportSelectionCandidate[] = []): CodalReportDiscoveryResult {
  return {
    status: 'found',
    symbol: 'شستا',
    sourceVerified: false,
    checkedAt: '2026-07-01T00:00:00.000Z',
    monthlyActivityReport: {
      symbol: 'شستا',
      title: 'گزارش فعالیت ماهانه دوره ۱ ماهه منتهی به ۱۴۰۵/۰۳/۳۱'
    },
    diagnostics: {
      requestedSymbol: 'شستا',
      monthlyActivity: {
        requestedSymbol: 'شستا',
        reportKind: 'monthly-activity',
        selectedReport: {
          symbol: 'شستا',
          title: 'گزارش فعالیت ماهانه دوره ۱ ماهه منتهی به ۱۴۰۵/۰۳/۳۱'
        },
        selectedConfidence: 'high',
        selectedWarnings: [],
        candidates: extraCandidates
      }
    }
  };
}

describe('report-selection notice regressions', () => {
  it('does not turn rejected-candidate warnings into a main issuer warning', () => {
    const cleanNotice = discoverySelectionNotice(selectedReportResult());
    const noisyRejectedCandidate: CodalReportSelectionCandidate = {
      report: {
        symbol: 'شستا',
        title: 'گزارش مشکوک رد شده (شرکت دیگر)'
      },
      score: -20,
      selected: false,
      reasons: [],
      warnings: ['عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند.'],
      rejectedReasons: ['گزارش به دلیل عدم تطابق نماد/ناشر نادیده گرفته شد.']
    };

    expect(discoverySelectionNotice(selectedReportResult([noisyRejectedCandidate]))).toBe(cleanNotice);
  });

  it('shows the warning only when the selected report itself has warnings', () => {
    const result = selectedReportResult();
    result.diagnostics!.monthlyActivity!.selectedWarnings = ['عنوان گزارش داخل پرانتز به شرکت/ناشر دیگری اشاره می‌کند.'];

    expect(discoverySelectionNotice(result)).not.toBe(discoverySelectionNotice(selectedReportResult()));
  });
});
