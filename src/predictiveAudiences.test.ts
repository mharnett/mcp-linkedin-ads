import { describe, it, expect, vi } from "vitest";
import {
  PA_VERSION,
  LOCATIONS_FACET,
  buildTargetingFilter,
  assertAccountConfirmed,
  parseCreatedId,
  PredictiveAudienceClient,
  READBACK_ATTEMPTS,
} from "./predictiveAudiences.js";

const ACCOUNT = "500000001";
const ACCOUNT_URN = `urn:li:sponsoredAccount:${ACCOUNT}`;
const SEED = "urn:li:dmpSegment:70000001";
const CA = "urn:li:geo:101174742";
const US = "urn:li:geo:103644278";

type Call = { method: string; url: string; headers: Record<string, string>; body?: any };

function res(status: number, body?: any, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

/** A fetch stub answering from a queue of [matcher, response] pairs, in order. */
function fakeFetch(script: Array<[string, Response | (() => Response)]>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: any) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const next = script.shift();
    if (!next) throw new Error(`unexpected call ${call.method} ${url}`);
    const [expect_, r] = next;
    if (!`${call.method} ${url}`.includes(expect_)) {
      throw new Error(`expected "${expect_}", got "${call.method} ${url}"`);
    }
    return typeof r === "function" ? r() : r;
  });
  return { fn, calls, remaining: script };
}

function client(f: ReturnType<typeof fakeFetch>) {
  return new PredictiveAudienceClient({
    baseUrl: "https://api.linkedin.com/rest",
    getToken: async () => "tok",
    fetchFn: f.fn as any,
    sleep: async () => {},
  });
}

const audience = (over: any = {}) => ({
  id: 20000001,
  dmpSegmentId: 70000002,
  targetingFilter: { include: { and: [{ or: { [LOCATIONS_FACET]: [CA] } }] } },
  seeds: [SEED],
  desiredAudienceCount: 300000,
  versionTag: "0",
  ...over,
});
const parent = (over: any = {}) => ({
  id: 70000002,
  name: "Test LaL",
  sourcePlatform: "LINKEDIN_BUSINESS_OBJECTIVE_BASED_AUDIENCES",
  account: ACCOUNT_URN,
  type: "USER",
  destinations: [{ destination: "LINKEDIN", status: "BUILDING", audienceSize: 0 }],
  ...over,
});

describe("buildTargetingFilter", () => {
  it("wraps geo URNs in the include/and/or locations shape", () => {
    expect(buildTargetingFilter([CA, US])).toEqual({
      include: { and: [{ or: { [LOCATIONS_FACET]: [CA, US] } }] },
    });
  });
  it("refuses an empty list (LinkedIn requires a geo filter)", () => {
    expect(() => buildTargetingFilter([])).toThrow(/at least one location/);
  });
  it("refuses anything that is not urn:li:geo:<digits>", () => {
    expect(() => buildTargetingFilter(["US"])).toThrow(/urn:li:geo/);
  });
});

describe("assertAccountConfirmed", () => {
  it("passes when both are given and equal", () => {
    expect(() => assertAccountConfirmed(ACCOUNT, ACCOUNT)).not.toThrow();
  });
  it("refuses a missing account_id (never resolved from context)", () => {
    expect(() => assertAccountConfirmed(undefined, ACCOUNT)).toThrow(/account_id is required/);
  });
  it("refuses a missing confirmation", () => {
    expect(() => assertAccountConfirmed(ACCOUNT, undefined)).toThrow(/confirm_account_id/);
  });
  it("refuses a mismatch", () => {
    expect(() => assertAccountConfirmed(ACCOUNT, "500000002")).toThrow(/does not match/);
  });
});

describe("parseCreatedId", () => {
  it("reads x-restli-id (what 202607 returns)", () => {
    expect(parseCreatedId(new Headers({ "x-restli-id": "20000001" }))).toBe("20000001");
  });
  it("falls back to x-linkedin-id", () => {
    expect(parseCreatedId(new Headers({ "x-linkedin-id": "70000002" }))).toBe("70000002");
  });
  it("falls back to the last Location segment", () => {
    expect(parseCreatedId(new Headers({ location: "/dmpSegments/70000002" }))).toBe("70000002");
  });
  it("returns null when no id is present", () => {
    expect(parseCreatedId(new Headers({}))).toBeNull();
  });
});

describe("PredictiveAudienceClient.list", () => {
  it("lists only predictive-audience parents and attaches each audience", async () => {
    const f = fakeFetch([
      ["GET https://api.linkedin.com/rest/dmpSegments?q=account&account=urn%3Ali%3AsponsoredAccount%3A500000001", res(200, {
        elements: [parent(), { id: 1, name: "Website Visitors", sourcePlatform: "WEBSITE" }],
        paging: { start: 0, count: 100, total: 2 },
      })],
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002/businessObjectiveBasedAudiences", res(200, { elements: [audience()] })],
    ]);
    const out = await client(f).list(ACCOUNT);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      dmp_segment_id: "70000002",
      name: "Test LaL",
      audience_id: "20000001",
      locations: [CA],
      seeds: [SEED],
      desired_audience_count: 300000,
    });
    for (const c of f.calls) expect(c.headers["LinkedIn-Version"]).toBe(PA_VERSION);
  });
});

