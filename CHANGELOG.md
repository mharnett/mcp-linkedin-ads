# Changelog

## [1.1.3](https://github.com/mharnett/mcp-linkedin-ads/compare/mcp-linkedin-ads-v1.1.2...mcp-linkedin-ads-v1.1.3) (2026-07-09)


### Bug Fixes

* error server prefix, isError consistency, validateCredentials, CHANGELOG ([a0088ad](https://github.com/mharnett/mcp-linkedin-ads/commit/a0088ad737c4d374893e4ffe7fb18d476ea211f4))
* error size limits, safeResponse mutation, budget docs, CHANGELOG, security warnings ([9e7a890](https://github.com/mharnett/mcp-linkedin-ads/commit/9e7a8900bcc76c95768c98e6f415d12b66732b4a))
* ID validation, path resolution, health tools, descriptions ([0c7acb5](https://github.com/mharnett/mcp-linkedin-ads/commit/0c7acb537959c57f1dc89bf152c534f18895ed8b))
* Node 18.18 minimum, env var trimming, unhandledRejection, TTY guard ([5b23548](https://github.com/mharnett/mcp-linkedin-ads/commit/5b23548fffc49c853c9d5dd5dcfafbbe61508447))
* re-export WRITE_TOOLS and drop orphaned updateNotifier test ([#4](https://github.com/mharnett/mcp-linkedin-ads/issues/4)) ([b26fe13](https://github.com/mharnett/mcp-linkedin-ads/commit/b26fe13db5aa36507905a270df2fc50b11a5c983))
* README accuracy, env var docs, dependency cleanup ([4d6bdca](https://github.com/mharnett/mcp-linkedin-ads/commit/4d6bdca4a1025506c015b92ee16dfc4c5da4acf8))
* startup checks, credential redaction, schema hardening, format validation ([3375b28](https://github.com/mharnett/mcp-linkedin-ads/commit/3375b285bae9205c24dfe0a025d1c1d968a1c64a))
* stderr logging, Linux/Docker compat, SIGPIPE, version fallback ([38c1419](https://github.com/mharnett/mcp-linkedin-ads/commit/38c1419f2f60cd0ad43ca6f36b3d74410e3d0463))
* use fileURLToPath for cross-platform __dirname ([529b32b](https://github.com/mharnett/mcp-linkedin-ads/commit/529b32b4895370a2b42d2121dc1b2051b3048e53))
* version field, safeResponse loop, auth retry, SIGTERM handling ([01a79dc](https://github.com/mharnett/mcp-linkedin-ads/commit/01a79dcbd28f9d6db5b4179a695f312c93d4d000))

## [1.1.1] - 2026-04-18

### Added
- **Startup npm outdated check.** At server boot, fires a fire-and-forget
  HTTP request to `registry.npmjs.org/mcp-linkedin-ads/latest` (2s timeout)
  and logs a stderr notice when a newer version is available. stdout stays
  reserved for MCP JSON-RPC. Silent on network error, timeout, or when
  installed version matches registry. Opt out with
  `MCP_DISABLE_UPDATE_CHECK=1`. Tests cover up-to-date, outdated, offline,
  dev-build, and both opt-out modes.

## [1.1.0] - 2026-04-18

### Security
- **Read-only by default.** Mutating tools are now hidden from `ListTools` and refused at call time unless `LINKEDIN_ADS_MCP_WRITE=true` is set in the MCP server environment. Read-only tools are unaffected.
- Added `src/writeGate.ts` module with `filterTools`, `assertWriteAllowed`, and a `WRITE_TOOLS` set. Wired into the `ListToolsRequestSchema` and `CallToolRequestSchema` handlers.
- Added drift-alarm test: every tool registered in `src/tools.ts` must be classified as either WRITE or in the local `READ_TOOLS` fixture, so adding a new tool without classifying it fails CI.
- Startup log line now reports write-mode status.

Mirrors the Google Ads MCP gate; Bing / Reddit / Meta receiving the same treatment. The current LinkedIn Ads tool surface is read-only, so this change is a no-op at runtime but locks in the default for any future write tools.

## [1.0.12] - 2026-04-04

### Security
- Error responses now pass through `safeResponse` to prevent oversized error payloads
- `safeResponse` deep-clones before truncation to avoid mutating original data

## [1.0.8] - 2026-04-09

### Added
- Published to npm
- CLI flags (--help, --version)
- SIGTERM/SIGINT graceful shutdown
- Env var trimming and validation

### Security
- Shell injection fix in token rotation
- All logging to stderr (stdout reserved for MCP protocol)
- Auth errors not retried (fail fast on 401/403)
