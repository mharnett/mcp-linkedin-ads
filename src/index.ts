#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import {
  LinkedInAdsAuthError,
  LinkedInAdsRateLimitError,
  LinkedInAdsServiceError,
  classifyError,
  validateCredentials,
} from "./errors.js";
import { tools } from "./tools.js";
import { filterTools, assertWriteAllowed, isWriteEnabled } from "./writeGate.js";
import { withResilience, safeResponse, logger } from "./resilience.js";
import v8 from "v8";

// CLI package info
const __cliPkg = JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), "..", "package.json"), "utf-8"));

// Log build fingerprint at startup
try {
  const __buildInfoDir = dirname(new URL(import.meta.url).pathname);
  const buildInfo = JSON.parse(readFileSync(join(__buildInfoDir, "build-info.json"), "utf-8"));
  console.error(`[build] SHA: ${buildInfo.sha} (${buildInfo.builtAt})`);
} catch {
  console.error(`[build] ${__cliPkg.name}@${__cliPkg.version} (dev mode)`);
}

// Version safety: warn if running a deprecated or dangerously old version
const __minimumSafeVersion = "1.0.5"; // minimum version with input sanitization
const __semverLt = (a: string, b: string) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) < (pb[i] || 0)) return true; if ((pa[i] || 0) > (pb[i] || 0)) return false; } return false; };
if (__semverLt(__cliPkg.version, __minimumSafeVersion)) {
  console.error(`[WARNING] Running deprecated version ${__cliPkg.version}. Minimum safe version is ${__minimumSafeVersion}. Please upgrade.`);
}

// CLI flags
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(`${__cliPkg.name} v${__cliPkg.version}\n`);
  console.error(`Usage: ${__cliPkg.name} [options]\n`);
  console.error("MCP server communicating via stdio. Configure in your .mcp.json.\n");
  console.error("Options:");
  console.error("  --help, -h       Show this help message");
  console.error("  --version, -v    Show version number");
  console.error(`\nDocumentation: https://github.com/mharnett/mcp-linkedin-ads`);
  process.exit(0);
}
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.error(__cliPkg.version);
  process.exit(0);
}

// Startup: detect npx vs direct node
if (process.argv[1]?.includes('.npm/_npx')) {
  console.error("[startup] Running via npx -- first run may be slow due to package resolution");
}

// Startup: check heap size
const heapLimit = v8.getHeapStatistics().heap_size_limit;
if (heapLimit < 256 * 1024 * 1024) {
  console.error(`[startup] WARNING: Heap limit is ${Math.round(heapLimit / 1024 / 1024)}MB`);
}

// ============================================
// ENV VAR TRIMMING
// ============================================

