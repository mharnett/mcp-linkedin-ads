#!/bin/bash
# Contract test for run-mcp.sh credential resolution.
#
# run-mcp.sh reads secrets from the macOS Keychain. Two account conventions
# exist in the wild:
#   canonical -- written by get-refresh-token.cjs: -a linkedin-ads-mcp
#   legacy    -- hand-added on older machines:     -a linkedin-api
#
# The script must prefer canonical and fall back to legacy, so a machine that
# only has the legacy entry still gets a real access token instead of silently
# degrading to refresh-token-only.
#
# Runs hermetically: `security`, `node`, and `python3` are stubbed on PATH,
# so no Keychain access, no server launch, and no dependency on a real
# drak_ops install (run-mcp.sh now sources the shared drak_ops
# keychain_get.sh helper -- see mcp-linkedin-ads#8 -- resolved via a
# `python3 -c '...keychain_shell_helper_path...'` one-liner that CI runners
# without a real drak_ops install can't satisfy; the `python3` stub below
# resolves it to tests/fixtures/keychain_get.sh instead).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/run-mcp.sh"
FIXTURE_HELPER="$ROOT/tests/fixtures/keychain_get.sh"
PASS=0
FAIL=0

# Build a sandbox whose `security` stub answers only for the account/service
# pairs listed in KEYCHAIN, and whose `node` stub prints the resolved env.
make_sandbox() {
  local dir
  dir="$(mktemp -d)"

  cat >"$dir/security" <<'STUB'
#!/bin/bash
# Parse: security find-generic-password -a <acct> -s <svc> -w
acct=""; svc=""
while [ $# -gt 0 ]; do
  case "$1" in
    -a) acct="$2"; shift 2 ;;
    -s) svc="$2";  shift 2 ;;
    *)  shift ;;
  esac
done
# KEYCHAIN is a newline-separated list of "acct|svc|value".
# Real `security` matches on service alone when -a is omitted.
while IFS= read -r row; do
  [ -z "$row" ] && continue
  racct="${row%%|*}"; rest="${row#*|}"; rsvc="${rest%%|*}"
  [ "$rsvc" = "$svc" ] || continue
  if [ -z "$acct" ] || [ "$racct" = "$acct" ]; then
    printf '%s' "${row##*|}"; exit 0
  fi
done <<< "$KEYCHAIN"
exit 44   # matches real `security` not-found behavior
STUB

  cat >"$dir/node" <<'STUB'
#!/bin/bash
echo "ACCESS=${LINKEDIN_ADS_ACCESS_TOKEN:-}"
echo "REFRESH=${LINKEDIN_ADS_REFRESH_TOKEN:-}"
exit 0
STUB

  cat >"$dir/python3" <<STUB
#!/bin/bash
echo "$FIXTURE_HELPER"
STUB

  chmod +x "$dir/security" "$dir/node" "$dir/python3"
  echo "$dir"
}

# run_case <name> <keychain-rows> -- sets OUT and RC
run_case() {
  local sandbox
  sandbox="$(make_sandbox)"
  OUT="$(KEYCHAIN="$2" PATH="$sandbox:$PATH" bash "$SCRIPT" 2>&1)"
  RC=$?
  rm -rf "$sandbox"
}

assert_contains() {
  if grep -qF -- "$2" <<<"$1"; then
    echo "  ok: contains '$2'"; PASS=$((PASS+1))
  else
    echo "  FAIL: expected '$2' in:"; sed 's/^/       /' <<<"$1"; FAIL=$((FAIL+1))
  fi
}

assert_rc() {
  if [ "$1" -eq "$2" ]; then
    echo "  ok: exit $2"; PASS=$((PASS+1))
  else
    echo "  FAIL: expected exit $2, got $1"; FAIL=$((FAIL+1))
  fi
}

BASE="linkedin-api|linkedin-client-id|cid
linkedin-api|linkedin-client-secret|csec"

echo "case: canonical access token present -> used"
run_case canonical "$BASE
linkedin-ads-mcp|linkedin-access-token|CANON_TOK
linkedin-api|linkedin-access-token|LEGACY_TOK
linkedin-ads-mcp|LINKEDIN_ADS_REFRESH_TOKEN|rtok"
assert_contains "$OUT" "ACCESS=CANON_TOK"
assert_rc "$RC" 0

echo "case: canonical absent, legacy present -> falls back to legacy"
run_case legacy "$BASE
linkedin-api|linkedin-access-token|LEGACY_TOK
linkedin-ads-mcp|LINKEDIN_ADS_REFRESH_TOKEN|rtok"
assert_contains "$OUT" "ACCESS=LEGACY_TOK"
assert_rc "$RC" 0

echo "case: no access token anywhere, refresh present -> still starts"
run_case refresh_only "$BASE
linkedin-ads-mcp|LINKEDIN_ADS_REFRESH_TOKEN|rtok"
assert_contains "$OUT" "ACCESS="
assert_contains "$OUT" "REFRESH=rtok"
assert_rc "$RC" 0

echo "case: client id missing -> fatal"
run_case no_client_id "linkedin-ads-mcp|LINKEDIN_ADS_REFRESH_TOKEN|rtok"
assert_contains "$OUT" "LINKEDIN_ADS_CLIENT_ID is empty"
assert_rc "$RC" 1

echo "case: no access and no refresh -> fatal"
run_case no_tokens "$BASE"
assert_contains "$OUT" "Neither ACCESS_TOKEN nor REFRESH_TOKEN"
assert_rc "$RC" 1

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
