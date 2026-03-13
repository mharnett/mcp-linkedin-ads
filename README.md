# LinkedIn Ads MCP Server

Production-grade MCP server for LinkedIn Campaign Manager API. Enables Claude to manage LinkedIn ad accounts, campaigns, ad sets, and creatives with full read/write support.

**Features:**
- 65+ production-tested tools
- Multi-account management (multiple LinkedIn ad accounts)
- Campaign, ad group, creative, and targeting management
- Targeting: demographics, interests, job titles, locations, behaviors
- Budget & bid optimization
- Campaign cloning & templating
- Safe create/update operations (validation first)

**Stats:**
- ⭐ Production-proven: 65+ active campaigns under management
- 📊 Multi-client: Flowspace, Forcepoint, Neon One
- 🔄 CTR accuracy: Uses `landingPageClicks` (not total clicks with engagement)
- ✅ Full test coverage: 40+ contract tests

## Installation

```bash
npm install mcp-linkedin-ads
```

## Configuration

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
   export LINKEDIN_CLIENT_ID="your_client_id"
   export LINKEDIN_CLIENT_SECRET="your_client_secret"
   export LINKEDIN_AD_ACCOUNT_ID="your_account_id"
   ```

## Usage

### Start the server
```bash
npm start
```

### Use with Claude Code
Add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "linkedin-ads": {
      "type": "http",
      "url": "http://localhost:3001"
    }
  }
}
```

### Example API Calls
```typescript
// Get client context
get_ads_client_context({ working_directory: "/path/to/project" })

// List campaigns
get_campaigns({ account_id: "511664399" })

// Create campaign
create_campaign({
  name: "Q2 B2B Campaign",
  objective: "LEAD_GENERATION",
  status: "PAUSED"
})

// Get campaign insights
get_insights({
  object_id: "campaign_123",
  time_range: "last_7d"
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
- `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` are set (or in config.json)
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

**Maintained by:** VS Code AI team & community contributors

**Last Updated:** 2026-03-13

**Stability:** Production-ready (65+ campaigns in active management)
