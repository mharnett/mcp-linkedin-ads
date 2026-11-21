import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildConfig, DEFAULT_API_VERSION, restliHeaders } from "../src/config.js";
import { PA_VERSION } from "../src/predictiveAudiences.js";
import { buildDateRange } from "../src/dateRange.js";

const EXAMPLE = join(__dirname, "..", "config.example.json");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "li-ver-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function configJsonPinning(version: string | undefined): string {
  const p = join(dir, "config.json");
  const api: Record<string, string> = { base_url: "https://api.linkedin.com/rest" };
  if (version !== undefined) api.version = version;
  writeFileSync(
    p,
    JSON.stringify({
      oauth: { client_id: "file-id", client_secret: "file-secret", token_url: "https://t", scope: "s" },
      api,
      clients: { acme: { account_id: "9", name: "Acme", folder: "/acme" } },
    }),
  );
  return p;
}

describe("LinkedIn-Version has one source of truth", () => {
  it("is a YYYYMM version no older than the one predictive audiences need (202607)", () => {
    expect(DEFAULT_API_VERSION).toMatch(/^\d{6}$/);
    expect(DEFAULT_API_VERSION >= "202607").toBe(true);
  });

  it("config.example.json carries no api.version: src/config.ts owns it", () => {
    const example = JSON.parse(readFileSync(EXAMPLE, "utf-8"));
    expect(example.api.base_url).toBe("https://api.linkedin.com/rest");
    expect(example.api).not.toHaveProperty("version");
  });

  it("the env-only default (the npx path) is not an old version", () => {
    const cfg = buildConfig({
      configPath: join(dir, "no-such-config.json"),
      examplePath: EXAMPLE,
      env: { LINKEDIN_ADS_ACCESS_TOKEN: "token-0123456789" },
    });
    expect(cfg.api.version).toBe(DEFAULT_API_VERSION);
  });

  it("a config.json pinning an old version is overridden, and says so once", () => {
    const warnings: string[] = [];
    const cfg = buildConfig({
      configPath: configJsonPinning("202602"),
      examplePath: EXAMPLE,
      env: {},
      warn: (m) => warnings.push(m),
    });
    expect(cfg.api.version).toBe(DEFAULT_API_VERSION);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("202602");
    expect(warnings[0]).toContain(DEFAULT_API_VERSION);
  });

  it("a config.json pinning a newer version is overridden too (no second source)", () => {
    const warnings: string[] = [];
    const cfg = buildConfig({
      configPath: configJsonPinning("209901"),
      examplePath: EXAMPLE,
      env: {},
      warn: (m) => warnings.push(m),
    });
    expect(cfg.api.version).toBe(DEFAULT_API_VERSION);
    expect(warnings).toHaveLength(1);
  });

  it("a config.json that matches, or omits api.version, gets the default silently", () => {
    for (const v of [DEFAULT_API_VERSION, undefined]) {
      const warnings: string[] = [];
      const cfg = buildConfig({
        configPath: configJsonPinning(v),
        examplePath: EXAMPLE,
        env: {},
        warn: (m) => warnings.push(m),
      });
      expect(cfg.api.version).toBe(DEFAULT_API_VERSION);
      expect(cfg.api.base_url).toBe("https://api.linkedin.com/rest");
      expect(warnings).toEqual([]);
    }
  });

  it("predictive audiences use the same version", () => {
    expect(PA_VERSION).toBe(DEFAULT_API_VERSION);
  });

  it("every request path builds its LinkedIn headers in one place", () => {
    expect(restliHeaders("tok-0123456789")).toEqual({
      Authorization: "Bearer tok-0123456789",
      "LinkedIn-Version": DEFAULT_API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    });
  });
});

describe("adAnalytics dateRange", () => {
  it("uses literal parens, colons and commas, never percent-encoding (Restli quirk)", () => {
    const r = buildDateRange("2026-11-01", "2026-11-12");
    expect(r).toBe("(start:(year:2026,month:11,day:1),end:(year:2026,month:11,day:12))");
    expect(r).not.toContain("%");
  });
});
