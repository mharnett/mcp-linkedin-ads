import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildConfig, DEFAULT_API_VERSION } from "../src/config.js";
import { PA_VERSION } from "../src/predictiveAudiences.js";
import { buildDateRange } from "../src/dateRange.js";

const EXAMPLE = join(__dirname, "..", "config.example.json");

describe("LinkedIn-Version has one source of truth", () => {
  it("is a YYYYMM version no older than the one predictive audiences need (202607)", () => {
    expect(DEFAULT_API_VERSION).toMatch(/^\d{6}$/);
    expect(DEFAULT_API_VERSION >= "202607").toBe(true);
  });

  it("config.example.json carries the same version", () => {
    const example = JSON.parse(readFileSync(EXAMPLE, "utf-8"));
    expect(example.api.version).toBe(DEFAULT_API_VERSION);
  });

  it("the env-only default (the npx path) is not an old version", () => {
    const cfg = buildConfig({
      configPath: join(__dirname, "no-such-config.json"),
      examplePath: EXAMPLE,
      env: { LINKEDIN_ADS_ACCESS_TOKEN: "token-0123456789" },
    });
    expect(cfg.api.version).toBe(DEFAULT_API_VERSION);
  });

  it("predictive audiences use the same version", () => {
    expect(PA_VERSION).toBe(DEFAULT_API_VERSION);
  });
});

describe("adAnalytics dateRange", () => {
  it("uses literal parens, colons and commas, never percent-encoding (Restli quirk)", () => {
    const r = buildDateRange("2026-11-01", "2026-11-12");
    expect(r).toBe("(start:(year:2026,month:11,day:1),end:(year:2026,month:11,day:12))");
    expect(r).not.toContain("%");
  });
});
