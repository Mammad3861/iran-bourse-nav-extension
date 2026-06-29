# Data Sources

## Current MVP

The extension is local-first and semi-manual:

- TSETMC page URL or DOM for best-effort symbol detection.
- TSETMC page DOM for best-effort current price detection.
- User-entered NAV inputs stored in `chrome.storage.local`.

Manual NAV inputs are not transmitted to any external service. Optional Codal/TSETMC lookups may send the searched symbol or InsCode to those public hosts when a feature calls the data clients.

Codal network requests are performed by the Manifest V3 background service worker through typed `chrome.runtime.sendMessage` requests. TSETMC content scripts do not fetch Codal directly, which avoids page-origin CORS failures from `https://www.tsetmc.com`.

## Future Candidates

Future integrations may include:

- Codal financial statements and portfolio reports.
- TSETMC instrument metadata and prices.
- User-imported spreadsheets or JSON files.

Any future automated source must be reviewed for legality, stability, attribution requirements, rate limits, and data quality. Until an endpoint is documented and reliable, it should be considered unstable/non-official.

## Codal Search Integration

The codebase includes a small Codal search client in `src/data/codal-client.ts`.

It uses the public search host currently observed at `https://search.codal.ir/api/search/v2/q` to search reports by symbol, then ranks candidate reports before choosing a monthly activity/portfolio-status report or financial statement. Ranking prefers exact symbol matches, strong issuer/company-name matches when TSETMC provides an issuer name, relevant report titles, expected report types, and publish date. This endpoint is not treated as an official stable API. It may change, rate-limit clients, return different JSON fields, or stop working without notice.

Live smoke testing on 2026-06-28 found:

- Codal symbol search can be sensitive to Persian/Arabic letter variants, especially `ی/ي` and `ک/ك`. The client tries a small set of normalized variants and stops after the first successful result set.
- Codal's `Length` query parameter behaves like a report-period filter, not a page-size limit. The client uses `Length=-1` to avoid unintentionally filtering out report periods while still requesting only the first result page.
- Top search results for holding companies can include subsidiary reports or annual board activity reports. Title filtering must stay conservative and metadata should remain unverified until the user reviews it.
- Report selection diagnostics are generated for each candidate so users can inspect score, selected/rejected state, and reasons such as symbol mismatch, weak issuer match, suspicious parenthetical company names, or clarification-letter fallback.

Current safeguards:

- Financial values parsed from Codal monthly/portfolio reports are suggestions only and are never applied automatically.
- No single report URL is hardcoded.
- Content scripts do not call Codal endpoints directly; they ask the background service worker to perform Codal discovery/detail requests.
- Symbols are validated before Codal search. Empty values, `TSETMC`, `InsCode:*`, unknown labels, domains, URLs, numeric-only values, and English site labels are not searched.
- Candidate reports are ranked and can be rejected when the Codal symbol, company metadata, or title appears to reference a different issuer/subsidiary.
- Clarification letters are not treated as strong financial-statement substitutes; if used as a fallback, they are marked low confidence in diagnostics.
- In-flight background requests are reused per symbol/report to avoid duplicate page-load bursts.
- Requests use a timeout and retry limit.
- Successful responses are cached in `chrome.storage.local`.
- Errors include the failed HTTP status, timeout, or retry exhaustion context.
- UI result states are explicit: loading, found, not found, or failed.
- The widget and popup show report metadata only: title, date, and link/id when available.
- Manual NAV inputs remain the source of truth for all NAV calculations.

## Codal Report Detail Foundation

The Codal client can fetch a discovered report detail page by URL, report id, or tracing number when available. The response is normalized into an internal detail object containing:

- Source URL.
- Symbol, title, publish date, tracing number, and report id when available.
- Detected content type: HTML, JSON, or unknown.
- Raw HTML or raw JSON.
- A short plain-text preview with Persian/Arabic digits normalized.
- Detected table metadata such as table count, row count, column count, captions, headers, header previews, and the detection source.
- Normalized extracted table rows when available.
- Parser warnings when a response is empty, PDF-like, unsupported JSON, or has no supported table shape.
- Fetch timestamp.

