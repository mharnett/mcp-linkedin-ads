/**
 * Non-idempotent writes must not be retried.
 *
 * linkedin_ads_create_predictive_audience POSTs a parent dmpSegment and then
 * a child audience. Re-sending either after a 5xx could create a duplicate,
 * so a 5xx goes back to the caller after one attempt. The only retry is the
 * child POST on 404 (the parent is not visible yet, so nothing was written).
 *
 * Containment: same recording fetch, credential and config fakes as
 * writeGate.callSite.test.ts. Nothing reaches LinkedIn.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createRecordingFetch, FAKE_ACCOUNT_ID, FAKE_ENV } from "../tests/helpers/fakeLinkedInApi.js";
import { bodyOf, connectInMemory } from "../tests/helpers/connect.js";

vi.mock("./config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./config.js")>();
  return { ...real, buildConfig: (opts: any) => real.buildConfig({ ...opts, configPath: "/nonexistent/config.json" }) };
});

const api = createRecordingFetch();
let client: Client;

const CREATE = {
  account_id: FAKE_ACCOUNT_ID,
  confirm_account_id: FAKE_ACCOUNT_ID,
  name: "Retry test audience",
  locations: ["urn:li:geo:103644278"],
  seeds: ["urn:li:dmpSegment:800"],
  desired_audience_count: 100000,
};

beforeAll(async () => {
  vi.stubGlobal("fetch", api.fetch);
  for (const [k, v] of Object.entries(FAKE_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("LINKEDIN_ADS_MCP_WRITE", "true");
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

const posts = (path: string) => api.requests.filter((r) => r.method === "POST" && r.path === path);

describe("linkedin_ads_create_predictive_audience on a 5xx", () => {
  it("sends the parent dmpSegment POST once", async () => {
    api.setRoute(() => ({ status: 503, body: { message: "Service Unavailable" } }));

    const result: any = await client.callTool({ name: "linkedin_ads_create_predictive_audience", arguments: CREATE });

    expect(result.isError).toBe(true);
    expect(bodyOf(result).message).toMatch(/Nothing was created/);
    expect(posts("/dmpSegments")).toHaveLength(1);
    expect(api.total).toBe(1);
  });

  it("sends the child audience POST once and names the parent to reuse", async () => {
    api.setRoute((req) => {
      if (req.method === "POST" && req.path === "/dmpSegments") return { status: 201, headers: { "x-restli-id": "900" } };
      return { status: 503, body: { message: "Service Unavailable" } };
    });

    const result: any = await client.callTool({ name: "linkedin_ads_create_predictive_audience", arguments: CREATE });

    expect(result.isError).toBe(true);
    expect(bodyOf(result).message).toMatch(/existing_dmp_segment_id=900/);
    expect(posts("/dmpSegments")).toHaveLength(1);
    expect(posts("/dmpSegments/900/businessObjectiveBasedAudiences")).toHaveLength(1);
  });
});
