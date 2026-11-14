import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildConfig } from "../src/config.js";

const EXAMPLE = join(__dirname, "..", "config.example.json");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "li-cfg-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noFile = () => join(dir, "config.json");

describe("buildConfig: env-only (no config.json)", () => {
  it("builds a usable config from the documented env vars", () => {
    const cfg = buildConfig({
      configPath: noFile(),
      examplePath: EXAMPLE,
      env: {
        LINKEDIN_ADS_CLIENT_ID: "cid-0123456789",
        LINKEDIN_ADS_CLIENT_SECRET: "secret-0123456789",
        LINKEDIN_ADS_ACCESS_TOKEN: "token-0123456789",
      },
    });
    expect(cfg.oauth.client_id).toBe("cid-0123456789");
    expect(cfg.oauth.client_secret).toBe("secret-0123456789");
    expect(cfg.oauth.token_url).toBe("https://www.linkedin.com/oauth/v2/accessToken");
    expect(cfg.api.base_url).toBe("https://api.linkedin.com/rest");
    expect(cfg.api.version).toMatch(/^\d{6}$/);
    expect(cfg.clients).toEqual({});
  });

  it("registers a default client when LINKEDIN_ADS_ACCOUNT_ID is set", () => {
    const cfg = buildConfig({
      configPath: noFile(),
      examplePath: EXAMPLE,
      env: { LINKEDIN_ADS_ACCESS_TOKEN: "token-0123456789", LINKEDIN_ADS_ACCOUNT_ID: "12345" },
    });
    expect(Object.values(cfg.clients).map((c) => c.account_id)).toEqual(["12345"]);
  });

  it("works with only an access token (client id/secret are needed only to refresh)", () => {
    expect(() =>
      buildConfig({ configPath: noFile(), examplePath: EXAMPLE, env: { LINKEDIN_ADS_ACCESS_TOKEN: "token-0123456789" } }),
    ).not.toThrow();
  });

  it("with nothing set, names the real variables and none of the stale ones", () => {
    let msg = "";
    try {
      buildConfig({ configPath: noFile(), examplePath: EXAMPLE, env: {} });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("LINKEDIN_ADS_ACCESS_TOKEN");
    expect(msg).toContain("LINKEDIN_ADS_REFRESH_TOKEN");
    expect(msg).toContain("LINKEDIN_ADS_CLIENT_ID");
    expect(msg).toContain("LINKEDIN_ADS_CLIENT_SECRET");
    expect(msg).not.toMatch(/linkedin-client-id|linkedin-client-secret|LINKEDIN_ACCESS_TOKEN\b/);
  });

  it("refresh token without client id/secret names exactly the missing pair", () => {
    let msg = "";
    try {
      buildConfig({ configPath: noFile(), examplePath: EXAMPLE, env: { LINKEDIN_ADS_REFRESH_TOKEN: "refresh-0123456789" } });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("LINKEDIN_ADS_CLIENT_ID");
    expect(msg).toContain("LINKEDIN_ADS_CLIENT_SECRET");
    expect(msg).not.toContain("LINKEDIN_ADS_ACCESS_TOKEN");
  });
});

describe("buildConfig: config.json present", () => {
  it("wins over env vars and the example defaults", () => {
    const p = join(dir, "config.json");
    writeFileSync(
      p,
      JSON.stringify({
        oauth: { client_id: "file-id", client_secret: "file-secret", token_url: "https://t", scope: "s" },
        api: { base_url: "https://api.example/rest", version: "209901" },
        clients: { acme: { account_id: "9", name: "Acme", folder: "/acme" } },
      }),
    );
    copyFileSync(EXAMPLE, join(dir, "config.example.json"));
    const cfg = buildConfig({
      configPath: p,
      examplePath: EXAMPLE,
      env: { LINKEDIN_ADS_CLIENT_ID: "env-id", LINKEDIN_ADS_ACCESS_TOKEN: "token-0123456789" },
    });
    expect(cfg.api.version).toBe("209901");
    expect(cfg.oauth.client_id).toBe("file-id");
    expect(Object.keys(cfg.clients)).toEqual(["acme"]);
  });
});
