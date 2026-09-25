# Contributing

Thanks for helping improve email-rte! By participating you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Prerequisites: Node.js 20+, .NET 10 SDK (see `global.json`), and Chromium for Playwright
(`npx playwright install chromium`).

```bash
npm ci
npm run build
dotnet build EmailRte.sln
```

Run the sample app with `cd samples/host && dotnet run` (see the README).

## Before opening a pull request

Run what CI runs:

```bash
npm run build && npm run typecheck
npm test
npm run export-fixture && dotnet test EmailRte.sln
npm run license:check
npm run license:notices:check
npm run cdn:check
```

- **Add a changeset** for any change to a published package: `npx changeset`.
  Use `@sync8/email-rte-dotnet` for changes to the NuGet package.
- **Dependencies**: only add dependencies under permissive licenses (MIT, BSD,
  Apache-2.0, ISC, …). GPL/LGPL/AGPL/SSPL or unknown licenses fail the build.
  Do not add CKEditor. After changing dependencies, run
  `npm run license:notices` (add `-- --fetch` if a package lacks a license
  file) and commit `THIRD_PARTY_NOTICES.md` and `third_party/license-texts`.
- **No external runtime dependencies**: nothing shipped may load from CDNs,
  web-font services or placeholder-image hosts, or call third-party services.
  `npm run cdn:check` enforces this.
- **Email safety**: new editor features must produce HTML that works in
  Outlook desktop (Word engine), Outlook on the web and Gmail, and pass the
  allow-list lint in `packages/rte/test/email-lint.mjs`. Extend the render
  tests (and re-export the .NET fixture) when output changes.
- **Branding**: do not use the Quill name or logo as project branding.
- **Secrets**: never commit credentials. Only `appsettings.example.json` is
  tracked; use `appsettings.json` (git-ignored), user secrets or environment
  variables locally.

## Commit and PR style

Keep PRs focused, describe the user-visible change, and include tests. For UI
changes, attach a screenshot.

## Reporting security issues

Please do not open public issues for vulnerabilities; see [SECURITY.md](SECURITY.md).