const envTrimmed = (key: string): string => (process.env[key] || "").trim().replace(/^["']|["']$/g, "");

// ============================================
// CONFIGURATION
// ============================================

interface ClientConfig {
  account_id: string;
  name: string;
  folder: string;
}

interface OAuthConfig {
  client_id: string;
  client_secret: string;
  token_url: string;
  scope: string;
}

interface ApiConfig {
  base_url: string;
  version: string;
}

interface Config {
  oauth: OAuthConfig;
  api: ApiConfig;
  clients: Record<string, ClientConfig>;
}

function loadConfig(): Config {
  const configPath = join(dirname(new URL(import.meta.url).pathname), "..", "config.json");
  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found at ${configPath}. Create config.json from config.example.json with your client entries, ` +
        `or set env vars LINKEDIN_ACCESS_TOKEN, LINKEDIN_ADS_REFRESH_TOKEN, linkedin-client-id, and linkedin-client-secret. ` +
        `Run 'node get-refresh-token.cjs' to obtain a refresh token.`,
    );
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function getClientFromWorkingDir(config: Config, cwd: string): ClientConfig | null {
  for (const [key, client] of Object.entries(config.clients)) {
    if (cwd.startsWith(client.folder) || cwd.toLowerCase().includes(key)) {
      return client;
    }
  }
  return null;
}

// ============================================
// LINKEDIN MARKETING API CLIENT
// ============================================

class LinkedInAdsManager {
  private config: Config;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private refreshToken: string;

  constructor(config: Config) {
    this.config = config;

    // Validate credentials at startup — fail fast
    const creds = validateCredentials();
    if (!creds.valid) {
      const msg = `Missing required credentials: ${creds.missing.join(", ")}. Check run-mcp.sh and Keychain entries.`;
      logger.error({ missing: creds.missing }, msg);
      throw new LinkedInAdsAuthError(msg);
    }
    logger.info("Credentials validated: token env vars present");

    this.refreshToken = envTrimmed("LINKEDIN_ADS_REFRESH_TOKEN");

    if (process.env.LINKEDIN_ADS_CLIENT_ID) {
      this.config.oauth.client_id = envTrimmed("LINKEDIN_ADS_CLIENT_ID");
    }
    if (process.env.LINKEDIN_ADS_CLIENT_SECRET) {
      this.config.oauth.client_secret = envTrimmed("LINKEDIN_ADS_CLIENT_SECRET");
    }

    // Support direct access token (from Keychain, 60-day TTL)
    if (process.env.LINKEDIN_ADS_ACCESS_TOKEN) {
      this.accessToken = envTrimmed("LINKEDIN_ADS_ACCESS_TOKEN");
      this.tokenExpiry = Date.now() + 59 * 24 * 3600 * 1000; // assume ~59 days left
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // If no refresh token, can't auto-renew
    if (!this.refreshToken) {
      if (this.accessToken) {
        // Token might be expired but try it anyway
        return this.accessToken;
      }
      throw new LinkedInAdsAuthError("No access token or refresh token available. Run oauth_flow.py to get a new token.");
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.oauth.client_id,
      client_secret: this.config.oauth.client_secret,
      refresh_token: this.refreshToken,
    });

    const resp = await fetch(this.config.oauth.token_url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      const error = new Error(`OAuth token refresh failed: ${resp.status} ${text}`);
      throw classifyError(error);
    }

    const data = await resp.json() as any;
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

    // Persist rotated refresh token to Keychain so restarts use the latest
    if (data.refresh_token && data.refresh_token !== this.refreshToken) {
      this.refreshToken = data.refresh_token;
      if (process.platform === "darwin") {
        try {
          const { execFileSync } = await import("child_process");
          try { execFileSync("security", ["delete-generic-password", "-a", "linkedin-ads-mcp", "-s", "LINKEDIN_ADS_REFRESH_TOKEN"], { stdio: "ignore" }); } catch { /* may not exist yet */ }
          execFileSync("security", ["add-generic-password", "-a", "linkedin-ads-mcp", "-s", "LINKEDIN_ADS_REFRESH_TOKEN", "-w", data.refresh_token]);
          logger.info("Rotated refresh token persisted to Keychain");
        } catch (err) {
          logger.warn({ err }, "Failed to persist rotated refresh token to Keychain");
        }
      } else {
        console.error("[token] Rotated refresh token received but Keychain not available (non-macOS). Token will be used for this session only.");
      }
    }

    return this.accessToken!;
  }

  private async apiGet(path: string, params?: Record<string, string>): Promise<any> {
    const token = await this.getAccessToken();
    let url = `${this.config.api.base_url}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += (url.includes("?") ? "&" : "?") + qs;
    }

    return withResilience(async () => {
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "LinkedIn-Version": this.config.api.version,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        const text = await resp.text();
        const error = Object.assign(new Error(`LinkedIn API error: ${resp.status} ${text}`), { status: resp.status });
        throw classifyError(error);
      }

      return await resp.json();
    }, `apiGet:${path}`);
  }

  // Raw GET with pre-built URL (for complex Rest.li query params)
  private async apiGetRaw(fullUrl: string): Promise<any> {
    const token = await this.getAccessToken();

    return withResilience(async () => {
      const resp = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "LinkedIn-Version": this.config.api.version,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        const text = await resp.text();
        const error = Object.assign(new Error(`LinkedIn API error: ${resp.status} ${text}`), { status: resp.status });
        throw classifyError(error);
      }

      return await resp.json();
    }, `apiGetRaw:${fullUrl.split("?")[0]}`);
  }

  // ============================================
  // ACCOUNT MANAGEMENT
  // ============================================

  async listAccounts(): Promise<any> {
    const url = `${this.config.api.base_url}/adAccounts?q=search&search=(status:(values:List(ACTIVE)))&count=100`;
    return await this.apiGetRaw(url);
  }

  // ============================================
  // CAMPAIGN MANAGEMENT
  // ============================================

  async listCampaignGroups(accountId: string): Promise<any> {
    const url = `${this.config.api.base_url}/adAccounts/${accountId}/adCampaignGroups?q=search&search=(status:(values:List(ACTIVE,PAUSED)))&count=100`;
    return await this.apiGetRaw(url);
  }

  async listCampaigns(accountId: string, options?: {
    status?: string[];
    campaignGroupId?: string;
  }): Promise<any> {
    const statuses = options?.status || ["ACTIVE", "PAUSED"];
    const statusList = `List(${statuses.join(",")})`;
    let searchParams = `(status:(values:${statusList}))`;

    let url = `${this.config.api.base_url}/adAccounts/${accountId}/adCampaigns?q=search&search=${encodeURIComponent(searchParams)}&count=100`;

    if (options?.campaignGroupId) {
      url += `&search.campaignGroup.values=List(urn%3Ali%3AsponsoredCampaignGroup%3A${options.campaignGroupId})`;
    }

    return await this.apiGetRaw(url);
  }

  // ============================================
  // ANALYTICS / REPORTING
  // ============================================

  private buildDateRange(startDate: string, endDate: string): string {
    const [sy, sm, sd] = startDate.split("-").map(Number);
    const [ey, em, ed] = endDate.split("-").map(Number);
    return `(start:(year:${sy},month:${sm},day:${sd}),end:(year:${ey},month:${em},day:${ed}))`;
  }

  async getAnalytics(options: {
    accountId: string;
    startDate: string;
    endDate: string;
    pivot: string;
    timeGranularity?: string;
    fields?: string[];
    campaignIds?: string[];
    campaignGroupIds?: string[];
  }): Promise<any> {
    const dateRange = this.buildDateRange(options.startDate, options.endDate);
    const granularity = options.timeGranularity || "ALL";
    const fields = options.fields || [
      "impressions", "clicks", "costInLocalCurrency", "landingPageClicks",
      "oneClickLeads", "oneClickLeadFormOpens",
      "externalWebsiteConversions", "externalWebsitePostClickConversions",
      "totalEngagements", "videoViews", "videoCompletions",
      "dateRange", "pivotValues",
    ];

    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${options.accountId}`);
    let url = `${this.config.api.base_url}/adAnalytics?q=analytics` +
      `&pivot=${options.pivot}` +
      `&dateRange=${encodeURIComponent(dateRange)}` +
      `&timeGranularity=${granularity}` +
      `&accounts=List(${accountUrn})` +
      `&fields=${fields.join(",")}`;

    if (options.campaignIds && options.campaignIds.length > 0) {
      const urns = options.campaignIds
        .map(id => encodeURIComponent(`urn:li:sponsoredCampaign:${id}`))
        .join(",");
      url += `&campaigns=List(${urns})`;
    }

    if (options.campaignGroupIds && options.campaignGroupIds.length > 0) {
      const urns = options.campaignGroupIds
        .map(id => encodeURIComponent(`urn:li:sponsoredCampaignGroup:${id}`))
        .join(",");
      url += `&campaignGroups=List(${urns})`;
    }

    return await this.apiGetRaw(url);
  }

  async getCampaignPerformance(accountId: string, options: {
    startDate: string;
    endDate: string;
    timeGranularity?: string;
  }): Promise<any> {
    return await this.getAnalytics({
      accountId,
      startDate: options.startDate,
      endDate: options.endDate,
      pivot: "CAMPAIGN",
      timeGranularity: options.timeGranularity,
    });
  }

  async getAccountPerformance(accountId: string, options: {
    startDate: string;
    endDate: string;
    timeGranularity?: string;
  }): Promise<any> {
    return await this.getAnalytics({
      accountId,
      startDate: options.startDate,
      endDate: options.endDate,
      pivot: "ACCOUNT",
      timeGranularity: options.timeGranularity,
    });
  }

  getConfig(): Config {
    return this.config;
  }
}

// ============================================
// MCP SERVER
// ============================================

const config = loadConfig();
const adsManager = new LinkedInAdsManager(config);

const server = new Server(
  {
    name: __cliPkg.name,
    version: __cliPkg.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: filterTools(tools) };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    assertWriteAllowed(name);
    const resolveAccountId = (accountId?: string): string => {
      if (accountId) return accountId;
      const clients = Object.values(config.clients);
      if (clients.length === 0) throw new Error("No clients configured");
      return clients[0].account_id;
    };

    switch (name) {
      case "linkedin_ads_get_client_context": {
        const cwd = args?.working_directory as string;
        const client = getClientFromWorkingDir(config, cwd);
        if (!client) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "No client found for working directory",
                working_directory: cwd,
                available_clients: Object.entries(config.clients).map(([k, v]) => ({
                  key: k,
                  name: v.name,
                  folder: v.folder,
                })),
              }, null, 2),
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              client_name: client.name,
              account_id: client.account_id,
              folder: client.folder,
            }, null, 2),
          }],
        };
      }

      case "linkedin_ads_list_accounts": {
        const result = await adsManager.listAccounts();
        return {
          content: [{ type: "text", text: JSON.stringify(safeResponse(result, "list_accounts"), null, 2) }],
        };
      }

      case "linkedin_ads_list_campaign_groups": {
        const accountId = resolveAccountId(args?.account_id as string);
        const result = await adsManager.listCampaignGroups(accountId);
        return {
          content: [{ type: "text", text: JSON.stringify(safeResponse(result, "list_campaign_groups"), null, 2) }],
        };
      }

      case "linkedin_ads_list_campaigns": {
        const accountId = resolveAccountId(args?.account_id as string);
        const result = await adsManager.listCampaigns(accountId, {
          status: args?.status as string[],
          campaignGroupId: args?.campaign_group_id as string,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(safeResponse(result, "list_campaigns"), null, 2) }],
        };
      }

      case "linkedin_ads_campaign_performance": {
        const accountId = resolveAccountId(args?.account_id as string);
        const result = await adsManager.getCampaignPerformance(accountId, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          timeGranularity: args?.time_granularity as string,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(safeResponse(result, "campaign_performance"), null, 2) }],
        };
      }

      case "linkedin_ads_account_performance": {
        const accountId = resolveAccountId(args?.account_id as string);
        const result = await adsManager.getAccountPerformance(accountId, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          timeGranularity: args?.time_granularity as string,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(safeResponse(result, "account_performance"), null, 2) }],
        };
      }

      case "linkedin_ads_analytics": {
        const accountId = resolveAccountId(args?.account_id as string);
        const result = await adsManager.getAnalytics({
          accountId,
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          pivot: args?.pivot as string,
          timeGranularity: args?.time_granularity as string,
          fields: args?.fields as string[],
          campaignIds: args?.campaign_ids as string[],
          campaignGroupIds: args?.campaign_group_ids as string[],
        });
        return {
          content: [{ type: "text", text: JSON.stringify(safeResponse(result, "analytics"), null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (rawError: any) {
    const classified = classifyError(rawError);
    const isAuth = classified instanceof LinkedInAdsAuthError;
    // Size-limit error responses through safeResponse to prevent oversized payloads
    const safeErrorResponse = safeResponse({
      error: true,
      error_type: classified.name,
      message: classified.message,
      server: __cliPkg.name,
      action_required: isAuth
        ? "Re-authenticate LinkedIn Ads and update Keychain: security add-generic-password -a linkedin-ads-mcp -s LINKEDIN_ADS_REFRESH_TOKEN -w <new_token>"
        : undefined,
      details: rawError.stack,
    }, "error");
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify(safeErrorResponse, null, 2),
      }],
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const writeMode = isWriteEnabled()
    ? "WRITES ENABLED (LINKEDIN_ADS_MCP_WRITE=true)"
    : "read-only (set LINKEDIN_ADS_MCP_WRITE=true to enable mutating tools)";
  console.error(`[startup] write mode: ${writeMode}`);
  logger.info("MCP LinkedIn Ads server running");
}

process.on("SIGTERM", () => {
  console.error("[shutdown] SIGTERM received, exiting");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.error("[shutdown] SIGINT received, exiting");
  process.exit(0);
});

process.on("SIGPIPE", () => {
  // Client disconnected -- expected during shutdown
});

process.on("unhandledRejection", (reason) => {
  console.error("[error] Unhandled promise rejection:", reason);
});

main().catch((err) => logger.error({ err }, "Server failed to start"));
