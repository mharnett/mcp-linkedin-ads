// The helper's real callback handler, served over plain HTTP so no certificate
// is needed. The token endpoint and the token store are both injected, so
// nothing leaves the machine or touches a Keychain.
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";

const require = createRequire(import.meta.url);
const { startCallbackServer } = require("../get-refresh-token.cjs");

// Opaque, so no 8-character run can collide with a service or variable name.
const REFRESH = "Zq7Wm2Kp9Xv4Bn6Tj1Hd8Rs3Lf5Gc0Ya";
const ACCESS = "Pu3Ek8Nw1Oi6Ma9Dz2Fx7Cb4Vq5Jt0Sr";

/** No 8-character run of a token may appear: a prefix is a leak too. */
function expectNoTokenFragment(text: string) {
  for (const token of [REFRESH, ACCESS]) {
    for (let i = 0; i + 8 <= token.length; i++) expect(text).not.toContain(token.slice(i, i + 8));
  }
}

const saved = () => ({ where: "keychain" });

async function callback(tokenReply: () => Promise<any>, storeImpl: (e: any) => any = saved) {
  const logs: string[] = [];
  const store = vi.fn(storeImpl);
  let done: (code: number) => void;
  const exit = new Promise<number>((r) => (done = r));
  const servers = await startCallbackServer({
    port: 0,
    createServer: (handler: any) => http.createServer(handler),
    state: "the-state",
    clientId: "client-id",
    clientSecret: "client-secret",
    deps: { fetch: tokenReply, store, log: (...a: unknown[]) => logs.push(a.map(String).join(" ")), done: (c: number) => done(c) },
  });
  const addresses = servers.map((s: any) => s.address().address);
  const res = await fetch(`http://127.0.0.1:${servers[0].address().port}/callback?code=abc&state=the-state`, {
    headers: { connection: "close" },
  });
  const body = await res.text();
  const code = await exit;
  await Promise.all(servers.map((s: any) => new Promise((r) => s.close(r))));
  return { printed: logs.join("\n"), body, status: res.status, code, store, addresses };
}

const json = (value: unknown) => async () => ({ status: 200, json: async () => value });
const both = json({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 5184000 });

describe("get-refresh-token callback server", () => {
  it("listens on loopback only", async () => {
    const { addresses } = await callback(both);
    expect(addresses).toContain("127.0.0.1");
    for (const a of addresses) expect(["127.0.0.1", "::1"]).toContain(a);
  });

  it("stores both tokens where run-mcp.sh reads them and prints neither, nor a prefix", async () => {
    const r = await callback(both);

    expect(r.store.mock.calls.map((c) => c[0])).toEqual([
      { account: "linkedin-ads-mcp", service: "linkedin-access-token", secret: ACCESS },
      { account: "linkedin-ads-mcp", service: "LINKEDIN_ADS_REFRESH_TOKEN", secret: REFRESH },
    ]);
    expect(r.printed).toContain("LINKEDIN_ADS_ACCESS_TOKEN");
    expect(r.printed).toContain("LINKEDIN_ADS_REFRESH_TOKEN");
    expectNoTokenFragment(r.printed + r.body);
    expect([r.status, r.code]).toEqual([200, 0]);
  });

  it("says so when there is no refresh token, and still saves the access token", async () => {
    const r = await callback(json({ access_token: ACCESS, expires_in: 5184000 }));

    expect(r.store).toHaveBeenCalledTimes(1);
    expect(r.printed).toMatch(/No refresh token returned/);
    expectNoTokenFragment(r.printed + r.body);
    expect(r.code).toBe(0);
  });

  it("reports a failed refresh token save as a failure, still without any token", async () => {
    const r = await callback(both, (e) =>
      e.service === "LINKEDIN_ADS_REFRESH_TOKEN" ? { where: null, error: "EACCES" } : { where: "keychain" },
    );

    expect(r.printed).toMatch(/NOT saved/);
    expectNoTokenFragment(r.printed + r.body);
    expect([r.status, r.code]).toEqual([500, 1]);
  });

  it("does not dump a reply that has a refresh token but no access token", async () => {
    const r = await callback(json({ refresh_token: REFRESH }));

    expect(r.printed).toContain("refresh_token");
    expectNoTokenFragment(r.printed + r.body);
    expect(r.store).not.toHaveBeenCalled();
    expect([r.status, r.code]).toEqual([500, 1]);
  });

  it("shows the OAuth error and its description", async () => {
    const r = await callback(json({ error: "invalid_grant", error_description: "code expired" }));
    expect(r.printed).toContain("invalid_grant: code expired");
  });

  // A JSON parse error quotes the body it failed on.
  it("does not quote an unparseable reply", async () => {
    const r = await callback(async () => ({ status: 502, json: async () => JSON.parse(REFRESH) }));

    expect(r.printed).toMatch(/not JSON/);
    expectNoTokenFragment(r.printed + r.body);
    expect(r.code).toBe(1);
  });
});
