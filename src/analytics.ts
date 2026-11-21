import { buildDateRange } from "./dateRange.js";

/** Metrics requested when the caller names none. LinkedIn accepts up to 20. */
export const DEFAULT_ANALYTICS_FIELDS: readonly string[] = [
  "impressions", "clicks", "costInLocalCurrency", "landingPageClicks",
  "oneClickLeads", "oneClickLeadFormOpens",
  "externalWebsiteConversions", "externalWebsitePostClickConversions",
  "totalEngagements", "videoViews", "videoCompletions",
  "approximateMemberReach",
  "dateRange", "pivotValues",
];

export interface AnalyticsQuery {
  accountId: string;
  startDate: string;
  endDate: string;
  pivot: string;
  timeGranularity?: string;
  fields?: string[];
  campaignIds?: string[];
  campaignGroupIds?: string[];
}

/**
 * adAnalytics analytics-finder URL, in the shape LinkedIn's Reporting docs show
 * (same for 202601-202611): dateRange, the List() wrapper and the fields commas
 * stay literal (percent-encoding dateRange returns 400 PARAM_INVALID); only the
 * URNs inside List() are percent-encoded. tests/analytics-request.test.ts pins it.
 */
export function buildAnalyticsUrl(baseUrl: string, q: AnalyticsQuery): string {
  const fields = q.fields || DEFAULT_ANALYTICS_FIELDS;
  const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${q.accountId}`);
  let url = `${baseUrl}/adAnalytics?q=analytics` +
    `&pivot=${q.pivot}` +
    `&dateRange=${buildDateRange(q.startDate, q.endDate)}` +
    `&timeGranularity=${q.timeGranularity || "ALL"}` +
    `&accounts=List(${accountUrn})` +
    `&fields=${fields.join(",")}`;

  if (q.campaignIds && q.campaignIds.length > 0) {
    const urns = q.campaignIds.map((id) => encodeURIComponent(`urn:li:sponsoredCampaign:${id}`)).join(",");
    url += `&campaigns=List(${urns})`;
  }
  if (q.campaignGroupIds && q.campaignGroupIds.length > 0) {
    const urns = q.campaignGroupIds.map((id) => encodeURIComponent(`urn:li:sponsoredCampaignGroup:${id}`)).join(",");
    url += `&campaignGroups=List(${urns})`;
  }
  return url;
}
