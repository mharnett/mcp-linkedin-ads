#!/bin/bash
# Wrapper to launch LinkedIn Ads MCP with tokens from Keychain
export LINKEDIN_ADS_CLIENT_ID=$(security find-generic-password -s linkedin-client-id -w 2>/dev/null)
export LINKEDIN_ADS_CLIENT_SECRET=$(security find-generic-password -s linkedin-client-secret -w 2>/dev/null)
export LINKEDIN_ADS_ACCESS_TOKEN=$(security find-generic-password -s linkedin-access-token -w 2>/dev/null)
export LINKEDIN_ADS_REFRESH_TOKEN=$(security find-generic-password -a linkedin-ads-mcp -s LINKEDIN_ADS_REFRESH_TOKEN -w 2>/dev/null)

# Fail fast if critical credentials are missing
if [ -z "$LINKEDIN_ADS_CLIENT_ID" ]; then
  echo "[FATAL] LINKEDIN_ADS_CLIENT_ID is empty -- Keychain lookup failed." >&2
  echo "  Fix: security add-generic-password -s linkedin-client-id -w 'YOUR_CLIENT_ID'" >&2
  exit 1
fi

if [ -z "$LINKEDIN_ADS_ACCESS_TOKEN" ] && [ -z "$LINKEDIN_ADS_REFRESH_TOKEN" ]; then
  echo "[FATAL] Neither ACCESS_TOKEN nor REFRESH_TOKEN found -- at least one is required." >&2
  echo "  Fix: node get-refresh-token.cjs  (log in as mark@drakmarketing.com)" >&2
  exit 1
fi

exec node /Users/mark/claude-code/mcps/mcp-linkedin-ads/dist/index.js
