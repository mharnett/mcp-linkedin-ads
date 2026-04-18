import { registerMcpTests } from "@drak-marketing/mcp-test-harness";
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerMcpTests({
  name: "mcp-linkedin-ads",
  repoRoot: path.resolve(__dirname, ".."),
  toolPrefix: "linkedin_ads_",
  minTools: 5,
  requiredTools: ["linkedin_ads_get_client_context", "linkedin_ads_list_campaigns"],
  binEntries: { "mcp-linkedin-ads": "dist/index.js" },
  hasAuthCli: false,
  hasCredentials: false,
  hasResilience: true,
  hasPlatform: false,
  requiredEnvVars: ["LINKEDIN_ADS_REFRESH_TOKEN"],
  envPrefix: "LINKEDIN_ADS_",
  sourceLintIgnore: ["index.ts"], // index.ts uses execFileSync for Keychain + new URL for path resolution
});
