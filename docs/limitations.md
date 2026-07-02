# Limitations

This extension provides an estimate, not an audited valuation.

- User-entered financial statement inputs may be stale, incomplete, or incorrect.
- TSETMC page structure can change without notice, so symbol and price detection may fail.
- Current price may need manual entry when the page does not expose a reliable value.
- Unlisted portfolio surplus is usually judgment-based and may require independent valuation work.
- Corporate actions, capital increases, treasury shares, and post-report events are not automatically reconciled.
- Codal and TSETMC APIs are treated as unstable or non-official until documented and legally safe to use.
- No investment advice is provided.
- Codal report discovery and detail fetching are best-effort. The extension may detect table metadata and limited monthly portfolio suggestions, but it does not calculate NAV from Codal automatically.
- Codal discovery may fail because of endpoint changes, browser/network blocking, rate limits, or unexpected response shapes.
- Codal discovery failure is different from a successful `not found` result. On network, VPN, filtering, CORS, or temporary service failures, the UI should say the connection/check failed instead of showing report slots as `یافت نشد`.
- If a previous successful Codal discovery exists for the symbol, the extension may show it as stale cached data. Stale Codal suggestions are downgraded for manual review and are never auto-applied.
- Failed live Codal responses must not overwrite the last successful cached discovery or any manual/applied NAV inputs.
- Codal requests run through the extension background service worker. If the service worker is unavailable, asleep, or missing host permissions, the UI shows a safe warning and the manual calculator remains usable.
- Invalid detected symbols such as `TSETMC`, `InsCode:*`, `نماد نامشخص`, URLs, domains, or numeric-only values are intentionally not searched in Codal.
- A discovered Codal report link or title should be treated as a convenience reference, not a verified data source.
- Codal report selection uses best-effort symbol, issuer-name, title, report-type, and publish-date scoring. This can reject suspicious subsidiary reports, but it cannot prove issuer identity with audit-level certainty.
- Reports with different Codal symbols, weak issuer metadata, or titles referencing another company in parentheses may be ignored or marked suspicious. Users should review selection diagnostics when expected reports are missing.
- Generic clarification letters may appear in search results; they are downgraded and should not be treated as audited financial statements without manual review.
- Equity suggestions require a valid issuer-level financial statement. If no such report is selected, the UI should show `حقوق صاحبان سهام از کدال قابل استخراج نبود؛ صورت مالی معتبر برای ناشر پیدا نشد.` instead of using a suspicious or subsidiary report.
- Consolidated financial statements can differ from standalone issuer-level values; any consolidated equity suggestion is shown with a manual-review warning.
- Total-share suggestions are only safe when a source explicitly labels total shares. The extension does not infer share count from capital, trade volume, trade count, free float, base volume, or market activity fields.
- Codal report detail fetching may cache raw HTML or JSON locally in `chrome.storage.local`; this content is not sent to any external server by the extension.
- Detected Codal tables may come from HTML, JSON, script-embedded data, or Codal cell-model arrays. Row and column counts or header previews do not imply the report format is fully supported for value extraction.
- Some Codal search results expose an `ExcelUrl`. The extension can try that selected-report resource through the background service worker, but it only supports accessible table-like HTML, JSON, CSV, or tab-separated text. Binary spreadsheet downloads, CORS/access restrictions, or blocked resources are reported as unsupported/unavailable instead of parsed.
- Excel resources can contain many technically parseable numbers that are not safe NAV inputs. The parser ranks candidates and shows only the best safe primary candidate per field. Competing market-value candidates, zero values, negative values, tiny raw values, duplicate candidates, and low-ranked Excel candidates are kept in diagnostics rather than shown as apply-ready values.
- A filtered manual-review section may expose some ambiguous listed market-value candidates, but these remain user-reviewed choices rather than reliable recommendations. Applying one requires explicit confirmation and can still be wrong if the row, column, unit, period, or report context is misunderstood.
- If ExcelUrl is blocked by Chrome, Codal, VPN/network routing, or missing permissions, the UI should show `ExcelUrl به‌دلیل محدودیت CORS/دسترسی افزونه قابل بررسی نبود.` and keep NAV inputs manual.
- Listed portfolio market value may not exist in every monthly report or Excel resource. When `ارزش بازار` / `ارزش روز` labels are not found, the field stays manual and NAV remains incomplete.
- Codal cell-model reconstruction groups cells by meta table and rebuilds matrices from row/column coordinates or A1-style addresses. Missing coordinates, duplicate coordinates, merged-cell layouts, or unexpected row/column sequences can still produce incomplete previews or downgraded suggestions.
- If a Codal detail page is PDF-like, empty, blocked, or shaped differently from supported table patterns, the UI should explain that no supported table was detected.
- Unsupported Codal report formats are expected and should not block manual NAV calculations.
- Codal monthly parser outputs are suggestions only and can be wrong when labels are ambiguous, report formats vary, units differ, numbers are malformed, or tables contain totals/subtotals in unexpected places.
- Parser diagnostics expose raw and normalized previews of public Codal table content to help review labels, row alignment, and candidate values; the preview is not proof that the extracted value is correct.
- Parser diagnostics are visible in the widget/popup and can be copied as JSON or compact Markdown/text table-preview output. If browser clipboard access is unavailable, the extension shows a textarea fallback for manual copy.
- Diagnostics include public Codal report metadata, report-selection diagnostics, detected raw/normalized table headers, first raw/normalized rows, Codal cell-model reconstruction metadata when available, candidate labels, rejected candidates, and failure reasons. They do not include manual NAV inputs.
- Numeric extraction prefers clear total rows such as `جمع`, `جمع کل`, `مجموع`, and `مانده پایان دوره`. Multiple total rows, duplicate candidates, or unclear labels are intentionally downgraded.
- For reconstructed investment tables with multi-row headers, the parser prefers columns matching the report period and rejects prior-year columns from the main current-period suggestion. Zero aggregate candidates are rejected when a non-zero aggregate candidate exists.
- The parser recognizes explicit unit hints such as `ریال`, `هزار ریال`, `میلیون ریال`, and `میلیون تومان`. If the unit is unclear, it keeps the raw value, adds a warning, and avoids high-confidence bulk apply.
- The parser preserves empty cells inside detected rows to keep Codal cost/market columns aligned, but unusual merged-cell layouts can still confuse extraction.
- The parser does not infer missing units, audit restatements, capital increases, or post-report adjustments.
- Unlisted portfolio surplus suggestions are low confidence because they are derived from reported cost and estimated values and may not match the project’s NAV assumptions.
- Parsed Codal values never overwrite manual inputs automatically.
- Applying equity alone or total shares alone does not complete NAV. NAV total still requires equity, listed portfolio market value, listed portfolio cost value, and unlisted portfolio surplus to be present.
- Blank manual inputs are treated as missing values, not real zero values. Users must type `0` when a field is intentionally zero.
- The guided NAV completion workflow distinguishes missing values, manual values, suggestion-applied values, reviewed suggestions, legacy values, and user-confirmed zero values. It is an audit aid, not a guarantee that the value is correct.
- `ثبت صفر با تأیید من` is available for fields such as unlisted portfolio surplus when the user intentionally wants to store zero. Default blank fields are still missing and are not silently converted to zero.
- `تأیید بررسی دستی` only marks an applied suggestion as reviewed by the user; it does not verify the external report or change the numeric value.
- Legacy records that only contain default-looking `0` values without manual or Codal source metadata are treated as missing values during loading/migration.
- Applying a partial Codal suggestion, such as listed portfolio cost without listed portfolio market value, can make the NAV arithmetic negative or incomplete. The UI marks these cases as incomplete or needing manual review instead of treating the result as final.
- Incomplete NAV is not shown as a final numeric estimate. NAV total, NAV/share, and P/NAV remain unavailable until required inputs are present.
- Applying all suggestions only applies high-confidence, mappable fields. Low-confidence and ambiguous values require individual review.
- Manually reviewed Excel market values are stored with `codal-excel-manual-review` metadata and can be reset like other Codal-applied values. They never auto-apply and do not complete NAV unless all required manual fields are present.
- Codal resources may load differently with VPN on/off or other network routing changes. The extension should fail gracefully, keep diagnostics visible, and leave the manual calculator usable.
- Source metadata is an audit aid, not proof that a parsed value is correct.
- The TSETMC widget reuses a stable root element to avoid duplicate NAV widgets and duplicate disclaimers during rerenders. Some unusual client-side navigation behavior on TSETMC may still require a manual page reload if the host page replaces major DOM sections unexpectedly.

