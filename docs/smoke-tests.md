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

## وصندوق

- TSETMC symbol: `وصندوق`
- Codal symbol: `وصندوق`
- Current price should be detected or cleanly left manual.
- Monthly Codal report should be selected with high confidence.
- Financial report should be valid when an issuer-level financial statement is available.
- Monthly report detail and ExcelUrl should be fetched when available.
- Parser should suggest `listedPortfolioCostValue = 136,494,769`.
- If a valid issuer-level financial statement is available, equity may appear only as a reviewable suggestion.
- If TSETMC exposes total shares, it may appear only as a reviewable suggestion.
- `listedPortfolioMarketValue` from Excel should be marked ambiguous when multiple candidates compete.
- Ambiguous market values must stay diagnostics-only and must not be auto-applied.
- NAV should remain incomplete until required manual fields are provided.
- The UI must not show a misleading negative NAV when NAV is incomplete.
- If live Codal discovery fails, monthly/financial slots should say the check failed because of connection/access, not `یافت نشد`. If stale cache is shown, it must be clearly marked stale.

## وغدیر

- TSETMC may expose `وغدير`; Codal/report data may use `وغدیر`.
- Persian/Arabic `ی/ي` normalization must match these symbols.
- Monthly Codal report should be selected with high confidence.
- The selection notice should say the report matched symbol/issuer.
- The main financial report section should show `صورت مالی معتبر برای ناشر پیدا نشد` if only subsidiary, clarification, or other-company financial reports are available.
- Subsidiary reports such as `شرکت ایران مارین سرویسز` must remain in diagnostics only and must not appear in the main financial report slot.
- ExcelUrl should be fetched when available.
- Parser should suggest `listedPortfolioCostValue = 275,218,935`.
- If only subsidiary or invalid financial statements are available, no equity suggestion should be created from those reports.
- If TSETMC exposes total shares, it may appear only as a reviewable suggestion.
- `listedPortfolioMarketValue` from Excel should be marked ambiguous when multiple candidates compete.
- Ambiguous market values must stay diagnostics-only and must not be auto-applied.
- NAV should remain incomplete until required manual fields are provided.
- If live Codal discovery fails, any previous Codal data must be shown only as stale cached data and must not overwrite manual/applied inputs.

## Safety Invariants

- Manual inputs remain the source of truth.
- Codal suggestions are never auto-applied.
- Equity and total-share suggestions require explicit user apply actions and do not make NAV complete by themselves.
- Low-confidence, ambiguous, rejected, subsidiary, or clarification reports stay out of main apply-ready UI.
- Codal and Excel network requests stay in the MV3 background/service worker.
- Content scripts must not directly fetch `codal.ir`, `search.codal.ir`, or `excel.codal.ir`.
- Failed live Codal fetches must not clear the last successful cached discovery or make a connection failure look like a true no-report result.