describe("PredictiveAudienceClient.get", () => {
  it("returns the parent plus its audience in a flat shape", async () => {
    const f = fakeFetch([
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002/businessObjectiveBasedAudiences", res(200, { elements: [audience()] })],
    ]);
    const out = await client(f).get("70000002");
    expect(out).toMatchObject({
      dmp_segment_id: "70000002",
      account_id: ACCOUNT,
      audience_id: "20000001",
      targeting_filter: audience().targetingFilter,
      locations: [CA],
      destinations: parent().destinations,
    });
  });
});

describe("PredictiveAudienceClient.create", () => {
  const args = {
    accountId: ACCOUNT,
    confirmAccountId: ACCOUNT,
    name: "Test LaL",
    locations: [CA],
    seeds: [SEED],
    desiredAudienceCount: 300000,
  };

  it("dry_run makes no calls and returns both payloads", async () => {
    const f = fakeFetch([]);
    const out = await client(f).create({ ...args, dryRun: true });
    expect(f.calls).toHaveLength(0);
    expect(out.dry_run).toBe(true);
    expect(out.parent_payload).toEqual({
      name: "Test LaL",
      sourcePlatform: "LINKEDIN_BUSINESS_OBJECTIVE_BASED_AUDIENCES",
      account: ACCOUNT_URN,
      type: "USER",
      destinations: [{ destination: "LINKEDIN" }],
    });
    expect(out.audience_payload).toEqual({
      targetingFilter: buildTargetingFilter([CA]),
      seeds: [SEED],
      desiredAudienceCount: 300000,
    });
  });

  it("refuses an unconfirmed account before any call", async () => {
    const f = fakeFetch([]);
    await expect(client(f).create({ ...args, confirmAccountId: "500000002" })).rejects.toThrow(/does not match/);
    expect(f.calls).toHaveLength(0);
  });

  it("refuses a missing desired_audience_count", async () => {
    const f = fakeFetch([]);
    await expect(client(f).create({ ...args, desiredAudienceCount: undefined as any })).rejects.toThrow(/desired_audience_count/);
  });

  it("creates parent, retries the audience POST through the post-create 404, then reads back", async () => {
    const f = fakeFetch([
      ["POST https://api.linkedin.com/rest/dmpSegments", res(201, undefined, { "x-restli-id": "70000002" })],
      ["POST https://api.linkedin.com/rest/dmpSegments/70000002/businessObjectiveBasedAudiences", res(404, { message: "not found" })],
      ["POST https://api.linkedin.com/rest/dmpSegments/70000002/businessObjectiveBasedAudiences", res(201, undefined, { "x-restli-id": "20000001" })],
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002/businessObjectiveBasedAudiences", res(200, { elements: [audience()] })],
    ]);
    const out = await client(f).create(args);
    expect(out).toMatchObject({ dmp_segment_id: "70000002", audience_id: "20000001", mismatches: [] });
    expect(out.read_back.desired_audience_count).toBe(300000);
    expect(f.calls[0].body.account).toBe(ACCOUNT_URN);
    expect(f.calls[1].body).toEqual(out.audience_payload);
    for (const c of f.calls) expect(c.headers["LinkedIn-Version"]).toBe(PA_VERSION);
  });

  it("never retries the parent POST itself", async () => {
    const f = fakeFetch([
      ["POST https://api.linkedin.com/rest/dmpSegments", res(500, { message: "boom" })],
    ]);
    await expect(client(f).create(args)).rejects.toThrow(/parent DMP segment.*500/);
    expect(f.calls).toHaveLength(1);
  });

  it("names the orphaned parent when the audience POST keeps failing", async () => {
    const f = fakeFetch([
      ["POST https://api.linkedin.com/rest/dmpSegments", res(201, undefined, { "x-restli-id": "70000002" })],
      ["POST https://api.linkedin.com/rest/dmpSegments/70000002/businessObjectiveBasedAudiences", res(400, { message: "bad seed" })],
    ]);
    await expect(client(f).create(args)).rejects.toThrow(/70000002.*existing_dmp_segment_id/);
  });

  it("reuses an existing parent when existing_dmp_segment_id is given", async () => {
    const f = fakeFetch([
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["POST https://api.linkedin.com/rest/dmpSegments/70000002/businessObjectiveBasedAudiences", res(201, undefined, { "x-restli-id": "20000001" })],
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002/businessObjectiveBasedAudiences", res(200, { elements: [audience()] })],
    ]);
    const out = await client(f).create({ ...args, existingDmpSegmentId: "70000002" });
    expect(out.audience_id).toBe("20000001");
  });

  it("refuses to reuse a parent owned by another account", async () => {
    const f = fakeFetch([
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent({ account: "urn:li:sponsoredAccount:500000002" }))],
    ]);
    await expect(client(f).create({ ...args, existingDmpSegmentId: "70000002" })).rejects.toThrow(/belongs to account 500000002/);
    expect(f.calls).toHaveLength(1);
  });
});

