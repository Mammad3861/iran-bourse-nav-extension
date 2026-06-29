# Iran Bourse NAV Extension

A public open-source Chrome Extension for estimating **NAV** and **P/NAV** of Iranian investment and holding companies listed on TSETMC.

The first version is intentionally **semi-manual**. It injects a small Persian RTL widget into TSETMC symbol pages, tries to detect the current symbol and price, lets the user edit NAV inputs, and stores values locally per symbol.

> This project is an estimate tool only. It is not financial advice.

## Features

* Chrome Extension Manifest V3
* TypeScript + Vite
* Persian RTL NAV widget
* Semi-manual NAV calculator
* Per-symbol local storage
* TSETMC page injection
* Defensive TSETMC and Codal data-client boundaries
* Codal report discovery and defensive report-detail table detection
* Limited Codal monthly activity parser with table diagnostics and suggested portfolio values
* Unit-tested NAV and parsing logic

## Formula

```text
NAV = Equity + (ListedPortfolioMarketValue - ListedPortfolioCostValue) + UnlistedPortfolioSurplus

NAV per share = NAV / TotalShares

P/NAV = CurrentPrice / NAVPerShare
```

## MVP Scope

The MVP focuses on a reliable local calculation flow before adding fragile automatic data extraction.

Current MVP behavior:

1. Injects a small NAV widget into TSETMC pages.
2. Detects the current symbol when possible.
3. Reads the current price when possible.
4. Lets the user enter or edit:

   * Equity
   * Listed portfolio market value
   * Listed portfolio cost value
   * Unlisted portfolio surplus
   * Total shares
   * Current price
5. Calculates:

   * Total NAV
   * NAV per share
   * P/NAV
6. Stores values locally per symbol.
7. Shows Codal report metadata and limited suggested values when available.
8. Requires explicit user action before any suggestion is copied into manual inputs.
9. Stores source metadata when a Codal suggestion is user-applied, and marks the field manual again after manual edits.

## Privacy and Safety

* Manual NAV inputs are not sent to any external server by this extension.
* All calculations run locally in the browser.
* User inputs are stored in `chrome.storage.local`.
* The extension does not scrape aggressively.
* Optional TSETMC/Codal lookups may send only the searched symbol, InsCode, or report URL/id to those public hosts.
* Codal requests are routed through the MV3 background service worker, not directly from TSETMC content scripts.
* Invalid detected symbols such as `TSETMC`, `InsCode:*`, unknown labels, URLs, domains, or numeric-only values are not searched in Codal.
* Codal and TSETMC integrations should be treated as unstable until verified against live pages.
* Codal detail parsing is best-effort and only produces reviewable suggestions; it never changes calculator inputs without an explicit user action.
* Low-confidence or duplicate Codal candidates are shown for review only and are not included in bulk apply actions.
* Output is an estimate only and must be verified manually before any financial decision.

## Data Sources

Potential future data sources:

* TSETMC for market data and symbol pages
* Codal for company disclosures and monthly activity reports

Important notes:

* Codal and TSETMC public web endpoints may change without notice.
* Some required values may be missing, delayed, or inconsistent.
* Unlisted portfolio valuation is difficult and may require manual input.
* Different companies may report portfolio data in different formats.

## Current Smoke-Test Status

Limited public smoke testing on 2026-06-28 verified that:

* Lint, unit tests, and TypeScript checks pass locally.
* A production `dist/` build was generated earlier in the smoke-test session; the final automated rebuild was blocked by a local OS access-denied error while overwriting generated files.
* Public TSETMC `/instInfo/{InsCode}` pages for sample investment/holding symbols expose ticker/header and latest/closing price text that can be parsed defensively.
* Public Codal search returns metadata for sample symbols, but may require Persian/Arabic ticker spelling variants.
* Codal `Length` is treated as a period filter, not a page-size limit; the client keeps it at `-1`.
* Codal report selection now ranks candidates by exact symbol, issuer/company-name match, report type, title relevance, and publish date. Suspicious subsidiary-like matches are rejected or shown with warnings in copyable diagnostics.
* Codal detail pages may expose portfolio tables as HTML tables, embedded JSON, or script-held row/cell data. The client now reports detected content type, table count, header previews, and parser warnings when a shape is unsupported.
* Monthly parser diagnostics show table previews, detected labels, candidate values, units, table indexes, and confidence reasons to help users review unsupported or ambiguous Codal reports.
* Parser extraction now preserves empty table cells for safer column alignment and supports explicit `ریال`, `هزار ریال`, `میلیون ریال`, and `میلیون تومان` unit hints. Unclear units are shown as raw values with warnings rather than silently scaled.
* Chrome automation could not open `chrome://extensions/`, so final unpacked-extension loading from `dist/` must be checked manually in Chrome.

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm run test
```

Run lint:

```bash
npm run lint
```

Build the extension:

```bash
npm run build
```

The build runs separate bundles for popup/background and content scripts. Content scripts are emitted as classic self-contained files under `dist/content/` because Manifest V3 `content_scripts[].js` files cannot depend on top-level ES module `import` statements. The build also validates `dist/manifest.json` so manifest paths must point to files that actually exist in `dist/`.

## Load in Chrome

After building the project:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dist` folder.
5. Open a supported TSETMC symbol page and check the NAV widget.

## Troubleshooting Parser Diagnostics

When Codal discovery finds suspicious reports, open the NAV widget or popup and expand `تشخیص انتخاب گزارش کدال`.

That diagnostics section shows candidate reports, scores, selected/rejected state, and reasons such as symbol mismatch, weak issuer match, suspicious parenthetical company names, or low-confidence clarification-letter fallback.

When Codal report detail is fetched but values are not extracted, open the NAV widget or popup and expand `نمایش جزئیات تشخیص Parser`.

The diagnostics section shows each detected table, detected unit, labels, first rows, total-row candidates, cost-column candidates, market-value-column candidates, and extraction failure reasons. Use `کپی تشخیص Parser` to copy a readable JSON payload, or `کپی پیش‌نمایش جدول‌ها` to copy a compact text preview. If the browser blocks clipboard access, the extension shows a textarea fallback for manual copy.

Diagnostics contain only public Codal report content already fetched by the extension. Manual NAV inputs are not included.

## Project Structure

```text
src/background/     MV3 service worker
src/content/        TSETMC and Codal content scripts
src/core/           Pure calculation, parsing, date, and symbol utilities
src/data/           Storage and future data-client boundaries
src/popup/          Extension popup
src/ui/             Shared RTL widget UI and CSS
src/tests/          Vitest unit tests
docs/               Data source and limitations notes
public/icons/       Extension icons
```

## Roadmap

### v0.1

* Semi-manual NAV calculator
* TSETMC widget injection
* Local per-symbol storage
* Unit-tested calculation logic

### v0.2

* Validate TSETMC DOM selectors against live pages
* Improve symbol and price detection
* Add better error states in the widget
* Improve popup UI

### v0.3

* Add Codal report search layer
* Cache fetched report metadata
* Show latest available report date

### v0.4

* Add Codal report detail fetching foundation
* Detect report type and table metadata
* Show report detail fetch status without automatic NAV extraction

### v0.5

* Parse selected Codal monthly activity fields as suggestions
* Add explicit apply/ignore flow for suggested values
* Add manual correction and source metadata layer
* Add confidence/warning labels for extracted values

### v0.6

* Improve parser coverage with more real report fixtures
* Improve Codal detail table detection for HTML, JSON, and script-embedded table data
* Add diagnostics-driven total-row extraction, unit/scale hints, and parser diagnostics for suggested values
* Add stronger review workflow before accepting parsed values

### v1.0

* Stable public release
* Better icon assets
* GitHub release ZIP
* Chrome Web Store-ready package

## Limitations

This extension cannot guarantee accurate NAV values automatically because:

* Monthly portfolio reports may be delayed.
* Codal report formats can vary.
* TSETMC and Codal endpoints may change.
* Unlisted assets do not have live market prices.
* Some values require manual review.

Always verify the final numbers with official disclosures and your own analysis.

## License

MIT
