/**
 * LinkedIn Predictive Audiences (lookalikes): a parent DMP segment with
 * sourcePlatform LINKEDIN_BUSINESS_OBJECTIVE_BASED_AUDIENCES plus one
 * businessObjectiveBasedAudiences child holding the geo filter, seeds and size.
 *
 * Behaviour verified live 2026-11-05 (see README "Predictive audiences"):
 * - Every call here needs LinkedIn-Version 202607; the child path 404s at 202604.
 * - desiredAudienceCount and a locations filter are required on create.
 * - The child POST 404s for a few seconds after the parent is created.
 * - Created ids come back in x-restli-id / Location, not x-linkedin-id.
 * - PARTIAL_UPDATE $set on the child changes targetingFilter, seeds and
 *   desiredAudienceCount in place; $set name on the parent renames it.
 *
 * Writes are never retried blindly: LinkedIn has no idempotency keys, so a
 * retried parent POST would create a second segment.
 */

export const PA_VERSION = "202607";
export const LOCATIONS_FACET = "urn:li:adTargetingFacet:locations";
export const PA_SOURCE_PLATFORM = "LINKEDIN_BUSINESS_OBJECTIVE_BASED_AUDIENCES";

const GEO_URN = /^urn:li:geo:\d+$/;
const SEGMENT_URN = /^urn:li:dmpSegment:\d+$/;
const CHILD_404_RETRIES = 6;
const CHILD_404_WAIT_MS = 10_000;
/** Reads lag writes: a 204'd patch read back old values once, then new (2026-11-05). */
export const READBACK_ATTEMPTS = 4;
const READBACK_WAIT_MS = 5_000;
const STILL_MISMATCHED = "Read-back still differs after re-reads. LinkedIn reads can lag writes; re-check with linkedin_ads_get_predictive_audience before retrying the write.";

export function buildTargetingFilter(locations: string[]) {
  if (!Array.isArray(locations) || locations.length === 0) {
    throw new Error("locations: at least one location is required (LinkedIn refuses a predictive audience without a geo filter)");
  }
  const bad = locations.filter((l) => !GEO_URN.test(l));
  if (bad.length) {
    throw new Error(`locations must be urn:li:geo:<id> URNs; got ${JSON.stringify(bad)}`);
  }
  return { include: { and: [{ or: { [LOCATIONS_FACET]: [...locations] } }] } };
}

function validateSeeds(seeds: string[]) {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new Error("seeds: at least one urn:li:dmpSegment:<id> seed is required");
  }
  const bad = seeds.filter((s) => !SEGMENT_URN.test(s));
  if (bad.length) throw new Error(`seeds must be urn:li:dmpSegment:<id> URNs; got ${JSON.stringify(bad)}`);
}

function validateCount(n: unknown) {
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    throw new Error(`desired_audience_count must be a positive integer; got ${JSON.stringify(n)}`);
  }
}

/**
 * Write guard. The account is never resolved from the working directory or a
 * default: the caller names it, then names it again.
 */
export function assertAccountConfirmed(accountId?: string, confirmAccountId?: string): void {
  if (!accountId) throw new Error("account_id is required for predictive audience writes; it is never resolved from context.");
  if (!confirmAccountId) {
    throw new Error(`confirm_account_id is required: repeat the account id (${accountId}) to confirm the write. Nothing was written.`);
  }
  if (String(confirmAccountId).trim() !== String(accountId).trim()) {
    throw new Error(`confirm_account_id ${confirmAccountId} does not match account_id ${accountId}. Nothing was written.`);
  }
}

export function parseCreatedId(headers: Headers): string | null {
  const direct = headers.get("x-restli-id") || headers.get("x-linkedin-id");
  if (direct) return direct;
  const loc = headers.get("location");
  if (loc) {
    const last = loc.replace(/\/+$/, "").split("/").pop();
    if (last) return last;
  }
  return null;
}

function accountIdFromUrn(urn?: string): string | undefined {
  return urn?.split(":").pop();
}

function locationsOf(filter: any): string[] {
  const out: string[] = [];
  for (const clause of filter?.include?.and ?? []) {
    out.push(...(clause?.or?.[LOCATIONS_FACET] ?? []));
  }
  return out;
}

