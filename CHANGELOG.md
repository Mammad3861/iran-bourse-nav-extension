# Changelog

## 0.1.0-alpha.3

### Added

- Safer equity extraction from valid issuer-level Codal financial statements.
- Conservative `equitySuggestion` candidates from true total-equity rows only.
- Smoke Summary `equitySource` when an equity suggestion is applied.
- Smoke Summary readiness fields for pending, ready, failed, stale-cache, and no-report parser states.
- Compact widget progress state for Codal detail fetch and parser completion.
- Compact `financialEquityExtraction` diagnostics in Smoke Summary.
- Manual-only NAV smoke workflow and no-Codal fallback guidance.

### Changed

- Rejects component equity rows and liabilities-plus-equity totals as equity suggestions.
- Downgrades consolidated, unknown-unit, or period-ambiguous equity candidates for manual review.
- Marks early Smoke copies as pending instead of silently showing incomplete not-attempted parser output.
- Exposes financial balance-sheet table, rejected row, rejected column, unit, and selected-candidate diagnostics for equity extraction.
- Keeps manual NAV calculation and Smoke Summary source fields useful when live Codal is unavailable.

## 0.1.0-alpha.1

Internal alpha release for manual testing. This is not a public or Chrome Web Store release.

### Added

- Manual local NAV and P/NAV calculator with Persian RTL UI.
- Per-symbol local storage in `chrome.storage.local`.
- TSETMC symbol, InsCode, current price, and basic instrument detection.
- TSETMC latest-trade current price extraction with manual fallback.
- TSETMC total shares suggestion when instrument info exposes a reliable value.
- Codal report discovery through the MV3 background/service worker.
- Defensive Codal report selection with issuer/symbol matching and subsidiary-report rejection.
- Codal monthly activity report detail fetching and table detection.
- Codal cell-model table reconstruction for supported report shapes.
- Limited Codal monthly parser for listed portfolio cost and related candidate values.
- ExcelUrl fetching through the background/service worker when available.
- Excel manual-review market-value candidates for ambiguous listed portfolio market value.
- Conservative financial statement parsing foundation for equity suggestions.
- Guided NAV completion workflow for missing fields, applied suggestions, reviewed values, and explicit zero confirmation.
- Smoke Test Summary with compact diagnostics for symbol, price, report selection, candidates, completion, live/cache state, and parser data status.
- Holding/non-holding classification for internal smoke symbols such as `وصندوق`, `شستا`, `فولاد`, and `فملی`.
- Stale-cache and network status reporting for Codal discovery/parser failures.
- Copyable parser/report-selection/connection diagnostics.
- Manifest/content-script validation scripts.

### Safety Model

- Manual inputs remain the source of truth.
- Codal/TSETMC/Excel values are suggestions only.
- No suggestion is auto-applied.
- Low-confidence or ambiguous values require explicit manual review.
- Market value candidates from Excel are not treated as reliable primary values unless the user confirms one.
- Suspicious subsidiary/other-company financial reports are excluded from the main issuer-level financial report slot.

### Known Limitations

- Internal alpha only; not a public/store release.
- NAV output is a local estimate and not investment advice.
- Codal and TSETMC endpoints are unofficial/unstable and may fail or change shape.
- Excel resources may be unavailable, blocked, noisy, or ambiguous.
- Financial statement values may be consolidated, standalone, unaudited, restated, or unsuitable without review.
- Non-holding symbols may show only basic info and the manual calculator.
- Stale cache can preserve prior candidates during network failures, but stale data must be manually reviewed.
- Users must verify units, periods, issuer identity, row/column labels, and report context manually.