## Real TSETMC Page Notes

Observed on a live TSETMC instrument page such as `https://www.tsetmc.com/instInfo/778253364357513`:

- Current TSETMC symbol pages use `/instInfo/{InsCode}` URLs, so the URL alone usually provides an InsCode, not the ticker symbol.
- The ticker symbol is more reliably found in the header pattern like `Company Name (SYMBOL)`.
- TSETMC pages include short UI labels such as `خرید`, `فروش`, `پرتفوی`, and `نمودار`; symbol detection must reject these labels and avoid broad full-page short-word scans.
- Price rows can be compact with no separator, for example `آخرین معامله1,255...` and `قیمت پایانی1,256...`; parsers must read the first number after a known label.
- Price detection must tokenize numeric candidates instead of parsing whole panels. Whole-panel parsing can concatenate values such as `17,070 16,090` into an invalid number.
- Latest trade (`آخرین معامله`) is preferred over closing price (`قیمت پایانی`). If neither label yields one reliable value, the extension leaves price manual instead of guessing.
- TSETMC pages include large AG Grid style blocks in text content, so broad page-text parsing can pick up unrelated numbers.
- `https://cdn.tsetmc.com/api` may be blocked by the browser, profile extensions, network policy, or endpoint changes; DOM fallback and manual price entry must remain available.

