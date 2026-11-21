import { describe, it, expect } from "vitest";
import { buildAnalyticsUrl, DEFAULT_ANALYTICS_FIELDS } from "../src/analytics.js";

// Pinned against LinkedIn's Reporting docs (Analytics Finder, "Requesting
// specific metrics"), identical for versions 202601-202611, checked 2026-11-21:
//   GET /rest/adAnalytics?q=analytics&dateRange=(start:(year:2024,month:5,day:28),end:(year:2024,month:9,day:30))
//       &timeGranularity=DAILY&accounts=List(urn%3Ali%3AsponsoredAccount%3A502840441)
//       &pivot=MEMBER_COMPANY&fields=externalWebsiteConversions,dateRange,...
// dateRange, the List() wrapper and the fields commas stay literal; only the
// URNs inside List() are percent-encoded. "Request up to 20 metrics."

const BASE = "https://api.linkedin.com/rest";

describe("adAnalytics request shape", () => {
  it("builds the documented analytics-finder URL for an account", () => {
    const url = buildAnalyticsUrl(BASE, {
      accountId: "123",
      startDate: "2026-11-01",
      endDate: "2026-11-12",
      pivot: "CAMPAIGN",
      fields: ["impressions", "clicks", "dateRange", "pivotValues"],
    });
    expect(url).toBe(
      "https://api.linkedin.com/rest/adAnalytics?q=analytics" +
        "&pivot=CAMPAIGN" +
        "&dateRange=(start:(year:2026,month:11,day:1),end:(year:2026,month:11,day:12))" +
        "&timeGranularity=ALL" +
        "&accounts=List(urn%3Ali%3AsponsoredAccount%3A123)" +
        "&fields=impressions,clicks,dateRange,pivotValues",
    );
  });

  it("adds campaign and campaign-group facets as List() of encoded URNs", () => {
    const url = buildAnalyticsUrl(BASE, {
      accountId: "123",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      pivot: "CREATIVE",
      timeGranularity: "DAILY",
      fields: ["impressions"],
      campaignIds: ["1", "2"],
      campaignGroupIds: ["9"],
    });
    expect(url).toContain("&timeGranularity=DAILY");
    expect(url).toContain(
      "&campaigns=List(urn%3Ali%3AsponsoredCampaign%3A1,urn%3Ali%3AsponsoredCampaign%3A2)",
    );
    expect(url).toContain("&campaignGroups=List(urn%3Ali%3AsponsoredCampaignGroup%3A9)");
  });

  it("default fields stay within LinkedIn's 20-metric limit and keep dateRange and pivotValues", () => {
    expect(DEFAULT_ANALYTICS_FIELDS.length).toBeLessThanOrEqual(20);
    expect(DEFAULT_ANALYTICS_FIELDS).toContain("dateRange");
    expect(DEFAULT_ANALYTICS_FIELDS).toContain("pivotValues");
    const url = buildAnalyticsUrl(BASE, {
      accountId: "123",
      startDate: "2026-11-01",
      endDate: "2026-11-12",
      pivot: "ACCOUNT",
    });
    expect(url.endsWith(`&fields=${DEFAULT_ANALYTICS_FIELDS.join(",")}`)).toBe(true);
  });
});
