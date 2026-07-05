# Smoke Tests

This checklist captures the current real-world expectations for the MVP before release.

## Commands

Run these before packaging or manual Chrome testing:

```bash
npm run lint
npm run test
npm run build
npm run validate:manifest
npm run validate:content-scripts
```

## Internal Alpha Smoke Matrix

Use these symbols before handing an alpha build to manual testers. Live Codal/TSETMC availability can vary by network/VPN state, so the expected behavior includes cache/error states as valid outcomes when clearly labeled.

| Symbol | holdingSupport | currentPrice | Codal discovery/cache | monthlyReport | financialReport | Candidate availability | NAV completion | User action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| وصندوق | `likely-holding` | TSETMC latest trade when visible; otherwise manual fallback | `found` when live works, or clearly labeled `stale-cache`/`unavailable-network-error` | High confidence monthly activity report | Issuer-level or consolidated financial report may appear when strongly matched | Cost and TSETMC total-share suggestions may appear; market candidates require manual review | Incomplete until equity, listed market value, cost, unlisted surplus, and shares are complete/reviewed | Apply suggestions only by explicit click; review Excel market candidates manually |
| وغدیر / وغدير | `likely-holding` | TSETMC latest trade when visible; Arabic/Persian symbol variants normalize | `found` or clearly labeled cache/network state | High confidence monthly activity report | Show no valid issuer financial report unless strongly matched; subsidiary/other-company reports stay diagnostics-only | Cost and TSETMC total-share suggestions may appear; market candidates require manual review | Incomplete until missing manual inputs/reviewed market value exist | Confirm report selection and manually review market candidates |
| شستا | `likely-holding` | TSETMC latest trade when visible | `found` or clearly labeled cache/network state | High confidence monthly activity report; no false issuer warning on exact/strong match | May be unavailable or no-valid if issuer-level validation is weak | Cost and TSETMC total-share suggestions may appear; market candidates require manual review | Incomplete until required NAV fields are present | Check diagnostics if financial report is unavailable |
| وبانک | `likely-holding` | TSETMC latest trade when visible | `found` or clearly labeled cache/network state | High confidence monthly activity report when live metadata matches | Financial report may appear when issuer-level validation is strong | Cost and TSETMC total-share suggestions may appear; equity only from a strong total-equity row; market candidates require manual review | Incomplete until market value/equity/unlisted surplus are provided or reviewed | Verify units, period, and row labels before applying |
| وامید | `likely-holding` | TSETMC latest trade when visible | `found` or clearly labeled cache/network state | High confidence monthly activity report when live metadata matches | Financial report may appear when issuer-level validation is strong | Cost and TSETMC total-share suggestions may appear; no bogus equitySuggestion from component rows; market candidates may be hidden/ambiguous | Incomplete until required inputs are complete | Review parser diagnostics for hidden/ambiguous market candidates |
| فولاد | `unknown` or `unsupported` for holding NAV | Current price/basic TSETMC info may show | Codal may be checked, but holding NAV support should remain unknown/unsupported unless strong NAV data exists | Monthly report may exist but should not imply holding NAV support alone | Subsidiary/other-company financial reports must not be valid issuer-level reports | No misleading NAV candidates; total shares/basic info may still show | Manual calculator remains usable; NAV incomplete unless user enters fields | Manual-only NAV use; review diagnostics for rejected subsidiary reports |
| فملی | `unknown` or `unsupported` for holding NAV | Current price/basic TSETMC info may show | Codal may be checked, but generic parser labels are not enough for holding support | Monthly report may exist but should not imply holding NAV support alone | Issuer financial diagnostics may show only if strongly validated | Generic investment/portfolio labels alone must not produce likely-holding or NAV candidates | Manual calculator remains usable; NAV incomplete unless user enters fields | Manual-only NAV use unless strong portfolio/NAV candidates exist |

## Compact Smoke Summary

Use `کپی خلاصه Smoke Test` after Codal checks finish. Wait until `جزئیات آخرین گزارش` and `وضعیت تحلیل` show that report analysis completed before treating Smoke as final acceptance evidence. If Smoke is copied earlier, the JSON must explicitly show pending readiness.

Readiness fields:

- `smokeReadiness: "ready"` means detail fetch/parser work completed. Candidate fields can be used for manual acceptance review.
- `smokeReadiness: "pending"` means report detail fetch or parser work has not finished. This Smoke is incomplete and should not be used as final manual acceptance evidence.
- `smokeReadiness: "failed"` means detail fetch/parser work failed. Review connection/parser diagnostics before judging candidates.
- `smokeReadiness: "stale-cache"` means live Codal failed and a cached parser result is shown.
- `smokeReadiness: "no-report"` means no report was available or Codal discovery has not produced a report.

The copied JSON should include compact public/debug fields only:

- symbol, instrument name, InsCode, Codal symbol
- current price and source
- total shares and source
- monthly/financial report confidence and selected warnings
- financial report issuer-match status and rejection reason when a candidate is rejected or downgraded
- parser status, market-value status, manual-review candidate count
- extracted suggestion candidates
- NAV completion status and missing fields
- live fetch/cache status
- detail pipeline status: `not-started`, `fetching-detail`, `parsing`, `completed`, `failed`, or `stale-cache-used`
- parser data status: `live`, `stale-cache`, `unavailable-network-error`, or `not-attempted`
- candidate availability: `live-nav-candidates`, `live-basic-candidates-only`, `no-nav-candidates-live`, `stale-candidates`, `unavailable-network-error`, or `not-attempted`

For `وصندوق`, TSETMC-provided/applied total shares should appear as `totalSharesSource: "tsetmc-suggestion"` even if older saved metadata used `codal-suggestion` with `TSETMC instrument info`.

When live Codal fetch fails, check these fields carefully:

- `parserDataStatus: "stale-cache"` means live Codal failed but a compact parsed summary from the last successful run is being shown. Candidate counts and extracted candidates are stale and require manual review.
- `parserDataStatus: "unavailable-network-error"` means live Codal failed and no parsed summary cache was available. Empty candidates in this state mean "not checked", not "none exist".
- `parserDataStatus: "not-attempted"` should appear only before the detail/parser pipeline has completed. If reports were found, check `smokeReadiness`; `pending` means the tester copied too early.
- Smoke Summary recomputes `candidateAvailability` from the current parsed candidates. An older embedded parser diagnostic value must not make total-share-only output look like `live-nav-candidates`.
- `candidateAvailability: "live-basic-candidates-only"` means only basic suggestions such as total shares were found, not NAV portfolio/equity candidates.
- `candidateAvailability: "no-nav-candidates-live"` should appear only after a live parser run completed and found no NAV candidates.
- `candidateAvailability: "unavailable-network-error"` means live Codal failed and no parsed candidate result is available.
- Use `تلاش دوباره برای دریافت کدال` to retry live Codal. This must not clear manual values or applied suggestions.
- Use `کپی وضعیت اتصال کدال` for compact connection diagnostics: domain, live fetch status, cache use, attempt count, parser data status, and stale-cache usage.
- Expanded report/parser diagnostics should wrap or scroll inside the widget; they should not force horizontal scrolling on the host TSETMC page.
- The widget should remain Persian-first RTL/right-aligned. Numeric inputs, links, and copy fallback textareas may be LTR for readability.
- Resetting applied suggestions should immediately update field values, completion workflow, and candidate-card state without requiring a page reload.

Market-value review counts are split:

- `marketReviewVisibleCandidateCount`
- `marketReviewHiddenCandidateCount`
- `marketReviewRejectedCandidateCount`
- `marketReviewTotalCandidateCount`

The legacy `marketReviewCandidateCount` means visible/reviewable candidates only.

The compact summary should not include raw Codal tables, full table previews, or large rejected-candidate payloads. Use `کپی تشخیص Parser` or report-selection diagnostics for deep table/report debugging.

## Safety Invariants

- Manual inputs remain the source of truth.
- The guided completion workflow must distinguish missing, manual, suggestion-applied, reviewed, stale/legacy, and user-confirmed zero values.
- Codal/TSETMC/Excel values are suggestions only and are never auto-applied.
- Equity and total-share suggestions require explicit user apply actions and do not make NAV complete by themselves.
- Ambiguous listed market-value candidates require explicit manual review/confirmation and do not become reliable or bulk-applied suggestions.
- Low-confidence, ambiguous, rejected, subsidiary, or clarification reports stay out of main apply-ready UI.
- Unsupported/non-holding symbols keep the calculator usable and show a clear limitation message.
- Non-holding symbols are supported as basic-info/manual-calculator targets only unless portfolio/NAV-specific data is found.
- Subsidiary or other-company financial reports must stay out of the issuer-level financial report slot and should appear only in diagnostics/smoke-summary rejection fields.
- Equity suggestions require a valid issuer-level financial statement, a balance-sheet/financial-position table, and a strict aggregate row such as `جمع حقوق صاحبان سهام`, `جمع حقوق مالکانه`, or an attributable-to-parent equity total. Component rows such as retained earnings, treasury share premium/discount, reserves, capital, or transfer rows must not become equity suggestions.
- Rows that combine equity with liabilities, such as `جمع حقوق صاحبان سهام و بدهی‌ها`, are not equity and must stay out of apply-ready suggestions.
- Equity suggestion units and periods must be manually verified. Unknown units or ambiguous current/prior-period columns should stay low confidence.
- Codal and Excel network requests stay in the MV3 background/service worker.
- Content scripts must not directly fetch `codal.ir`, `search.codal.ir`, or `excel.codal.ir`.
- Failed live Codal fetches must not clear the last successful cached discovery or make a connection failure look like a true no-report result.
