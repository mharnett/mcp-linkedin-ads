#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

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
    throw new Error(`Config file not found at ${configPath}. Create config.json with client entries.`);
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
    this.refreshToken = process.env.LINKEDIN_ADS_REFRESH_TOKEN || "";

    if (process.env.LINKEDIN_ADS_CLIENT_ID) {
      this.config.oauth.client_id = process.env.LINKEDIN_ADS_CLIENT_ID;
    }
    if (process.env.LINKEDIN_ADS_CLIENT_SECRET) {
      this.config.oauth.client_secret = process.env.LINKEDIN_ADS_CLIENT_SECRET;
    }

    // Support direct access token (from Keychain, 60-day TTL)
    if (process.env.LINKEDIN_ADS_ACCESS_TOKEN) {
      this.accessToken = process.env.LINKEDIN_ADS_ACCESS_TOKEN;
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
      throw new Error("No access token or refresh token available. Run oauth_flow.py to get a new token.");
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
      throw new Error(`OAuth token refresh failed: ${resp.status} ${text}`);
    }

    const data = await resp.json() as any;
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
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

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "LinkedIn-Version": this.config.api.version,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`LinkedIn API error: ${resp.status} ${text}`);
    }

    return await resp.json();
  }

  // Raw GET with pre-built URL (for complex Rest.li query params)
  private async apiGetRaw(fullUrl: string): Promise<any> {
    const token = await this.getAccessToken();

    const resp = await fetch(fullUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "LinkedIn-Version": this.config.api.version,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`LinkedIn API error: ${resp.status} ${text}`);
    }

    return await resp.json();
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
    name: "mcp-linkedin-ads",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const tools: Tool[] = [
  {
    name: "linkedin_ads_get_client_context",
    description: "Get the current client context based on working directory. Call this first to confirm which LinkedIn Ads account you're working with.",
    inputSchema: {
      type: "object",
      properties: {
        working_directory: {
          type: "string",
          description: "The current working directory",
        },
      },
      required: ["working_directory"],
    },
  },
  {
    name: "linkedin_ads_list_accounts",
    description: "List all active LinkedIn Ad Accounts the authenticated user has access to.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "linkedin_ads_list_campaign_groups",
    description: "List campaign groups for a LinkedIn Ad Account.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The ad account ID (uses context if not provided)",
        },
      },
    },
  },
  {
    name: "linkedin_ads_list_campaigns",
    description: "List campaigns for a LinkedIn Ad Account, with optional status and campaign group filters.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "The ad account ID" },
        status: {
          type: "array",
          items: { type: "string" },
          description: "Filter by status: ACTIVE, PAUSED, ARCHIVED, COMPLETED, CANCELED, DRAFT. Default: ACTIVE, PAUSED",
        },
        campaign_group_id: { type: "string", description: "Filter by campaign group ID" },
      },
    },
  },
  {
    name: "linkedin_ads_campaign_performance",
    description: "Get campaign-level performance metrics (impressions, clicks, spend, conversions, leads, engagement, video views) for a date range. This is the main reporting tool for weekly slides.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
        time_granularity: { type: "string", description: "ALL (default), DAILY, or MONTHLY" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "linkedin_ads_account_performance",
    description: "Get account-level aggregate performance metrics for a date range. Good for high-level summaries.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
        time_granularity: { type: "string", description: "ALL (default), DAILY, or MONTHLY" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "linkedin_ads_analytics",
    description: "Flexible analytics query with custom pivot, fields, and filters. Use for demographic breakdowns, device splits, creative performance, etc.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
        pivot: {
          type: "string",
          description: "Pivot dimension: ACCOUNT, CAMPAIGN_GROUP, CAMPAIGN, CREATIVE, MEMBER_COMPANY_SIZE, MEMBER_INDUSTRY, MEMBER_SENIORITY, MEMBER_JOB_FUNCTION, MEMBER_COUNTRY_V2, IMPRESSION_DEVICE_TYPE, etc.",
        },
        time_granularity: { type: "string", description: "ALL (default), DAILY, or MONTHLY" },
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Metrics to return. Default: impressions, clicks, costInLocalCurrency, landingPageClicks, oneClickLeads, externalWebsiteConversions, totalEngagements, videoViews, dateRange, pivotValues",
        },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
        campaign_group_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign group IDs" },
      },
      required: ["start_date", "end_date", "pivot"],
    },
  },
];

// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
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
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "linkedin_ads_list_campaign_groups": {
        const accountId = resolveAccountId(args?.account_id as string);
        const result = await adsManager.listCampaignGroups(accountId);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "linkedin_ads_list_campaigns": {
        const accountId = resolveAccountId(args?.account_id as string);
        const result = await adsManager.listCampaigns(accountId, {
          status: args?.status as string[],
          campaignGroupId: args?.campaign_group_id as string,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: true,
          message: error.message,
          details: error.stack,
        }, null, 2),
      }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP LinkedIn Ads server running");
}

main().catch(console.error);
