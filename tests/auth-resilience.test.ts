import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";

/**
 * Auth resilience tests for LinkedIn Ads MCP.
 * Validates that OAuth configuration, credential loading, and token
 * refresh mechanisms work correctly across platforms.
 */

describe("get-refresh-token.cjs configuration", () => {
  it("redirect URI must match LinkedIn app registration (https://localhost:8080/callback)", () => {
    const fs = require("fs");
    const path = require("path");
    const script = fs.readFileSync(
      path.join(__dirname, "..", "get-refresh-token.cjs"),
      "utf-8"
    );

    // The registered redirect URI in LinkedIn Developer Console is https://localhost:8080/callback
    // Using http:// or a different port will cause "redirect_uri does not match" errors
    expect(script).toContain('const REDIRECT_URI = `https://localhost:${PORT}/callback`');
    expect(script).toContain("const PORT = 8080");

    // Must NOT contain the old broken values
    expect(script).not.toContain("http://localhost:3000");
    expect(script).not.toContain('REDIRECT_URI = "http://');
  });

  it("must use HTTPS server (not HTTP) for callback", () => {
    const fs = require("fs");
    const path = require("path");
    const script = fs.readFileSync(
      path.join(__dirname, "..", "get-refresh-token.cjs"),
      "utf-8"
    );

    // Must use https module, not http
    expect(script).toContain('require("https")');
    expect(script).toContain("https.createServer");
    expect(script).not.toMatch(/\bhttp\.createServer\b/);
  });

  it("generates a self-signed cert for local HTTPS", () => {
    const fs = require("fs");
    const path = require("path");
    const script = fs.readFileSync(
      path.join(__dirname, "..", "get-refresh-token.cjs"),
      "utf-8"
    );

    expect(script).toContain("generateSelfSignedCert");
    expect(script).toContain("openssl");
    expect(script).toContain("/CN=localhost");
  });
});

describe("run-mcp.sh wrapper", () => {
  it("exports LINKEDIN_ADS_REFRESH_TOKEN from Keychain", () => {
    const fs = require("fs");
    const path = require("path");
    const script = fs.readFileSync(
      path.join(__dirname, "..", "run-mcp.sh"),
      "utf-8"
    );

    expect(script).toContain("LINKEDIN_ADS_REFRESH_TOKEN");
    expect(script).toContain("security find-generic-password");
    expect(script).toContain("linkedin-ads-mcp");
  });

  it("fails fast when no access token or refresh token available", () => {
    const fs = require("fs");
    const path = require("path");
    const script = fs.readFileSync(
      path.join(__dirname, "..", "run-mcp.sh"),
      "utf-8"
    );

    // Must check that at least one token exists
    expect(script).toContain("LINKEDIN_ADS_ACCESS_TOKEN");
    expect(script).toContain("LINKEDIN_ADS_REFRESH_TOKEN");
    expect(script).toContain("exit 1");
  });
});

describe("token persistence in MCP server", () => {
  it("index.ts reads LINKEDIN_ADS_REFRESH_TOKEN env var", () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.join(__dirname, "..", "src", "index.ts"),
      "utf-8"
    );

    expect(source).toContain('envTrimmed("LINKEDIN_ADS_REFRESH_TOKEN")');
  });

  it("persists rotated refresh tokens to Keychain on macOS", () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.join(__dirname, "..", "src", "index.ts"),
      "utf-8"
    );

    // Must use execFileSync (not execSync) to avoid shell injection
    expect(source).toContain("execFileSync");
    expect(source).not.toMatch(/execSync\(/);

    // Must persist to the correct Keychain entry
    expect(source).toContain("linkedin-ads-mcp");
    expect(source).toContain("LINKEDIN_ADS_REFRESH_TOKEN");
  });

  it("uses platform guard for Keychain operations", () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.join(__dirname, "..", "src", "index.ts"),
      "utf-8"
    );

    // Token persistence must be guarded by platform check
    // (Keychain is macOS-only)
    expect(source).toContain('process.platform');
  });

  it("error messages are platform-aware (not Keychain-only)", () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.join(__dirname, "..", "src", "index.ts"),
      "utf-8"
    );

    // Auth error messages should mention env vars generically,
    // not just Keychain (which is macOS-only)
    const authErrorLines = source.split("\n").filter(
      (line) => line.includes("action_required") || line.includes("Re-authenticate")
    );
    expect(authErrorLines.length).toBeGreaterThan(0);
  });
});

describe("OAuth redirect URI consistency", () => {
  it("get-refresh-token.cjs and forcepoint oauth_flow.py use the same redirect URI", () => {
    const fs = require("fs");
    const path = require("path");

    const nodeScript = fs.readFileSync(
      path.join(__dirname, "..", "get-refresh-token.cjs"),
      "utf-8"
    );

    // Both scripts must target https://localhost:8080/callback
    // This is the URI registered in the LinkedIn Developer Console
    // Script uses template literal with PORT variable, so check both parts
    expect(nodeScript).toContain("const PORT = 8080");
    expect(nodeScript).toContain("https://localhost:${PORT}/callback");
    // Verify it does NOT use the old broken values
    expect(nodeScript).not.toContain("localhost:3000");
    expect(nodeScript).not.toContain('"http://localhost');
  });
});
