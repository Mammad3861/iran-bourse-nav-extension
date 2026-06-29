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
- Codal requests run through the extension background service worker. If the service worker is unavailable, asleep, or missing host permissions, the UI shows a safe warning and the manual calculator remains usable.
- Invalid detected symbols such as `TSETMC`, `InsCode:*`, `نماد نامشخص`, URLs, domains, or numeric-only values are intentionally not searched in Codal.
- A discovered Codal report link or title should be treated as a convenience reference, not a verified data source.
- Codal report detail fetching may cache raw HTML or JSON locally in `chrome.storage.local`; this content is not sent to any external server by the extension.
- Detected Codal tables may come from HTML, JSON, or script-embedded data. Row and column counts or header previews do not imply the report format is fully supported for value extraction.
- If a Codal detail page is PDF-like, empty, blocked, or shaped differently from supported table patterns, the UI should explain that no supported table was detected.
- Unsupported Codal report formats are expected and should not block manual NAV calculations.
- Codal monthly parser outputs are suggestions only and can be wrong when labels are ambiguous, report formats vary, units differ, numbers are malformed, or tables contain totals/subtotals in unexpected places.
- Parser diagnostics expose a small normalized preview of public Codal table content to help review labels and candidate values; the preview is not proof that the extracted value is correct.
- Numeric extraction prefers clear `جمع`/`جمع کل` rows. Multiple total rows, duplicate candidates, or unclear labels are intentionally downgraded to low confidence.
- The parser does not infer units, audit restatements, capital increases, or post-report adjustments.
- Unlisted portfolio surplus suggestions are low confidence because they are derived from reported cost and estimated values and may not match the project’s NAV assumptions.
- Parsed Codal values never overwrite manual inputs automatically.
- Applying all suggestions only applies high-confidence, mappable fields. Low-confidence and ambiguous values require individual review.
- Source metadata is an audit aid, not proof that a parsed value is correct.

## Real TSETMC Page Notes

Observed on a live TSETMC instrument page such as `https://www.tsetmc.com/instInfo/778253364357513`:

- Current TSETMC symbol pages use `/instInfo/{InsCode}` URLs, so the URL alone usually provides an InsCode, not the ticker symbol.
- The ticker symbol is more reliably found in the header pattern like `Company Name (SYMBOL)`.
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
