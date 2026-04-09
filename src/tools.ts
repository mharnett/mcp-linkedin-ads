import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "linkedin_ads_get_client_context",
    description: "Get the current client context and health status based on working directory. Call this first to confirm which LinkedIn Ads account you're working with.",
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
