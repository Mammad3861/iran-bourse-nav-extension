# Internal Alpha Release Checklist

This checklist is for internal manual testing only. It is not a Chrome Web Store or public release workflow.

## Versioning

- Package version: `0.1.0-alpha.1`
- Chrome manifest version: `0.1.0`

Chrome extension manifests require a numeric `version` value, so `manifest.json` must not use prerelease strings such as `0.1.0-alpha.1`. For alpha builds, keep the npm/package version as the human release label and map it to the numeric manifest version documented above.

## Pre-Release Checks

- Confirm `AGENTS.md` is local only:

```powershell
git check-ignore -v AGENTS.md
git ls-files AGENTS.md
```

- `git check-ignore` should show the `.gitignore` rule.
- `git ls-files AGENTS.md` should print nothing.
- Review `git status --short` before packaging.
- Do not include private notes, credentials, cookies, or local-only files.
- Confirm no suggestion overwrites manual NAV inputs automatically.

## Build Commands

Run from the project root:

```powershell
Remove-Item -Recurse -Force .\dist -ErrorAction SilentlyContinue
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run validate:manifest
npm.cmd run validate:content-scripts
```

`npm.cmd run build` also runs manifest validation after building. The separate validation commands are kept in the checklist so release reviewers can rerun them explicitly.

## Validation Commands

Expected pass conditions:

- `npm.cmd run lint` passes with no ESLint errors.
- `npm.cmd run test` passes all Vitest tests.
- `npm.cmd run build` emits `dist/`.
- `npm.cmd run validate:manifest` confirms every manifest path exists and manifest metadata is valid.
- `npm.cmd run validate:content-scripts` confirms content scripts are classic self-contained scripts and do not contain direct Codal/Excel fetch logic.

## Manual Smoke Test Symbols

Use public TSETMC/Codal pages only. Do not use private accounts or cookies.

| Symbol | Expected alpha behavior |
| --- | --- |
| `وصندوق` | `likely-holding`; symbol and price detected; TSETMC total shares suggestion available; Codal monthly report selected; cost suggestion appears when available; Excel market value remains manual-review/ambiguous; NAV remains incomplete until required manual fields exist. |
| `شستا` | `likely-holding`; holding-like name recognized; Codal failures show live/stale/unavailable status clearly. |
| `فولاد` | `unknown` or unsupported for holding NAV; manual calculator and basic TSETMC info remain usable; subsidiary/other-company financial reports are not treated as issuer-level financial statements. |
| `فملی` | `unknown` or unsupported for holding NAV; generic parser investment labels alone must not classify it as `likely-holding`. |

For each symbol:

- Open the TSETMC instrument page.
- Confirm the widget injects once and does not break layout.
- Confirm symbol, InsCode, and current price are not confused.
- Edit manual fields and save.
- Reload the page and confirm saved values restore.
- Copy Smoke Test Summary and check `parserDataStatus` and `candidateAvailability`.

## Known Limitations

- This is a semi-manual NAV calculator.
- Manual inputs remain the source of truth.
- Codal/TSETMC/Excel values are suggestions only.
- No parsed value is auto-applied.
- Market value candidates can be ambiguous and must be manually reviewed.
- Codal, TSETMC, and Excel endpoints are treated as unstable/non-official.
- Network/VPN/CORS failures may produce `stale-cache` or `unavailable-network-error`.
- Empty candidate lists during `unavailable-network-error` mean Codal could not be checked, not that no candidates exist.
- Non-holding symbols are supported only as manual calculator/basic-info workflows unless strong NAV portfolio data exists.
- This alpha does not provide investment advice or buy/sell recommendations.

## Privacy And Security Notes

- User-entered NAV inputs are stored locally in `chrome.storage.local`.
- The extension does not send manual NAV inputs to any external server.
- Calculations run locally in the browser.
- Codal network requests run through the MV3 background/service worker.
- Content scripts must not directly fetch `codal.ir`, `search.codal.ir`, or `excel.codal.ir`.
- Do not add remote scripts.
- Do not add broad or sensitive permissions for alpha packaging.
- Do not package private files, logs, screenshots, cookies, or `AGENTS.md`.

## Packaging Steps

After the build and validation commands pass:

1. Inspect `dist/manifest.json`.
2. Confirm manifest paths point only to files inside `dist/`.
3. Confirm `dist/content/tsetmc-content.js` and `dist/content/codal-content.js` contain no top-level `import`/`export`.
4. Create a zip from the contents of `dist/`, not from the repository root.
5. Name the package with both versions, for example:

```text
iran-bourse-nav-extension-0.1.0-alpha.1-manifest-0.1.0.zip
```

PowerShell example:

```powershell
Compress-Archive -Path .\dist\* -DestinationPath .\iran-bourse-nav-extension-0.1.0-alpha.1-manifest-0.1.0.zip -Force
```

There is intentionally no `package:chrome` npm script for this alpha. Manual packaging is less brittle on Windows and makes it easier to inspect `dist/` before creating the zip. If a future script is added, it must build, validate, package only `dist/`, write to ignored `releases/`, and exclude source, tests, `node_modules`, `.env`, `AGENTS.md`, logs, coverage, and `.git`.

## Install As Unpacked Extension

1. Open Chrome.
2. Go to `chrome://extensions/`.
3. Enable Developer mode.
4. Click **Load unpacked**.
5. Select the project `dist/` folder.
6. Confirm the extension loads without manifest errors.
7. Open a TSETMC instrument page and run the manual smoke checks.

## Rollback Steps

For internal testers:

1. Go to `chrome://extensions/`.
2. Remove or disable the alpha extension.
3. Load the previous known-good `dist/` folder or zip extraction.
4. If local extension state causes confusing test results, clear the extension storage from Chrome extension details or use a clean Chrome profile.

For maintainers:

1. Keep the previous validated zip until the alpha is accepted.
2. Revert only release-prep changes if needed; do not delete user/manual test data from testers' browsers.
3. If a bug is limited to Codal/TSETMC data fetching, disable or ignore suggestions and keep manual calculator testing available.
