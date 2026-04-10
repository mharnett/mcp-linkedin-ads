#!/usr/bin/env node
/**
 * Helper to obtain an OAuth2 refresh token for LinkedIn Marketing API.
 *
 * Prerequisites:
 *   1. Create an app at https://www.linkedin.com/developers/apps
 *      - Products: Add "Marketing Developer Platform" (needs approval)
 *      - OAuth 2.0 scopes: r_ads, r_ads_reporting
 *      - Redirect URL: https://localhost:8080/callback
 *   2. Set env vars: LINKEDIN_ADS_CLIENT_ID, LINKEDIN_ADS_CLIENT_SECRET
 *   3. Run: node get-refresh-token.cjs
 *   4. Sign in via browser (log in as mark@drakmarketing.com)
 *   5. Store tokens in Keychain:
 *      security add-generic-password -a linkedin-ads-mcp -s LINKEDIN_ADS_REFRESH_TOKEN -w "<token>" -U
 */

const https = require("https");
const { execSync, execFileSync } = require("child_process");
const { tmpdir } = require("os");
const { join } = require("path");
const { unlinkSync } = require("fs");

const CLIENT_ID = process.env.LINKEDIN_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_ADS_CLIENT_SECRET;
const PORT = 8080;
const REDIRECT_URI = `https://localhost:${PORT}/callback`;
const SCOPE = "r_ads r_ads_reporting";
const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set LINKEDIN_ADS_CLIENT_ID and LINKEDIN_ADS_CLIENT_SECRET env vars first");
  process.exit(1);
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
  return { certPath, keyPath };
}

const state = Math.random().toString(36).substring(2);
const authUrl = `${AUTH_URL}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPE)}&state=${state}`;

const { certPath, keyPath } = generateSelfSignedCert();
const cert = require("fs").readFileSync(certPath);
const key = require("fs").readFileSync(keyPath);

const server = https.createServer({ cert, key }, async (req, res) => {
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
    res.writeHead(400);
    res.end(`Error: ${error}`);
    return;
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
  });

  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await resp.json();

    if (data.access_token) {
      console.log("\n=== SUCCESS ===");
      console.log("Access Token:", data.access_token.substring(0, 40) + "...");
      console.log("Expires in:", data.expires_in, "seconds");

      // Auto-store access token in Keychain
      if (process.platform === "darwin") {
        try {
          try { execFileSync("security", ["delete-generic-password", "-s", "linkedin-access-token"], { stdio: "ignore" }); } catch { /* may not exist */ }
          execFileSync("security", ["add-generic-password", "-s", "linkedin-access-token", "-w", data.access_token]);
          console.log("Access token stored in Keychain (service: linkedin-access-token)");
        } catch (err) {
          console.error("Failed to store access token in Keychain:", err.message);
        }
      }

      if (data.refresh_token) {
        console.log("Refresh Token:", data.refresh_token.substring(0, 20) + "...");
        if (process.platform === "darwin") {
          try {
            try { execFileSync("security", ["delete-generic-password", "-a", "linkedin-ads-mcp", "-s", "LINKEDIN_ADS_REFRESH_TOKEN"], { stdio: "ignore" }); } catch { /* may not exist */ }
            execFileSync("security", ["add-generic-password", "-a", "linkedin-ads-mcp", "-s", "LINKEDIN_ADS_REFRESH_TOKEN", "-w", data.refresh_token]);
            console.log("Refresh token stored in Keychain (account: linkedin-ads-mcp, service: LINKEDIN_ADS_REFRESH_TOKEN)");
          } catch (err) {
            console.error("Failed to store refresh token in Keychain:", err.message);
            console.log("Store manually:");
            console.log(`security add-generic-password -a linkedin-ads-mcp -s LINKEDIN_ADS_REFRESH_TOKEN -w "${data.refresh_token}" -U`);
          }
        } else {
          console.log("\nStore refresh token in your environment:");
          console.log(`export LINKEDIN_ADS_REFRESH_TOKEN="${data.refresh_token}"`);
        }
      } else {
        console.log("\nNo refresh token returned (LinkedIn requires Marketing Developer Platform approval).");
        console.log("The access token (60-day TTL) was stored. Re-run this script to renew.");
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Success!</h1><p>Tokens stored. You can close this tab.</p>");
    } else {
      console.error("Unexpected response:", data);
      res.writeHead(500);
      res.end("Error: " + JSON.stringify(data));
    }
  } catch (err) {
    console.error("Token exchange failed:", err);
    res.writeHead(500);
    res.end("Error: " + err.message);
  }

  // Cleanup temp cert files
  try { unlinkSync(certPath); } catch { /* ignore */ }
  try { unlinkSync(keyPath); } catch { /* ignore */ }

  setTimeout(() => process.exit(0), 1000);
});

server.listen(PORT, () => {
  console.log(`HTTPS callback server listening on port ${PORT}`);
  console.log("Opening browser for LinkedIn sign-in (log in as mark@drakmarketing.com)...");
  console.log("Auth URL:", authUrl);
  try {
    execSync(`open "${authUrl}"`);
  } catch {
    console.log("Open the URL above in your browser.");
  }
});
