#!/usr/bin/env node
/**
 * Helper to obtain an OAuth2 refresh token for LinkedIn Marketing API.
 *
 * Prerequisites:
 *   1. Create an app at https://www.linkedin.com/developers/apps
 *      - Products: Add "Marketing Developer Platform" (needs approval)
 *      - OAuth 2.0 scopes: r_ads, r_ads_reporting
 *      - Redirect URL: http://localhost:3000/callback
 *   2. Set env vars: LINKEDIN_ADS_CLIENT_ID, LINKEDIN_ADS_CLIENT_SECRET
 *   3. Run: node get-refresh-token.cjs
 *   4. Sign in via browser
 *   5. Store tokens in Keychain:
 *      security add-generic-password -a linkedin-ads-mcp -s LINKEDIN_ADS_REFRESH_TOKEN -w "<token>" -U
 *      security add-generic-password -a linkedin-ads-mcp -s LINKEDIN_ADS_CLIENT_ID -w "<id>" -U
 *      security add-generic-password -a linkedin-ads-mcp -s LINKEDIN_ADS_CLIENT_SECRET -w "<secret>" -U
 */

const http = require("http");
const { execSync } = require("child_process");

const CLIENT_ID = process.env.LINKEDIN_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_ADS_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/callback";
const SCOPE = "r_ads r_ads_reporting";
const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set LINKEDIN_ADS_CLIENT_ID and LINKEDIN_ADS_CLIENT_SECRET env vars first");
  process.exit(1);
}

const state = Math.random().toString(36).substring(2);
const authUrl = `${AUTH_URL}?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPE)}&state=${state}`;

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/callback")) return;

  const url = new URL(req.url, "http://localhost:3000");
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  if (returnedState !== state) {
    res.writeHead(400);
    res.end("State mismatch — possible CSRF attack");
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

      if (data.refresh_token) {
        console.log("Refresh Token:", data.refresh_token);
        console.log("\nStore in Keychain with:");
        console.log(`security add-generic-password -a linkedin-ads-mcp -s LINKEDIN_ADS_REFRESH_TOKEN -w "${data.refresh_token}" -U`);
      } else {
        console.log("\n⚠️  No refresh token returned.");
        console.log("LinkedIn only provides refresh tokens to approved Marketing Developer Platform partners.");
        console.log("Store the access token instead (expires in 60 days):");
        console.log(`security add-generic-password -a linkedin-ads-mcp -s LINKEDIN_ADS_REFRESH_TOKEN -w "${data.access_token}" -U`);
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Success!</h1><p>Check terminal for token details. You can close this tab.</p>");
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

  setTimeout(() => process.exit(0), 1000);
});

server.listen(3000, () => {
  console.log("Opening browser for LinkedIn sign-in...");
  console.log("Auth URL:", authUrl);
  try {
    execSync(`open "${authUrl}"`);
  } catch {
    console.log("Open the URL above in your browser.");
  }
});
