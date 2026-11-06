import { describe, it, expect } from "vitest";
import { tools } from "./tools.js";

const EXPECTED_TOOL_NAMES = [
  "linkedin_ads_get_client_context",
  "linkedin_ads_list_accounts",
  "linkedin_ads_list_campaign_groups",
  "linkedin_ads_list_campaigns",
  "linkedin_ads_campaign_performance",
  "linkedin_ads_account_performance",
  "linkedin_ads_analytics",
  "linkedin_ads_list_predictive_audiences",
  "linkedin_ads_get_predictive_audience",
  "linkedin_ads_create_predictive_audience",
  "linkedin_ads_update_predictive_audience",
];

describe("LinkedIn Ads MCP tools contract", () => {
  it("exports exactly the expected tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("all tools have linkedin_ads_ prefix", () => {
    for (const tool of tools) {
      expect(tool.name).toMatch(/^linkedin_ads_/);
    }
  });

  it("all tools have a description", () => {
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe("string");
      expect(tool.description!.length).toBeGreaterThan(0);
    }
  });

  it('all tools have inputSchema.type === "object" with properties', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
      expect(typeof tool.inputSchema.properties).toBe("object");
    }
  });

  it("all required fields exist in properties", () => {
    for (const tool of tools) {
      const required = (tool.inputSchema as any).required as string[] | undefined;
      if (required) {
        const propKeys = Object.keys(tool.inputSchema.properties ?? {});
        for (const field of required) {
          expect(propKeys).toContain(field);
        }
      }
    }
  });

  it("every schema disallows extra properties", () => {
    for (const tool of tools) {
      expect((tool.inputSchema as any).additionalProperties).toBe(false);
    }
  });

  describe("predictive audience write tools", () => {
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    it("create requires explicit account, confirmation, name, locations, seeds and size", () => {
      expect((byName("linkedin_ads_create_predictive_audience").inputSchema as any).required).toEqual([
        "account_id", "confirm_account_id", "name", "locations", "seeds", "desired_audience_count",
      ]);
    });
    it("update requires explicit account, confirmation and the segment id", () => {
      expect((byName("linkedin_ads_update_predictive_audience").inputSchema as any).required).toEqual([
        "account_id", "confirm_account_id", "dmp_segment_id",
      ]);
    });
    it("list requires an explicit account (no context fallback)", () => {
      expect((byName("linkedin_ads_list_predictive_audiences").inputSchema as any).required).toEqual(["account_id"]);
    });
    it("get requires the segment id", () => {
      expect((byName("linkedin_ads_get_predictive_audience").inputSchema as any).required).toEqual(["dmp_segment_id"]);
    });
  });
});
