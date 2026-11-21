import { readFileSync, existsSync } from "fs";

export interface ClientConfig {
  account_id: string;
  name: string;
  folder: string;
}

export interface Config {
  oauth: { client_id: string; client_secret: string; token_url: string; scope: string };
  /** version is always DEFAULT_API_VERSION after buildConfig; it is not configurable. */
  api: { base_url: string; version: string };
  clients: Record<string, ClientConfig>;
}

/**
 * The one LinkedIn-Version every request sends. Nothing else sets it: a
 * `version` in config.json is ignored (with a warning), and config.example.json
 * carries none. Predictive audiences need 202607 or later (the child path 404s
 * at 202604). LinkedIn supports each version for a year: 202607 sunsets
 * 2027-07-15 (learn.microsoft.com/linkedin/marketing/integrations/migrations).
 * tests/api-version.test.ts pins all of this.
 */
export const DEFAULT_API_VERSION = "202607";

/** Headers for every LinkedIn REST call: reporting, campaigns and predictive audiences. */
export function restliHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": DEFAULT_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

const clean = (v: string | undefined): string => (v || "").trim().replace(/^["']|["']$/g, "");

/**
 * Load the server config.
 *
 * 1. `config.json` beside the package wins when present (existing installs),
 *    except `api.version`: the LinkedIn-Version is always DEFAULT_API_VERSION.
 * 2. Otherwise build it from the documented env vars, taking the API and OAuth
 *    defaults from the shipped config.example.json. This is the `npx` path: the
 *    package never contains a config.json.
 */
export function buildConfig(opts: {
  configPath: string;
  examplePath: string;
  env: Record<string, string | undefined>;
  warn?: (message: string) => void;
}): Config {
  const { configPath, examplePath, env } = opts;
  const warn = opts.warn ?? ((m: string) => console.error(m));
  if (existsSync(configPath)) {
    const fromFile = JSON.parse(readFileSync(configPath, "utf-8"));
    const pinned = fromFile?.api?.version;
    if (pinned !== undefined && String(pinned) !== DEFAULT_API_VERSION) {
      warn(
        `[config] Ignoring api.version ${pinned} in config.json: every request sends ` +
          `LinkedIn-Version ${DEFAULT_API_VERSION}. Delete that line to silence this.`,
      );
    }
    return { ...fromFile, api: { ...fromFile.api, version: DEFAULT_API_VERSION } };
  }

  const accessToken = clean(env.LINKEDIN_ADS_ACCESS_TOKEN);
  const refreshToken = clean(env.LINKEDIN_ADS_REFRESH_TOKEN);
  const clientId = clean(env.LINKEDIN_ADS_CLIENT_ID);
  const clientSecret = clean(env.LINKEDIN_ADS_CLIENT_SECRET);

  if (!accessToken) {
    const missing: string[] = [];
    if (!refreshToken) missing.push("LINKEDIN_ADS_ACCESS_TOKEN (or LINKEDIN_ADS_REFRESH_TOKEN)");
    if (!clientId) missing.push("LINKEDIN_ADS_CLIENT_ID");
    if (!clientSecret) missing.push("LINKEDIN_ADS_CLIENT_SECRET");
    if (missing.length > 0) {
      throw new Error(
        `No config.json at ${configPath} and env vars are incomplete. Set ${missing.join(", ")}. ` +
          `An access token alone is enough to start; a refresh token also needs LINKEDIN_ADS_CLIENT_ID and LINKEDIN_ADS_CLIENT_SECRET. ` +
          `Or create config.json from config.example.json. Run 'node get-refresh-token.cjs' to obtain a refresh token.`,
      );
    }
  }

  if (!existsSync(examplePath)) {
    throw new Error(`Default settings file missing at ${examplePath}; reinstall the package or create config.json.`);
  }
  const defaults = JSON.parse(readFileSync(examplePath, "utf-8"));

  const accountId = clean(env.LINKEDIN_ADS_ACCOUNT_ID);
  return {
    oauth: {
      client_id: clientId,
      client_secret: clientSecret,
      token_url: defaults.oauth.token_url,
      scope: defaults.oauth.scope,
    },
    api: { base_url: defaults.api.base_url, version: DEFAULT_API_VERSION },
    clients: accountId ? { default: { account_id: accountId, name: "Default account", folder: "" } } : {},
  };
}
