# Data Sources

## Current MVP

The extension is local-first and semi-manual:

- TSETMC page URL or DOM for best-effort symbol detection.
- TSETMC page DOM for best-effort current price detection.
- User-entered NAV inputs stored in `chrome.storage.local`.

Manual NAV inputs are not transmitted to any external service. Optional Codal/TSETMC lookups may send the searched symbol or InsCode to those public hosts when a feature calls the data clients.

## Future Candidates

Future integrations may include:

- Codal financial statements and portfolio reports.
- TSETMC instrument metadata and prices.
- User-imported spreadsheets or JSON files.

Any future automated source must be reviewed for legality, stability, attribution requirements, rate limits, and data quality. Until an endpoint is documented and reliable, it should be considered unstable/non-official.

## Codal Search Integration

The codebase includes a small Codal search client in `src/data/codal-client.ts`.

It uses the public search host currently observed at `https://search.codal.ir/api/search/v2/q` to search reports by symbol, then filters report titles to find the latest monthly activity report or latest financial statement. This endpoint is not treated as an official stable API. It may change, rate-limit clients, return different JSON fields, or stop working without notice.

Current safeguards:

- No financial values are parsed from Codal reports yet.
- No single report URL is hardcoded.
- Requests use a timeout and retry limit.
- Successful responses are cached in `chrome.storage.local`.
- Errors include the failed HTTP status, timeout, or retry exhaustion context.

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
