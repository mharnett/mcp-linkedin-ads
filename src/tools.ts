import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "linkedin_ads_get_client_context",
    description: "Get the current client context and health status based on working directory. Call this first to confirm which LinkedIn Ads account you're working with.",
    inputSchema: {
      additionalProperties: false,
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
      additionalProperties: false,
      type: "object",
      properties: {},
    },
  },
  {
    name: "linkedin_ads_list_campaign_groups",
    description: "List campaign groups for a LinkedIn Ad Account.",
    inputSchema: {
      additionalProperties: false,
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
      additionalProperties: false,
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
    description: "Get campaign-level performance metrics (impressions, clicks, spend, conversions, leads, engagement, video views, reach, frequency) for a date range. Reach = approximateMemberReach (unique members exposed); frequency = impressions / reach (computed server-side). This is the main reporting tool for weekly slides.",
    inputSchema: {
      additionalProperties: false,
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
    description: "Get account-level aggregate performance metrics for a date range. Good for high-level summaries. Note: reach (approximateMemberReach) and the derived frequency field are not populated at pivot=ACCOUNT; query at CAMPAIGN/CAMPAIGN_GROUP via linkedin_ads_campaign_performance or linkedin_ads_analytics if you need reach.",
    inputSchema: {
      additionalProperties: false,
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
      additionalProperties: false,
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
          description: "Metrics to return. Default: impressions, clicks, costInLocalCurrency, landingPageClicks, oneClickLeads, oneClickLeadFormOpens, externalWebsiteConversions, externalWebsitePostClickConversions, totalEngagements, videoViews, videoCompletions, approximateMemberReach, dateRange, pivotValues. The server adds a derived `frequency` field (impressions / approximateMemberReach) when both are non-zero. Reach is only populated at pivots CAMPAIGN, CREATIVE, and CAMPAIGN_GROUP — it returns 0 at pivot=ACCOUNT.",
        },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by numeric string campaign IDs" },
        campaign_group_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign group IDs" },
      },
      required: ["start_date", "end_date", "pivot"],
    },
  },
  {
    name: "linkedin_ads_list_predictive_audiences",
    description: "List LinkedIn Predictive Audiences (lookalikes) in an ad account: each parent DMP segment with its name, destinations/build status, location filter, seeds and desiredAudienceCount. account_id is required (never taken from the working directory).",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        account_id: { type: "string", description: "Ad account id" },
      },
      required: ["account_id"],
    },
  },
  {
    name: "linkedin_ads_get_predictive_audience",
    description: "Get one LinkedIn Predictive Audience by its parent DMP segment id: name, account, destinations (build status, size), targetingFilter (locations), seeds, desiredAudienceCount and versionTag.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        dmp_segment_id: { type: "string", description: "Parent DMP segment id (the id shown by list_predictive_audiences)" },
      },
      required: ["dmp_segment_id"],
    },
  },
  {
    name: "linkedin_ads_create_predictive_audience",
    description: "WRITE. Create a LinkedIn Predictive Audience (lookalike): a parent DMP segment plus its audience (locations, seeds, size), then read it back. Requires account_id AND confirm_account_id set to the same id. Use dry_run first to see the payloads. If the audience step fails after the parent was made, retry with existing_dmp_segment_id instead of creating another parent. Segments created after 2026-09-04 cannot be attached to campaigns via API; attach in Campaign Manager.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        account_id: { type: "string", description: "Ad account id to create in" },
        confirm_account_id: { type: "string", description: "Repeat account_id to confirm the write" },
        name: { type: "string", description: "Audience name" },
        locations: { type: "array", items: { type: "string" }, description: "Geo URNs, e.g. urn:li:geo:103644278 (required by LinkedIn)" },
        seeds: { type: "array", items: { type: "string" }, description: "Seed segment URNs, e.g. urn:li:dmpSegment:123456" },
        desired_audience_count: { type: "integer", description: "Target audience size (required by LinkedIn)" },
        existing_dmp_segment_id: { type: "string", description: "Reuse an existing empty parent segment (after a failed create)" },
        dry_run: { type: "boolean", description: "Return the payloads without writing" },
      },
      required: ["account_id", "confirm_account_id", "name", "locations", "seeds", "desired_audience_count"],
    },
  },
  {
    name: "linkedin_ads_update_predictive_audience",
    description: "WRITE. Partially update a LinkedIn Predictive Audience in place: name, locations (replaces the full list), seeds (replaces) and/or desired_audience_count, then read it back and report any field that did not stick. Requires account_id AND confirm_account_id set to the same id; refuses a segment owned by another account. dry_run shows the before-state and patches without writing.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        account_id: { type: "string", description: "Ad account id that owns the segment" },
        confirm_account_id: { type: "string", description: "Repeat account_id to confirm the write" },
        dmp_segment_id: { type: "string", description: "Parent DMP segment id" },
        name: { type: "string", description: "New name" },
        locations: { type: "array", items: { type: "string" }, description: "Full replacement list of geo URNs" },
        seeds: { type: "array", items: { type: "string" }, description: "Full replacement list of seed segment URNs" },
        desired_audience_count: { type: "integer", description: "New target audience size" },
        dry_run: { type: "boolean", description: "Show the patches without writing" },
      },
      required: ["account_id", "confirm_account_id", "dmp_segment_id"],
    },
  },
];
