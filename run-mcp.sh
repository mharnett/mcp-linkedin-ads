#!/bin/bash
# Wrapper to launch LinkedIn Ads MCP with tokens from Keychain
# Uses existing credentials from the Forcepoint LinkedIn setup
export LINKEDIN_ADS_CLIENT_ID=$(security find-generic-password -s linkedin-client-id -w 2>/dev/null)
export LINKEDIN_ADS_CLIENT_SECRET=$(security find-generic-password -s linkedin-client-secret -w 2>/dev/null)
export LINKEDIN_ADS_ACCESS_TOKEN=$(security find-generic-password -s linkedin-access-token -w 2>/dev/null)
exec node /Users/mark/claude-code/mcps/mcp-linkedin-ads/dist/index.js
