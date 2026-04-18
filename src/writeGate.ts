import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Tools that mutate LinkedIn Ads state. These are hidden from the tool list
 * and refused at call time unless LINKEDIN_ADS_MCP_WRITE=true.
 *
 * Adding a new tool? Put it in this set if it creates, modifies, pauses,
 * enables, removes, links, unlinks, or applies anything.
 *
 * This set is currently empty: the LinkedIn Ads MCP exposes read-only tools
 * only. The gate still ships so that any future write tool is gated by
 * default, matching the Google Ads / Bing / Reddit / Meta pattern.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

export function isWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.LINKEDIN_ADS_MCP_WRITE || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function filterTools(
  allTools: readonly Tool[],
  env: NodeJS.ProcessEnv = process.env,
): Tool[] {
  if (isWriteEnabled(env)) return [...allTools];
  return allTools.filter((t) => !WRITE_TOOLS.has(t.name));
}

export const WRITE_DISABLED_MESSAGE =
  "Write operations are disabled. Set LINKEDIN_ADS_MCP_WRITE=true in the MCP server environment to enable mutating tools (create/update/pause/enable/remove/apply).";

/**
 * Assert that a tool call is allowed under the current write-mode setting.
 * Throws a clear Error if the tool mutates state and writes are disabled.
 */
export function assertWriteAllowed(
  toolName: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isWriteTool(toolName)) return;
  if (isWriteEnabled(env)) return;
  throw new Error(
    `Tool "${toolName}" is a write operation. ${WRITE_DISABLED_MESSAGE}`,
  );
}
