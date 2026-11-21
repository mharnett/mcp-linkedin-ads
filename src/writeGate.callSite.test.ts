/**
 * Write gate at the call site: drives the real tools/list and tools/call
 * handlers that src/index.ts registers, over an in-memory MCP transport.
 *
 * writeGate.test.ts proves assertWriteAllowed() and filterTools() work, but
 * it imports only tools.js, so deleting either call from src/index.ts left
 * every test green (review 2026-11-14). Here every WRITE_TOOLS name is called
 * through the server with LINKEDIN_ADS_MCP_WRITE unset and must be refused
 * before any request leaves the process, including dry runs and calls that
 * pass the account confirmation.
 *
 * Containment: fetch is a recording fake (tests/helpers/fakeLinkedInApi.ts)
 * stubbed before index.js loads, the credential is a fake access token (no
 * refresh, so no Keychain), and config.json is ignored.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createRecordingFetch, FAKE_ACCOUNT_ID, FAKE_ENV } from "../tests/helpers/fakeLinkedInApi.js";
import { bodyOf, connectInMemory } from "../tests/helpers/connect.js";
import { WRITE_TOOLS, WRITE_DISABLED_MESSAGE } from "./writeGate.js";
import { tools } from "./tools.js";

vi.mock("./config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./config.js")>();
  return { ...real, buildConfig: (opts: any) => real.buildConfig({ ...opts, configPath: "/nonexistent/config.json" }) };
});

const api = createRecordingFetch();
const WRITE_TOOL_NAMES = [...WRITE_TOOLS].sort();

const LOADED = {
  account_id: FAKE_ACCOUNT_ID,
  confirm_account_id: FAKE_ACCOUNT_ID,
  dmp_segment_id: "700",
  name: "Gate test audience",
  locations: ["urn:li:geo:103644278"],
  seeds: ["urn:li:dmpSegment:800"],
  desired_audience_count: 100000,
};

/** The bare call, a dry run, and a confirmed live call. Read mode refuses all three. */
const ARG_SHAPES: Array<[string, Record<string, unknown>]> = [
  ["bare", { account_id: FAKE_ACCOUNT_ID }],
  ["dry run", { ...LOADED, dry_run: true }],
  ["confirmed", { ...LOADED, dry_run: false }],
];

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", api.fetch);
  for (const [k, v] of Object.entries(FAKE_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("LINKEDIN_ADS_MCP_WRITE", undefined);
  const { server } = await import("./index.js");
  client = await connectInMemory(server);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  api.reset();
});

afterEach(() => {
  vi.stubEnv("LINKEDIN_ADS_MCP_WRITE", undefined);
});

describe("write gate at the CallTool dispatch (LINKEDIN_ADS_MCP_WRITE unset)", () => {
  it("covers the predictive audience create and update tools", () => {
    expect(WRITE_TOOL_NAMES).toEqual(["linkedin_ads_create_predictive_audience", "linkedin_ads_update_predictive_audience"]);
  });

  describe.each(ARG_SHAPES)("%s arguments", (_shape, args) => {
    it.each(WRITE_TOOL_NAMES)("%s is refused before any LinkedIn request", async (name) => {
      const result: any = await client.callTool({ name, arguments: args });

      expect(result.isError).toBe(true);
      expect(bodyOf(result).message).toBe(`Tool "${name}" is a write operation. ${WRITE_DISABLED_MESSAGE}`);
      expect(api.total).toBe(0);
    });
  });

  it("hides every write tool from tools/list and keeps every read tool", async () => {
    const { tools: listed } = await client.listTools();
    const names = listed.map((t) => t.name);
    expect(names.filter((n) => WRITE_TOOLS.has(n))).toEqual([]);
    expect(names.sort()).toEqual(tools.map((t) => t.name).filter((n) => !WRITE_TOOLS.has(n)).sort());
  });

  it("still lets a read tool through to the API (the fake is on the dispatch path)", async () => {
    const result: any = await client.callTool({
      name: "linkedin_ads_get_predictive_audience",
      arguments: { dmp_segment_id: "700" },
    });

    expect(result.isError).toBeFalsy();
    expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /dmpSegments/700",
      "GET /dmpSegments/700/businessObjectiveBasedAudiences",
    ]);
  });
});

describe("write gate open (LINKEDIN_ADS_MCP_WRITE=true)", () => {
  beforeEach(() => {
    vi.stubEnv("LINKEDIN_ADS_MCP_WRITE", "true");
  });

  it("lists every tool, write tools included", async () => {
    const { tools: listed } = await client.listTools();
    expect(listed.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("lets a write tool through to its handler (a dry run returns the payload it would send)", async () => {
    const result: any = await client.callTool({
      name: "linkedin_ads_create_predictive_audience",
      arguments: { ...LOADED, dry_run: true },
    });

    expect(result.isError).toBeFalsy();
    expect(bodyOf(result)).toMatchObject({ dry_run: true, account_id: FAKE_ACCOUNT_ID, parent_payload: { name: LOADED.name } });
    expect(api.total).toBe(0);
  });
});
