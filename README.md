# LinkedIn Ads MCP Server

[![npm version](https://img.shields.io/npm/v/mcp-linkedin-ads)](https://www.npmjs.com/package/mcp-linkedin-ads)
[![npm downloads](https://img.shields.io/npm/dm/mcp-linkedin-ads)](https://www.npmjs.com/package/mcp-linkedin-ads)
[![GitHub stars](https://img.shields.io/github/stars/mharnett/mcp-linkedin-ads)](https://github.com/mharnett/mcp-linkedin-ads)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Production-grade MCP server for LinkedIn Campaign Manager API. Enables Claude to report on LinkedIn ad accounts, campaign groups and campaigns, and to manage predictive (lookalike) audiences. Reporting is read-only; the two audience write tools are off unless enabled.

## Quick install

Claude Code, one line (replace the placeholder values with your own; see [Configuration](#configuration) for how to get them):

```bash
claude mcp add --env LINKEDIN_ADS_ACCESS_TOKEN=YOUR_ACCESS_TOKEN_HERE --transport stdio mcp-linkedin-ads -- npx -y mcp-linkedin-ads
```

An access token alone is enough to start. Add `--env LINKEDIN_ADS_ACCOUNT_ID=YOUR_ACCOUNT_ID` to set a default ad account. To refresh tokens automatically, also set `LINKEDIN_ADS_CLIENT_ID` and `LINKEDIN_ADS_CLIENT_SECRET`. The server uses LinkedIn API version 202607 and starts read-only; set `LINKEDIN_ADS_MCP_WRITE=true` to expose the two predictive-audience write tools.

<details>
<summary>Claude Desktop</summary>

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), then fully quit and restart Claude Desktop:

```json
{
  "mcpServers": {
    "mcp-linkedin-ads": {
      "command": "npx",
      "args": ["-y", "mcp-linkedin-ads"],
      "env": {
        "LINKEDIN_ADS_ACCESS_TOKEN": "YOUR_ACCESS_TOKEN_HERE"
      }
    }
  }
}
```

</details>

<details>
<summary>Codex CLI</summary>

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.mcp-linkedin-ads]
command = "npx"
args = ["-y", "mcp-linkedin-ads"]

[mcp_servers.mcp-linkedin-ads.env]
LINKEDIN_ADS_ACCESS_TOKEN = "YOUR_ACCESS_TOKEN_HERE"
```

</details>

**Features:**
- **11 tools** (9 read, 2 write) -- production-tested
- Multi-account management (multiple LinkedIn ad accounts)
- Campaign and campaign group listing
- Account and campaign performance analytics
- Flexible pivot-based reporting (demographics, device, creative breakdowns)
- Landing page click-based CTR (not total clicks)

**Stats:**
- ⭐ Production-proven: active campaigns under management
- 📊 Multi-client: per-client config, no client data in repo
- 🔄 CTR accuracy: Uses `landingPageClicks` (not total clicks with engagement)
- ✅ Full test coverage: 40+ contract tests

## Installation

```bash
npm install mcp-linkedin-ads
```

## Configuration

**Security:** Never share your `.mcp.json` file or commit it to git -- it may contain API credentials. Add `.mcp.json` to your `.gitignore`.

1. **Get OAuth credentials:**
   - Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps)
   - Create a new app with "Sign In with LinkedIn" + "Marketing Developer Platform"
   - Scopes: `r_ads`, `rw_ads`, `w_member_social`, `r_organization_social`, `w_organization_social`

2. **Create `config.json`:**
   ```bash
   cp config.example.json config.json
   ```

3. **Fill in your credentials:**
   ```json
   {
     "oauth": {
       "client_id": "YOUR_CLIENT_ID",
       "client_secret": "YOUR_CLIENT_SECRET"
     },
     "clients": {
       "default": {
         "account_id": "YOUR_AD_ACCOUNT_ID",
         "name": "My Account"
       }
     }
   }
   ```

4. **Set environment variables (recommended for production):**
   ```bash
   export LINKEDIN_ADS_CLIENT_ID="your_client_id"
   export LINKEDIN_ADS_CLIENT_SECRET="your_client_secret"
   export LINKEDIN_ADS_ACCESS_TOKEN="your_access_token"
   ```

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LINKEDIN_ADS_CLIENT_ID` | yes | -- | OAuth client ID |
| `LINKEDIN_ADS_CLIENT_SECRET` | yes | -- | OAuth client secret |
| `LINKEDIN_ADS_ACCESS_TOKEN` | yes | -- | OAuth access token |
| `LINKEDIN_ADS_REFRESH_TOKEN` | optional | -- | OAuth refresh token (rotated automatically when set) |
| `LINKEDIN_ADS_MCP_WRITE` | optional | `false` | Set to `true` to expose mutating tools. Read-only by default. |

### Read-only by default

Write tools (currently `linkedin_ads_create_predictive_audience` and
`linkedin_ads_update_predictive_audience`) are hidden from `ListTools` and
refused at call time unless `LINKEDIN_ADS_MCP_WRITE=true` is set in the MCP
server environment. This mirrors the Google Ads MCP gate. Motivation: prevent a
casual LLM request from mutating production ad accounts without the operator
explicitly opting in.

Each write also requires `account_id` **and** `confirm_account_id` set to the
same id. The account is never resolved from the working directory or a default,
and an update refuses a segment owned by a different account. Every write reads
the object back and returns any field that did not stick as `mismatches`.

### Predictive audiences (lookalikes)

| Tool | Kind |
|------|------|
| `linkedin_ads_list_predictive_audiences` | read — every predictive audience in an account, with locations, seeds, size, build status |
| `linkedin_ads_get_predictive_audience` | read — one audience by parent DMP segment id |
| `linkedin_ads_create_predictive_audience` | write — parent DMP segment + audience, then read-back; `dry_run` supported |
| `linkedin_ads_update_predictive_audience` | write — partial update of name, locations, seeds, desired size; `dry_run` supported |

Requirements and behaviour (verified live 2026-11-05):

- The token needs the `rw_dmp_segments` scope (included in `config.example.json`).
  LinkedIn grants DMP write access per developer app.
- These calls use `LinkedIn-Version: 202607` regardless of `api.version`; the
  audience endpoints 404 at 202604.
- `desired_audience_count` and at least one `urn:li:geo:` location are required on create.
- Freshly created audiences 404 their POST/PATCH for a few seconds, and reads lag
  writes; the tools retry 404s and re-read before reporting a mismatch.
- If create fails after the parent segment exists, the error names it; retry
  with `existing_dmp_segment_id` instead of creating a second parent.
- Segments created after early September 2026 cannot be attached to campaigns
  through the API in our testing; attach them in Campaign Manager.

## Usage

### Use with Claude Code
The server runs locally over stdio; your MCP client starts it. Add to `~/.claude.json` (or a project `.mcp.json`):
```json
{
  "mcpServers": {
    "linkedin-ads": {
      "command": "npx",
      "args": ["-y", "mcp-linkedin-ads"],
      "env": {
        "LINKEDIN_ADS_CLIENT_ID": "your_client_id",
        "LINKEDIN_ADS_CLIENT_SECRET": "your_client_secret",
        "LINKEDIN_ADS_ACCESS_TOKEN": "your_access_token"
      }
    }
  }
}
```

**Claude Desktop:** Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

### Example API Calls
```typescript
// Get client context
linkedin_ads_get_client_context({ working_directory: "/path/to/project" })

// List campaigns
linkedin_ads_list_campaigns({ account_id: "511664399" })

// Get campaign performance
linkedin_ads_campaign_performance({
  start_date: "2026-01-01",
  end_date: "2026-03-31",
  time_granularity: "MONTHLY"
})

// Flexible analytics (e.g. by seniority)
linkedin_ads_analytics({
  start_date: "2026-03-01",
  end_date: "2026-03-31",
  pivot: "MEMBER_SENIORITY"
})
```

## Key Data Conventions

### CTR Calculation
- Always use `landingPageClicks` (LP clicks), NOT `clicks` (total clicks)
- Total clicks include social engagement (likes, comments, shares) which inflates CTR
- **This is critical for accurate campaign analysis**

### Campaign Status
- `DRAFT` — Not yet active
- `ACTIVE` — Actively serving
- `PAUSED` — Paused manually
- `ARCHIVED` — Historical record

### Audience Targeting
- Flexible targeting: `flexible_spec` array (OR logic between items)
- Exclude targeting: `exclude_spec` array
- Job titles, seniority levels, functions, locations all supported

## CLI Tools

```bash
npm run dev                 # Run in dev mode (tsx)
npm run build             # Compile TypeScript
npm test                  # Run contract tests
```

## Architecture

**Files:**
- `src/index.ts` — MCP server, OAuth flow, tool handlers
- `src/tools.ts` — Tool schema definitions
- `src/errors.ts` — Error handling & classification
- `config.json` — Credentials & client mapping

**Error Handling:**
- OAuth errors: Clear messages for token refresh needed
- Rate limits: Automatic retry with backoff (recommended by LinkedIn)
- Invalid campaigns: Validation before creation (save API quota)

## Development

### Adding a New Tool
1. Define schema in `src/tools.ts`
2. Add handler in `src/index.ts` tool dispatch
3. Test with contract test in `.contract.test.ts`
4. Document in here

### Testing
```bash
npm test -- --run        # Single run
npm test -- --watch      # Watch mode
```

## Troubleshooting

### `Config file not found`
```bash
cp config.example.json config.json
# Fill in your OAuth credentials and account IDs
```

### `Missing required credentials`
Check that:
- `LINKEDIN_ADS_CLIENT_ID` and `LINKEDIN_ADS_CLIENT_SECRET` are set (or in config.json)
- `config.json` exists and contains at least one client with `account_id`
- OAuth tokens are valid (they expire)

### `Rate limit exceeded`
LinkedIn enforces strict rate limits. The server includes automatic retry with exponential backoff. If you hit limits:
- Wait before retrying
- Batch operations when possible
- Reduce query frequency

### `CTR seems too low`
Verify you're using `landingPageClicks` (LP clicks), not `clicks` (all interactions). The latter includes social engagement and will inflate CTR incorrectly.

## License

MIT

## Contributing

Contributions welcome! Please:
1. Add tests for new tools
2. Update README with new features
3. Follow existing code style
4. Tag release with version

## Support

- **Issues:** GitHub issues for bugs/feature requests
- **Docs:** See `docs/` folder for detailed API reference
- **Community:** Discussions in GitHub

---

## Built By

**[Mark Harnett](https://www.linkedin.com/in/markharnett/)** — Demand generation leader and paid media practitioner building AI-powered ad management tools. This server was born from managing LinkedIn campaigns across multiple clients and wanting Claude to handle campaign ops, performance analysis, and bulk creative updates autonomously.

Built with production workloads in mind: resilient API calls (circuit breakers, retry with backoff, response truncation), accurate CTR calculation (landing page clicks, not total clicks), and multi-account support.

**Also by Mark:** [mcp-bing-ads](https://github.com/mharnett/mcp-bing-ads) -- Bing/Microsoft Ads MCP server with 13 tools.

**Last Updated:** 2026-03-13