describe("PredictiveAudienceClient.update", () => {
  const base = { accountId: ACCOUNT, confirmAccountId: ACCOUNT, dmpSegmentId: "70000002" };
  const PA_PATH = "https://api.linkedin.com/rest/dmpSegments/70000002/businessObjectiveBasedAudiences";

  it("refuses when nothing is being changed", async () => {
    const f = fakeFetch([]);
    await expect(client(f).update(base)).rejects.toThrow(/nothing to update/);
  });

  it("refuses a segment owned by another account, before writing", async () => {
    const f = fakeFetch([
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent({ account: "urn:li:sponsoredAccount:500000002" }))],
      ["GET " + PA_PATH, res(200, { elements: [audience()] })],
    ]);
    await expect(client(f).update({ ...base, desiredAudienceCount: 400000 })).rejects.toThrow(/belongs to account 500000002/);
    expect(f.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("partial-updates locations and size with $set, renames the parent, and reads back", async () => {
    const after = audience({
      desiredAudienceCount: 400000,
      versionTag: "1",
      targetingFilter: buildTargetingFilter([CA, US]),
    });
    const f = fakeFetch([
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET " + PA_PATH, res(200, { elements: [audience()] })],
      ["POST " + PA_PATH + "/20000001", res(204)],
      ["POST https://api.linkedin.com/rest/dmpSegments/70000002", res(204)],
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent({ name: "Renamed" }))],
      ["GET " + PA_PATH, res(200, { elements: [after] })],
    ]);
    const out = await client(f).update({
      ...base,
      locations: [CA, US],
      desiredAudienceCount: 400000,
      name: "Renamed",
    });
    const patch = f.calls[2];
    expect(patch.headers["X-RestLi-Method"]).toBe("PARTIAL_UPDATE");
    expect(patch.body).toEqual({
      patch: { $set: { targetingFilter: buildTargetingFilter([CA, US]), desiredAudienceCount: 400000 } },
    });
    expect(f.calls[3].body).toEqual({ patch: { $set: { name: "Renamed" } } });
    expect(out.before.desired_audience_count).toBe(300000);
    expect(out.read_back.desired_audience_count).toBe(400000);
    expect(out.read_back.name).toBe("Renamed");
    expect(out.mismatches).toEqual([]);
  });

  it("retries the patch through the post-create 404 (live 2026-11-05: patch seconds after create 404'd)", async () => {
    const after = audience({ desiredAudienceCount: 400000, versionTag: "1" });
    const f = fakeFetch([
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET " + PA_PATH, res(200, { elements: [audience()] })],
      ["POST " + PA_PATH + "/20000001", res(404, { message: "Unable to find entity" })],
      ["POST " + PA_PATH + "/20000001", res(204)],
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET " + PA_PATH, res(200, { elements: [after] })],
    ]);
    const out = await client(f).update({ ...base, desiredAudienceCount: 400000 });
    expect(out.mismatches).toEqual([]);
  });

  it("re-reads through a stale read-back (live 2026-11-05: write landed, first GET still old)", async () => {
    const after = audience({ desiredAudienceCount: 400000, versionTag: "1" });
    const f = fakeFetch([
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET " + PA_PATH, res(200, { elements: [audience()] })],
      ["POST " + PA_PATH + "/20000001", res(204)],
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET " + PA_PATH, res(200, { elements: [audience()] })],
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET " + PA_PATH, res(200, { elements: [after] })],
    ]);
    const out = await client(f).update({ ...base, desiredAudienceCount: 400000 });
    expect(out.mismatches).toEqual([]);
    expect(out.read_back.desired_audience_count).toBe(400000);
  });

  it("reports a field that still has not stuck after every re-read", async () => {
    const stale: Array<[string, Response | (() => Response)]> = [];
    for (let i = 0; i < READBACK_ATTEMPTS; i++) {
      stale.push(["GET https://api.linkedin.com/rest/dmpSegments/70000002", () => res(200, parent())]);
      stale.push(["GET " + PA_PATH, () => res(200, { elements: [audience()] })]);
    }
    const f = fakeFetch([
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET " + PA_PATH, res(200, { elements: [audience()] })],
      ["POST " + PA_PATH + "/20000001", res(204)],
      ...stale,
    ]);
    const out = await client(f).update({ ...base, desiredAudienceCount: 400000 });
    expect(out.mismatches).toEqual([{ field: "desired_audience_count", wanted: 400000, got: 300000 }]);
    expect(f.remaining).toHaveLength(0);
  });

  it("dry_run reads current state but writes nothing", async () => {
    const f = fakeFetch([
      ["GET https://api.linkedin.com/rest/dmpSegments/70000002", res(200, parent())],
      ["GET " + PA_PATH, res(200, { elements: [audience()] })],
    ]);
    const out = await client(f).update({ ...base, seeds: [SEED], dryRun: true });
    expect(out.dry_run).toBe(true);
    expect(out.audience_patch).toEqual({ patch: { $set: { seeds: [SEED] } } });
    expect(f.calls.every((c) => c.method === "GET")).toBe(true);
  });
});
