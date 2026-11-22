/**
 * server.json is the MCP registry listing: the env vars an installer asks
 * for. They must be the ones the server reads, or a registry install starts
 * with no credentials.
 *
 * The names the server reads are observed, not copied: buildConfig and
 * isWriteEnabled run against an env that records every key looked up.
 * Nothing here starts the server or calls LinkedIn.
 */
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildConfig } from "../src/config.js";
import { validateCredentials } from "../src/errors.js";
import { isWriteEnabled } from "../src/writeGate.js";

const ROOT = join(__dirname, "..");
const EXAMPLE = join(ROOT, "config.example.json");

interface EnvVarInput {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

const listing = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf-8"));
const npmPackage = listing.packages.find((p: any) => p.registryType === "npm" && p.identifier === "mcp-linkedin-ads");
const listed: EnvVarInput[] = npmPackage?.environmentVariables ?? [];

/** A fake value long enough to pass validateCredentials' length check. */
const fake = (name: string) => `fake-${name.toLowerCase()}-0001`;

function withScratchDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "li-server-json-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every LINKEDIN_ADS_* key buildConfig and the write gate look up when the server starts from env alone. */
function namesTheServerReads(): string[] {
  const read = new Set<string>();
  const values: Record<string, string> = { LINKEDIN_ADS_ACCESS_TOKEN: fake("LINKEDIN_ADS_ACCESS_TOKEN") };
  const env = new Proxy(values, {
    get(target, key) {
      if (typeof key === "string") read.add(key);
      return target[key as string];
    },
    has(target, key) {
      if (typeof key === "string") read.add(key);
      return key in target;
    },
  });
  withScratchDir((dir) => {
    buildConfig({ configPath: join(dir, "config.json"), examplePath: EXAMPLE, env, warn: () => {} });
  });
  isWriteEnabled(env as NodeJS.ProcessEnv);
  return [...read].filter((k) => k.startsWith("LINKEDIN_ADS_")).sort();
}

describe("server.json registry listing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists an npm package for mcp-linkedin-ads with env vars", () => {
    expect(npmPackage).toBeDefined();
    expect(listed.length).toBeGreaterThan(0);
  });

  it("lists exactly the env vars the server reads", () => {
    const read = namesTheServerReads();
    expect(read.length).toBeGreaterThan(0);
    expect(listed.map((v) => v.name).sort()).toEqual(read);
  });

  it("the env vars it marks required are enough to start", () => {
    const required = listed.filter((v) => v.isRequired);
    expect(required.length).toBeGreaterThan(0);
    const env = Object.fromEntries(required.map((v) => [v.name, fake(v.name)]));

    withScratchDir((dir) => {
      expect(() =>
        buildConfig({ configPath: join(dir, "config.json"), examplePath: EXAMPLE, env, warn: () => {} }),
      ).not.toThrow();
    });

    for (const name of ["LINKEDIN_ADS_ACCESS_TOKEN", "LINKEDIN_ADS_REFRESH_TOKEN"]) vi.stubEnv(name, undefined);
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    expect(validateCredentials()).toEqual({ valid: true, missing: [] });
  });

  it("marks every token and secret as a secret, and nothing else", () => {
    for (const v of listed) {
      expect({ name: v.name, isSecret: v.isSecret === true }).toEqual({
        name: v.name,
        isSecret: /TOKEN|SECRET/.test(v.name),
      });
    }
  });
});
