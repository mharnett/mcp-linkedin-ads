#!/usr/bin/env node
/**
 * Helper to obtain an OAuth2 refresh token for LinkedIn Marketing API.
 *
 * Prerequisites:
 *   1. Create an app at https://www.linkedin.com/developers/apps
 *      - Products: Add "Advertising API" (Development Tier is sufficient)
 *      - OAuth 2.0 scopes used: read from config.json oauth.scope at runtime
 *        (current: r_ads, rw_ads, r_ads_reporting, w_member_social,
 *         r_organization_social, w_organization_social)
 *      - Redirect URL: https://localhost:8080/callback
 *   2. Set env vars: LINKEDIN_ADS_CLIENT_ID, LINKEDIN_ADS_CLIENT_SECRET
 *      (the Keychain wrapper run-mcp.sh already exports these from
 *       linkedin-client-id and linkedin-client-secret entries)
 *   3. Run: node get-refresh-token.cjs
 *   4. Sign in via browser (log in as the account that owns the app)
 *   5. No token is printed. Each is saved to the macOS Keychain (where
 *      run-mcp.sh reads it), or, off macOS or if that fails, to a file only
 *      your user can read. The script says which, and how to load it.
 */

const https = require("https");
const { execSync, execFileSync } = require("child_process");
const { tmpdir } = require("os");
const { join } = require("path");
const { readFileSync, unlinkSync } = require("fs");
const { storeToken, describeStored, describeOAuthError, describeFailure, listenLoopback } = require("./token-store.cjs");

const CLIENT_ID = process.env.LINKEDIN_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_ADS_CLIENT_SECRET;
const PORT = 8080;
const REDIRECT_URI = `https://localhost:${PORT}/callback`;
const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const KEYCHAIN_ACCOUNT = "linkedin-ads-mcp";
const ACCESS_ENTRY = { service: "linkedin-access-token", envVar: "LINKEDIN_ADS_ACCESS_TOKEN" };
const REFRESH_ENTRY = { service: "LINKEDIN_ADS_REFRESH_TOKEN", envVar: "LINKEDIN_ADS_REFRESH_TOKEN" };

// Read scopes from config.json so this script stays in lockstep with what the
// MCP advertises at runtime. Scopes are comma-separated in config; LinkedIn's
// auth endpoint wants a space-separated list.
function readScope() {
  const cfg = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf8"));
  return ((cfg.oauth && cfg.oauth.scope) || "r_ads,r_ads_reporting")
    .split(",").map(s => s.trim()).filter(Boolean).join(" ");
}

// Generate self-signed cert for local HTTPS callback server
function generateSelfSignedCert() {
  const certPath = join(tmpdir(), `linkedin-oauth-cert-${process.pid}.pem`);
  const keyPath = join(tmpdir(), `linkedin-oauth-key-${process.pid}.pem`);
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048",
    "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-nodes",
    "-subj", "/CN=localhost",
  ], { stdio: "ignore" });
  const cert = readFileSync(certPath);
  const key = readFileSync(keyPath);
  // Both are in memory now; nothing needs the files.
  for (const p of [certPath, keyPath]) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
  return { cert, key };
}

function saveToken(entry, secret, deps) {
  const result = deps.store({ account: KEYCHAIN_ACCOUNT, service: entry.service, secret });
  deps.log(describeStored(result, { account: KEYCHAIN_ACCOUNT, ...entry }));
  return Boolean(result.where);
}

async function exchangeCode(code, { clientId, clientSecret, deps }) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
  });

  const resp = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await resp.json();

  if (!data.access_token) {
    const why = describeOAuthError(data);
    deps.log(`No access token in response (${why})`);
    return { ok: false, text: `Error: ${why}` };
  }

  deps.log("\n=== Signed in ===");
  deps.log(`Access token expires in: ${data.expires_in} seconds`);
  let ok = saveToken(ACCESS_ENTRY, data.access_token, deps);

  if (data.refresh_token) {
    deps.log("");
    ok = saveToken(REFRESH_ENTRY, data.refresh_token, deps) && ok;
  } else {
    deps.log("\nNo refresh token returned (LinkedIn requires Marketing Developer Platform approval).");
    deps.log("The access token has a 60-day lifetime. Re-run this script to renew.");
  }

  return ok
    ? { ok, text: "Success. Tokens saved. You can close this tab." }
    : { ok, text: "A token could not be saved. See the terminal." };
}

function startCallbackServer({ port, createServer, state, clientId, clientSecret, deps }) {
  const handler = async (req, res) => {
    if (!req.url.startsWith("/callback")) return;

    const url = new URL(req.url, `https://localhost:${PORT}`);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");

    if (returnedState !== state) {
      res.writeHead(400);
      res.end("State mismatch -- possible CSRF attack");
      return;
    }

    if (!code) {
      const error = url.searchParams.get("error_description") || url.searchParams.get("error") || "No code received";
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Error: ${error}`);
      return;
    }

    let outcome;
    try {
      outcome = await exchangeCode(code, { clientId, clientSecret, deps });
    } catch (err) {
      const why = describeFailure(err);
      deps.log(`Token exchange failed: ${why}`);
      outcome = { ok: false, text: `Error: ${why}` };
    }
    res.writeHead(outcome.ok ? 200 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(outcome.text, () => deps.done(outcome.ok ? 0 : 1));
  };
  return listenLoopback(() => createServer(handler), port);
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Set LINKEDIN_ADS_CLIENT_ID and LINKEDIN_ADS_CLIENT_SECRET env vars first");
    process.exit(1);
  }

  const scope = readScope();
  const state = Math.random().toString(36).substring(2);
  const authUrl = `${AUTH_URL}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  const tls = generateSelfSignedCert();

  await startCallbackServer({
    port: PORT,
    createServer: (handler) => https.createServer(tls, handler),
    state,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    deps: {
      fetch,
      store: storeToken,
      log: console.log,
      done: (exitCode) => setTimeout(() => process.exit(exitCode), 1000),
    },
  });

  console.log(`HTTPS callback server listening on loopback port ${PORT}`);
  console.log("Opening browser for LinkedIn sign-in (log in as the account that owns the app)...");
  console.log("Auth URL:", authUrl);
  try {
    execSync(`open "${authUrl}"`);
  } catch {
    console.log("Open the URL above in your browser.");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Could not start: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { startCallbackServer };