export interface PredictiveAudienceView {
  dmp_segment_id: string;
  name?: string;
  account_id?: string;
  destinations?: any[];
  audience_id: string | null;
  targeting_filter: any;
  locations: string[];
  seeds: string[];
  desired_audience_count: number | null;
  version_tag?: string;
  created?: number;
  last_modified?: number;
  audience_count_on_parent?: number;
}

function flatten(parent: any, audiences: any[]): PredictiveAudienceView {
  const a = audiences[0];
  const view: PredictiveAudienceView = {
    dmp_segment_id: String(parent.id),
    name: parent.name,
    account_id: accountIdFromUrn(parent.account),
    destinations: parent.destinations,
    audience_id: a ? String(a.id) : null,
    targeting_filter: a?.targetingFilter ?? null,
    locations: locationsOf(a?.targetingFilter),
    seeds: a?.seeds ?? [],
    desired_audience_count: a?.desiredAudienceCount ?? null,
    version_tag: a?.versionTag,
    created: a?.created,
    last_modified: a?.lastModified,
  };
  if (audiences.length > 1) view.audience_count_on_parent = audiences.length;
  return view;
}

type Mismatch = { field: string; wanted: unknown; got: unknown };

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function compare(wanted: { name?: string; locations?: string[]; seeds?: string[]; desiredAudienceCount?: number }, got: PredictiveAudienceView): Mismatch[] {
  const out: Mismatch[] = [];
  if (wanted.name !== undefined && wanted.name !== got.name) out.push({ field: "name", wanted: wanted.name, got: got.name });
  if (wanted.locations && !sameSet(wanted.locations, got.locations)) out.push({ field: "locations", wanted: wanted.locations, got: got.locations });
  if (wanted.seeds && !sameSet(wanted.seeds, got.seeds)) out.push({ field: "seeds", wanted: wanted.seeds, got: got.seeds });
  if (wanted.desiredAudienceCount !== undefined && wanted.desiredAudienceCount !== got.desired_audience_count) {
    out.push({ field: "desired_audience_count", wanted: wanted.desiredAudienceCount, got: got.desired_audience_count });
  }
  return out;
}

export interface CreateArgs {
  accountId: string;
  confirmAccountId: string;
  name: string;
  locations: string[];
  seeds: string[];
  desiredAudienceCount: number;
  existingDmpSegmentId?: string;
  dryRun?: boolean;
}

export interface UpdateArgs {
  accountId: string;
  confirmAccountId: string;
  dmpSegmentId: string;
  name?: string;
  locations?: string[];
  seeds?: string[];
  desiredAudienceCount?: number;
  dryRun?: boolean;
}

export interface ClientOptions {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

class LinkedInHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class PredictiveAudienceClient {
  private baseUrl: string;
  private getToken: () => Promise<string>;
  private fetchFn: typeof fetch;
  private sleep: (ms: number) => Promise<void>;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.getToken = opts.getToken;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "LinkedIn-Version": PA_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      ...extraHeaders,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  }

  private async getJson(path: string): Promise<any> {
    const resp = await this.call("GET", path);
    if (!resp.ok) {
      throw new LinkedInHttpError(`LinkedIn API error: GET ${path} → ${resp.status} ${await resp.text()}`, resp.status);
    }
    return resp.json();
  }

  private async fetchPair(dmpSegmentId: string) {
    const parent = await this.getJson(`/dmpSegments/${dmpSegmentId}`);
    const kids = await this.getJson(`/dmpSegments/${dmpSegmentId}/businessObjectiveBasedAudiences`);
    return { parent, audiences: (kids?.elements ?? []) as any[] };
  }