Additional smoke testing on 2026-06-28 checked public TSETMC pages for `وغدیر`, `وصندوق`, `وبانک`, `خگستر`, and `وامید`:

- `/instInfo/{InsCode}` pages loaded publicly and exposed visible header/title, latest price, closing price, last price timestamp, and total shares text.
- The automation environment could not visit `chrome://extensions/`, so loading `dist/` as an unpacked extension must be completed manually in Chrome for a final installed-extension UI check.
- Because the extension was not loaded through `chrome://extensions/` during this automated smoke test, widget injection, manual-input persistence, and reload restoration could not be fully verified in the live browser session.
- The content script should continue to show explicit fallback states when symbol, price, or Codal reports cannot be detected.

## Real Codal Notes

Observed during limited public Codal smoke testing on 2026-06-28:

- `search.codal.ir` returned report metadata for sample symbols when Arabic/Persian ticker variants were used.
- The endpoint rejected `Length=20` with HTTP 400 and described `Length` as a value from `-1` to `12`; this appears to be a period-length filter rather than a result count.
- Search results can include subsidiary reports and annual board activity reports, so the extension must not treat every `گزارش فعالیت` title as a monthly activity report.
- Codal detail pages can be large legacy HTML pages. Table extraction must remain defensive and failures must leave the manual NAV calculator usable.
- Some Codal pages expose data inside script variables or JSON-like row/cell structures rather than visible HTML tables. The extension detects a limited set of these shapes, but unsupported structures should produce warnings instead of guesses.

The MVP avoids aggressive scraping and does not run scheduled background collection.

## Smoke-Test and Unsupported-Symbol Notes

- Unsupported or non-holding symbols, such as ordinary operating companies, may not have portfolio/NAV inputs in Codal. In that case the widget should keep price/basic info and manual inputs available while showing `داده کافی برای محاسبه NAV هلدینگی پیدا نشد.` or `این نماد احتمالاً هلدینگ/سرمایه‌گذاری نیست یا داده کافی برای NAV هلدینگی پیدا نشد.`
- Non-holding symbols are supported only as a manual calculator and basic TSETMC-info workflow unless portfolio/NAV-specific data is found.
- Financial reports that name another company in parentheses are not treated as issuer-level financial reports unless the parenthetical company strongly matches the requested issuer/report company. These candidates remain available in report-selection diagnostics and smoke-summary rejection fields.
- Holding support classification is heuristic. It uses instrument-name hints, portfolio report titles, parser portfolio values, and parser table labels. It should not treat a generic monthly activity report alone as proof that the issuer is a holding/investment company.
- The compact smoke-test summary is intended for regression review. It includes selected status, source, completion, and candidate counts, but intentionally excludes raw Codal table previews and large rejected-candidate payloads.
- Equity suggestions are hard-gated to explicit total-equity rows. Rows for retained earnings, capital, reserves, treasury share premium/discount, or transfers between equity components are ignored even if they contain the words `حقوق صاحبان سهام` or `حقوق مالکانه`.
