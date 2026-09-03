#!/bin/bash
# Wrapper to launch LinkedIn Ads MCP with tokens from Keychain
#
# Shared Keychain helper (drak-ops): resolves through the installed package
# location, not a vendored copy — see drak_ops.keychain.keychain_shell_helper_path().
HELPER="$(python3 -c 'from drak_ops.keychain import keychain_shell_helper_path as p; print(p())')"
source "$HELPER"

export LINKEDIN_ADS_CLIENT_ID=$(keychain_get "linkedin-client-id" 2>/dev/null)
export LINKEDIN_ADS_CLIENT_SECRET=$(keychain_get "linkedin-client-secret" 2>/dev/null)
# Access token: prefer the canonical account written by get-refresh-token.cjs,
# fall back to the legacy account used on machines provisioned by hand. Without
# the fallback a legacy-only machine silently starts refresh-token-only.
export LINKEDIN_ADS_ACCESS_TOKEN=$(keychain_get "linkedin-access-token" "linkedin-ads-mcp" 2>/dev/null \
  || keychain_get "linkedin-access-token" "linkedin-api" 2>/dev/null)
export LINKEDIN_ADS_REFRESH_TOKEN=$(keychain_get "LINKEDIN_ADS_REFRESH_TOKEN" "linkedin-ads-mcp" 2>/dev/null)

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
