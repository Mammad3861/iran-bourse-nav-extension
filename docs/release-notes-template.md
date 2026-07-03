# Release Notes Template

## Version

- Package version:
- Chrome manifest version:

## Date

- Release date:

## Build Commit

- Commit SHA:
- Branch:
- Working tree clean before package: yes/no

## Smoke-Tested Symbols

| Symbol | Result | Notes |
| --- | --- | --- |
| وصندوق |  |  |
| وغدیر / وغدير |  |  |
| شستا |  |  |
| وبانک |  |  |
| وامید |  |  |
| فولاد |  |  |
| فملی |  |  |

## Passed Checks

```powershell
Remove-Item -Recurse -Force .\dist -ErrorAction SilentlyContinue
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run validate:manifest
npm.cmd run validate:content-scripts
```

- Lint:
- Tests:
- Build:
- Manifest validation:
- Content-script validation:
- Unpacked Chrome install:

## Known Issues

- 

## Manual Test Notes

- TSETMC current price:
- TSETMC total shares:
- Codal discovery:
- Codal stale-cache/network status:
- Monthly parser suggestions:
- Excel market-value manual review:
- Guided NAV completion:
- Smoke Test Summary:

## Rollback Instructions

1. Remove or disable the alpha extension from `chrome://extensions/`.
2. Load the previous known-good `dist/` folder or extracted alpha zip.
3. If extension storage causes confusing results, test in a clean Chrome profile or clear the extension's local storage.
4. Keep manual NAV input backups if testers entered data they need to preserve.
