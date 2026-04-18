# Changelog

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