  async list(accountId: string): Promise<PredictiveAudienceView[]> {
    if (!accountId) throw new Error("account_id is required");
    const urn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);
    const parents: any[] = [];
    const pageSize = 100;
    for (let start = 0; ; start += pageSize) {
      const page = await this.getJson(`/dmpSegments?q=account&account=${urn}&count=${pageSize}&start=${start}`);
      const els = page?.elements ?? [];
      parents.push(...els);
      if (els.length < pageSize) break;
    }
    const out: PredictiveAudienceView[] = [];
    for (const p of parents.filter((p) => p.sourcePlatform === PA_SOURCE_PLATFORM)) {
      const kids = await this.getJson(`/dmpSegments/${p.id}/businessObjectiveBasedAudiences`);
      out.push(flatten(p, kids?.elements ?? []));
    }
    return out;
  }

  async get(dmpSegmentId: string): Promise<PredictiveAudienceView> {
    if (!dmpSegmentId) throw new Error("dmp_segment_id is required");
    const { parent, audiences } = await this.fetchPair(dmpSegmentId);
    return flatten(parent, audiences);
  }

  private async readBackUntil(segId: string, wanted: Parameters<typeof compare>[0]) {
    let view = await this.get(segId);
    let mismatches = compare(wanted, view);
    for (let i = 1; mismatches.length && i < READBACK_ATTEMPTS; i++) {
      await this.sleep(READBACK_WAIT_MS);
      view = await this.get(segId);
      mismatches = compare(wanted, view);
    }
    return { view, mismatches };
  }

  private assertOwned(parent: any, accountId: string) {
    const owner = accountIdFromUrn(parent?.account);
    if (owner !== String(accountId)) {
      throw new Error(`dmpSegment ${parent?.id} belongs to account ${owner}, not ${accountId}. Nothing was written.`);
    }
    if (parent?.sourcePlatform !== PA_SOURCE_PLATFORM) {
      throw new Error(`dmpSegment ${parent?.id} is a ${parent?.sourcePlatform} segment, not a predictive audience. Nothing was written.`);
    }
  }

  async create(args: CreateArgs) {
    assertAccountConfirmed(args.accountId, args.confirmAccountId);
    if (!args.name?.trim()) throw new Error("name is required");
    validateSeeds(args.seeds);
    validateCount(args.desiredAudienceCount);
    const parentPayload = {
      name: args.name,
      sourcePlatform: PA_SOURCE_PLATFORM,
      account: `urn:li:sponsoredAccount:${args.accountId}`,
      type: "USER",
      destinations: [{ destination: "LINKEDIN" }],
    };
    const audiencePayload = {
      targetingFilter: buildTargetingFilter(args.locations),
      seeds: [...args.seeds],
      desiredAudienceCount: args.desiredAudienceCount,
    };
    if (args.dryRun) {
      return { dry_run: true, account_id: args.accountId, parent_payload: parentPayload, audience_payload: audiencePayload };
    }

    let segId: string;
    if (args.existingDmpSegmentId) {
      const parent = await this.getJson(`/dmpSegments/${args.existingDmpSegmentId}`);
      this.assertOwned(parent, args.accountId);
      segId = String(args.existingDmpSegmentId);
    } else {
      const resp = await this.call("POST", "/dmpSegments", parentPayload);
      if (resp.status !== 200 && resp.status !== 201) {
        throw new LinkedInHttpError(`parent DMP segment create failed: HTTP ${resp.status} ${await resp.text()}. Nothing was created.`, resp.status);
      }
      const id = parseCreatedId(resp.headers);
      if (!id) {
        throw new Error("parent DMP segment was created but LinkedIn returned no id. Find it with linkedin_ads_list_predictive_audiences before retrying, or you will create a duplicate.");
      }
      segId = id;
    }

    let resp: Response | undefined;
    for (let attempt = 0; attempt < CHILD_404_RETRIES; attempt++) {
      resp = await this.call("POST", `/dmpSegments/${segId}/businessObjectiveBasedAudiences`, audiencePayload);
      if (resp.status !== 404) break;
      if (attempt < CHILD_404_RETRIES - 1) await this.sleep(CHILD_404_WAIT_MS);
    }
    if (!resp || (resp.status !== 200 && resp.status !== 201)) {
      const text = resp ? await resp.text() : "";
      throw new LinkedInHttpError(
        `predictive audience create failed: HTTP ${resp?.status} ${text}. Parent dmpSegment ${segId} exists without an audience; ` +
          `retry with existing_dmp_segment_id=${segId} rather than creating another parent.`,
        resp?.status ?? 0,
      );
    }
    const audienceId = parseCreatedId(resp.headers);
    const { view: readBack, mismatches } = await this.readBackUntil(segId, {
      name: args.existingDmpSegmentId ? undefined : args.name,
      locations: args.locations,
      seeds: args.seeds,
      desiredAudienceCount: args.desiredAudienceCount,
    });
    return {
      dmp_segment_id: segId,
      audience_id: audienceId ?? readBack.audience_id,
      audience_payload: audiencePayload,
      read_back: readBack,
      mismatches,
      ...(mismatches.length ? { warning: STILL_MISMATCHED } : {}),
      note: "Segments created after 2026-09-04 cannot be attached to campaigns through the API; attach in Campaign Manager.",
    };
  }

  async update(args: UpdateArgs) {
    assertAccountConfirmed(args.accountId, args.confirmAccountId);
    if (!args.dmpSegmentId) throw new Error("dmp_segment_id is required");
    const set: Record<string, unknown> = {};
    if (args.locations !== undefined) set.targetingFilter = buildTargetingFilter(args.locations);
    if (args.seeds !== undefined) {
      validateSeeds(args.seeds);
      set.seeds = [...args.seeds];
    }
    if (args.desiredAudienceCount !== undefined) {
      validateCount(args.desiredAudienceCount);
      set.desiredAudienceCount = args.desiredAudienceCount;
    }
    const rename = args.name !== undefined;
    if (rename && !args.name!.trim()) throw new Error("name cannot be blank");
    if (!Object.keys(set).length && !rename) {
      throw new Error("nothing to update: pass at least one of name, locations, seeds, desired_audience_count");
    }

    const { parent, audiences } = await this.fetchPair(args.dmpSegmentId);
    this.assertOwned(parent, args.accountId);
    const before = flatten(parent, audiences);
    if (Object.keys(set).length && !before.audience_id) {
      throw new Error(`dmpSegment ${args.dmpSegmentId} has no predictive audience to update; create one with existing_dmp_segment_id. Nothing was written.`);
    }
    if (audiences.length > 1) {
      throw new Error(`dmpSegment ${args.dmpSegmentId} has ${audiences.length} audiences; refusing to guess which to update. Nothing was written.`);
    }
    const audiencePatch = Object.keys(set).length ? { patch: { $set: set } } : undefined;
    const parentPatch = rename ? { patch: { $set: { name: args.name } } } : undefined;
    if (args.dryRun) {
      return { dry_run: true, before, audience_patch: audiencePatch, parent_patch: parentPatch };
    }

    const PU = { "X-RestLi-Method": "PARTIAL_UPDATE" };
    if (audiencePatch) {
      const path = `/dmpSegments/${args.dmpSegmentId}/businessObjectiveBasedAudiences/${before.audience_id}`;
      // A just-created audience 404s PARTIAL_UPDATE for a while (live
      // 2026-11-05). $set is idempotent and a 404 wrote nothing, so retry.
      let r = await this.call("POST", path, audiencePatch, PU);
      for (let attempt = 1; r.status === 404 && attempt < CHILD_404_RETRIES; attempt++) {
        await this.sleep(CHILD_404_WAIT_MS);
        r = await this.call("POST", path, audiencePatch, PU);
      }
      if (!r.ok) throw new LinkedInHttpError(`audience patch failed (partial-update): HTTP ${r.status} ${await r.text()}. Nothing was changed.`, r.status);
    }
    if (parentPatch) {
      const r = await this.call("POST", `/dmpSegments/${args.dmpSegmentId}`, parentPatch, PU);
      if (!r.ok) {
        throw new LinkedInHttpError(
          `rename failed: HTTP ${r.status} ${await r.text()}.` + (audiencePatch ? " The audience fields WERE updated; check the read-back with linkedin_ads_get_predictive_audience." : ""),
          r.status,
        );
      }
    }
    const { view: readBack, mismatches } = await this.readBackUntil(args.dmpSegmentId, {
      name: args.name,
      locations: args.locations,
      seeds: args.seeds,
      desiredAudienceCount: args.desiredAudienceCount,
    });
    return {
      dmp_segment_id: args.dmpSegmentId,
      before,
      read_back: readBack,
      mismatches,
      ...(mismatches.length ? { warning: STILL_MISMATCHED } : {}),
    };
  }
}