The parser foundation is intentionally conservative. It strips scripts/styles before text extraction and detects table-like structures without relying on a single CSS selector. Supported detail shapes include regular HTML `<table>` elements, limited repeated row/cell HTML structures, JSON table arrays, JSON cell arrays, and script-embedded JSON table data. Unsupported shapes are reported as safe warnings instead of guessed values.

## Limited Monthly Activity Parser

The codebase includes a cautious parser in `src/data/codal-monthly-parser.ts` for Codal monthly activity reports of investment and holding companies.

It may suggest these candidate values when labels and tables are clear enough:

- Listed portfolio cost value.
- Listed portfolio market/day value.
- Unlisted portfolio cost value.
- Unlisted portfolio estimated value.
- A low-confidence unlisted surplus suggestion when both unlisted cost and estimated value are present.
- Report period/date when detectable from the title or preview.

For detected tables, the parser also exposes diagnostics for review:

- Table index and caption/title when available.
- First headers and first rows after normalization.
- A normalized text preview.
- Detected Persian labels and parser warnings.
- Candidate value row/column indexes and a confidence reason.

These values are suggestions only. The widget can copy supported suggestions into manual fields only after the user clicks an explicit apply action. No parsed value is applied automatically, and no parsed value is used for NAV calculation unless the user manually accepts or edits it.

When a suggestion is applied, the saved manual override records source metadata for that field:

- source: `codal-suggestion`
- applied timestamp
- source report title/date
- confidence level
- applied value

If the user later edits that field manually, the field source is marked back to `manual`.

The parser supports Persian and Arabic digit normalization, comma-separated numbers, parenthesized negative values, explicit unit hints, total rows such as `جمع`, `جمع کل`, `مجموع`, `مانده پایان دوره`, and `سرمایه گذاری ها`, and common Persian labels such as `بهای تمام شده`, `مبلغ تمام شده`, `ارزش بازار`, `ارزش روز`, `مبلغ بازار`, `پذیرفته شده در بورس`, `خارج از بورس`, `پرتفوی بورسی`, and `پرتفوی غیر بورسی`.

Supported unit hints currently include `ریال`, `هزار ریال`, `میلیون ریال`, and `میلیون تومان`. If the table unit is unclear, the parser keeps the raw numeric value, downgrades confidence, and attaches a warning instead of silently scaling the value.

Codal row alignment is preserved during table normalization, including empty cells inside rows. This is important because many monthly activity tables contain blank cells, and dropping those cells can shift cost and market-value columns.

Confidence is intentionally conservative:

- High confidence requires a portfolio table, exact value label, one usable total row, and one valid numeric value.
- Medium confidence is used for likely labels/tables or unlisted values that still require review.
- Low confidence is used for ambiguous labels, duplicate candidates, multiple total rows, or derived surplus values. Low-confidence values are shown for review but are not included in bulk apply actions.

Detail fetch states are explicit:

- `fetched`
- `unavailable`
- `unsupported-format`
- `network-error`
- `timeout`

If Codal publishes official API documentation, the client should be updated to follow that contract and this document should link to the official source.

## TSETMC Data Integration

The codebase includes a TSETMC client in `src/data/tsetmc-client.ts`.

It uses the public JSON host currently observed at `https://cdn.tsetmc.com/api` for:

- Symbol search: `/Instrument/GetInstrumentSearch/{query}`
- Instrument identity/info by InsCode: `/Instrument/GetInstrumentInfo/{insCode}`
- Latest price and closing price: `/ClosingPrice/GetClosingPriceInfo/{insCode}`

These endpoints are treated as unofficial and unstable. They may change response shape, rate-limit requests, fail for some instruments, or disappear without notice. The extension therefore keeps DOM extraction as a fallback for current price on TSETMC pages and keeps all fetched responses local.

Current safeguards:

- Requests use a timeout and retry limit.
- Successful responses are cached in `chrome.storage.local`.
- Errors include HTTP status, timeout, and retry exhaustion context.
- DOM extraction remains available when price fetching fails on an open TSETMC page.
- No aggressive background scraping is performed.

## Data Quality Notes

NAV estimates should include the report date, source, and manual assumptions. For public release, prefer explicit user confirmation over silent automated updates when a data source changes shape.
