/**
 * Test doubles for driving src/index.ts in-process without touching LinkedIn.
 *
 * - FAKE_ENV: an access token long enough to pass validateCredentials() and
 *   an account id, so the LinkedInAdsManager constructor at module load does
 *   not throw. With an access token set there is no refresh, so no token
 *   request and no Keychain branch.
 * - createRecordingFetch(): a fetch stand-in that records every request and
 *   answers from a route function. It must be stubbed before index.js is
 *   imported, because PredictiveAudienceClient captures fetch when the
 *   manager is constructed. It never calls the real fetch.
 */

export const FAKE_ACCOUNT_ID = "500000001";

export const FAKE_ENV: Record<string, string> = {
  LINKEDIN_ADS_ACCESS_TOKEN: "fake-access-token-0001",
  LINKEDIN_ADS_ACCOUNT_ID: FAKE_ACCOUNT_ID,
};

export const BASE_URL = "https://api.linkedin.com/rest";

export interface RecordedRequest {
  method: string;
  url: string;
  /** The URL with the REST base stripped, query string included. */
  path: string;
  body: any;
}

export type Route = (req: RecordedRequest) => { status: number; body?: unknown; headers?: Record<string, string> };

const defaultRoute: Route = () => ({ status: 200, body: { elements: [] } });

export function createRecordingFetch() {
  const requests: RecordedRequest[] = [];
  let route: Route = defaultRoute;

  const fetch = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    const req = { method, url, path: url.replace(BASE_URL, ""), body };
    requests.push(req);
    const { status, body: resBody, headers } = route(req);
    const payload = status === 204 ? null : JSON.stringify(resBody ?? {});
    return new Response(payload, { status, headers });
  };

  return {
    fetch,
    requests,
    get total() {
      return requests.length;
    },
    setRoute(r: Route) {
      route = r;
    },
    reset() {
      requests.length = 0;
      route = defaultRoute;
    },
  };
}
