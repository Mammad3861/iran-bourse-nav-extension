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

## Smoke Matrix

| Symbol | Expected classification | Key checks |
| --- | --- | --- |
| وصندوق | likely-holding | Symbol and Codal symbol are `وصندوق`; current price is read or cleanly left manual; monthly report is high confidence; issuer-level financial report is valid when available; cost suggestion `136,494,769` appears; Excel market value remains ambiguous and not auto-applied; NAV stays incomplete until required manual fields exist. |
| وغدیر / وغدير | likely-holding | Arabic/Persian `ی/ي` variants normalize; monthly report is high confidence and matched; no false issuer warning when selected warnings are empty; subsidiary financial statements such as Iran Marine Services are not shown in the main financial slot; cost suggestion `275,218,935` appears; Excel market value remains ambiguous. |
| شستا | likely-holding or unknown, depending on live Codal shape | Holding-like name should prevent unsupported classification; exact monthly report symbol match should avoid false issuer warnings even if TSETMC issuer text is weak; selected-report warnings should appear only when attached to the selected report, while rejected candidate warnings remain diagnostics-only. |
| وبانک | likely-holding or unknown, depending on live Codal shape | Price/basic TSETMC info should work; Codal discovery should prefer exact symbol/issuer reports; if portfolio values are absent or ambiguous, no NAV value should be invented. |
| وامید | likely-holding or unknown, depending on live Codal shape | Same checks as وبانک; report selection diagnostics should explain selected/rejected reports and Excel/source strategy. |
| فولاد or فملی | unsupported or unknown | The widget should still show price/basic info and keep the manual calculator usable. It should show `این نماد احتمالاً برای محاسبه NAV هلدینگی پشتیبانی نمی‌شود یا داده کافی ندارد. محاسبه دستی همچنان ممکن است.` instead of implying holding NAV support. Subsidiary financial reports must not be treated as high-confidence issuer-level reports. |

## Compact Smoke Summary

Use `کپی خلاصه Smoke Test` after Codal checks finish. The copied JSON should include compact public/debug fields only:

- symbol, instrument name, InsCode, Codal symbol
- current price and source
- total shares and source
- monthly/financial report confidence and selected warnings
- financial report issuer-match status and rejection reason when a candidate is rejected or downgraded
- parser status, market-value status, manual-review candidate count
- extracted suggestion candidates
- NAV completion status and missing fields
- live fetch/cache status
- parser data status: `live`, `stale-cache`, or `unavailable-network-error`
- candidate availability: `live-candidates`, `stale-candidates`, `unavailable`, or `none-found-live`

For `وصندوق`, TSETMC-provided/applied total shares should appear as `totalSharesSource: "tsetmc-suggestion"` even if older saved metadata used `codal-suggestion` with `TSETMC instrument info`.

When live Codal fetch fails, check these fields carefully:

- `parserDataStatus: "stale-cache"` means live Codal failed but a compact parsed summary from the last successful run is being shown. Candidate counts and extracted candidates are stale and require manual review.
- `parserDataStatus: "unavailable-network-error"` means live Codal failed and no parsed summary cache was available. Empty candidates in this state mean "not checked", not "none exist".
- `candidateAvailability: "none-found-live"` should appear only after a live parser run completed and found no candidates.
- Use `تلاش دوباره برای دریافت کدال` to retry live Codal. This must not clear manual values or applied suggestions.
- Use `کپی وضعیت اتصال کدال` for compact connection diagnostics: domain, live fetch status, cache use, attempt count, parser data status, and stale-cache usage.

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
- Equity suggestions require a strict aggregate row such as `جمع حقوق صاحبان سهام`, `جمع حقوق مالکانه`, or `حقوق صاحبان سهام`. Component rows such as retained earnings, treasury share premium/discount, reserves, capital, or transfer rows must not become equity suggestions.
- Codal and Excel network requests stay in the MV3 background/service worker.
- Content scripts must not directly fetch `codal.ir`, `search.codal.ir`, or `excel.codal.ir`.
- Failed live Codal fetches must not clear the last successful cached discovery or make a connection failure look like a true no-report result.
