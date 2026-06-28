# Limitations

This extension provides an estimate, not an audited valuation.

- User-entered financial statement inputs may be stale, incomplete, or incorrect.
- TSETMC page structure can change without notice, so symbol and price detection may fail.
- Current price may need manual entry when the page does not expose a reliable value.
- Unlisted portfolio surplus is usually judgment-based and may require independent valuation work.
- Corporate actions, capital increases, treasury shares, and post-report events are not automatically reconciled.
- Codal and TSETMC APIs are treated as unstable or non-official until documented and legally safe to use.
- No investment advice is provided.

## Real TSETMC Page Notes

Observed on a live TSETMC instrument page such as `https://www.tsetmc.com/instInfo/778253364357513`:

- Current TSETMC symbol pages use `/instInfo/{InsCode}` URLs, so the URL alone usually provides an InsCode, not the ticker symbol.
- The ticker symbol is more reliably found in the header pattern like `Company Name (SYMBOL)`.
- Price rows can be compact with no separator, for example `آخرین معامله1,255...` and `قیمت پایانی1,256...`; parsers must read the first number after a known label.
- TSETMC pages include large AG Grid style blocks in text content, so broad page-text parsing can pick up unrelated numbers.
- `https://cdn.tsetmc.com/api` may be blocked by the browser, profile extensions, network policy, or endpoint changes; DOM fallback and manual price entry must remain available.

The MVP avoids aggressive scraping and does not run scheduled background collection.
