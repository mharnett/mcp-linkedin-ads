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
});
