# mcp-linkedin-ads — Backlog

## Campaign creation write tools (private MCP)

**Status:** Backlogged 2026-05-18.

**Goal:** Wrap LinkedIn campaign creation as MCP tools for private use.
Source of truth for the API surface is the working Python uploader at
[forcepoint/linkedIn/linkedin_uploader.py](../../clients/forcepoint/linkedIn/linkedin_uploader.py)
and [forcepoint/linkedIn/li_api.py](../../clients/forcepoint/linkedIn/li_api.py).

**Not for OSS publish.** Public publish would require LinkedIn Marketing
Developer Program partner approval per consumer — out of scope. This is a
local/private addition only.

### Open questions before starting

1. **Scope** — campaigns only, campaigns + creatives, or full pipeline
   (incl. lead-gen forms, audience templates)? Python uploader covers all;
   MCP doesn't have to.
2. **Workflow fit** — is this for one-off conversational creates, or to
   retire `linkedin_uploader.py`? MCP shines for the former; CSV batch
   uploads are still the right primitive for the latter.
3. **Token scope** — current refresh token may be `r_ads` only. Writes
   need `rw_ads`; re-consent required.

### Known gotchas

- `LinkedIn-Version: YYYYMM` header rolls monthly and breaks silently —
  pin vs. float strategy needed.
- No native idempotency keys on create endpoints — retries can
  double-create. Wrapper must dedupe (Python uploader already does).
- Standard-tier write quota is ~100/day per app.
- `writeGate.ts` exists in this repo but currently has no write tools to
  gate — confirm it actually enforces something before relying on it.

### Why not now

User has working Python CLI uploader; no acute pain point. Revisit when
there's a concrete workflow that's better served conversationally than by
CSV batch.

---

## Targeting-edit write tools (surgical geo / facet removal)

**Status:** Backlogged 2026-06-01. Triggered by a real gap: a Forcepoint
"remove geo account-wide (South Africa, Papua New Guinea, New Zealand)" task
could be verified read-only via this MCP, but **not executed** — there is no
tool to edit an existing campaign's targeting, and no read-only path surfaced
the issue until campaigns were parsed by hand.

**Goal:** MCP tools to *surgically* edit `targetingCriteria` on existing
campaigns — add/remove a single geo (or other facet) while preserving the
rest of the targeting tree.

**Why the existing Python uploader does NOT already solve this:**
- `li_api.partial_update()` sends `{"patch": {"$set": fields}}`. A `$set` on
  `targetingCriteria` is a **full replace** of the entire targeting block, not
  a merge.
- `linkedin_uploader.update_targeting_on_drafts()` rebuilds targeting from the
  generic `SIXSENSE_TARGETING[theatre]` template. Pointing it at live
  lead-gen-form campaigns would **clobber their custom location lists and
  audience segments.** Unsafe for "drop one country."
- So a correct fix = GET current `targetingCriteria` → walk include/exclude
  tree → remove the geo URN from the `locations` / `profileLocations` facet →
  `$set` the **complete modified object** back. That read-modify-write is the
  logic the MCP tool should own (and unit-test: anchor that only the targeted
  URN is removed; shape-test that all other facets survive byte-for-byte).

**Proposed surface:**
- `linkedin_ads_campaign_targeting` (read) — return the parsed facet tree for
  a campaign so geo/exclusion gaps are auditable without hand-parsing JSON.
- `linkedin_ads_edit_campaign_geo` (write, gated) — `{campaign_id, add[],
  remove[]}` geo URNs; read-modify-write; refuses if the removal would empty a
  required facet.

**Carries the same prereqs as the creation backlog above:** `rw_ads` token
scope (re-consent), `LinkedIn-Version` pin strategy, and `writeGate.ts` must
actually enforce before any write tool ships.

### Immediate follow-up (outside the MCP)

The 4 live Forcepoint campaigns still serving these geos (3× South Africa,
1× New Zealand) need a near-term fix via either a new surgical function in
`linkedin_uploader.py` (read-modify-write, NOT `update_targeting_on_drafts`)
or a manual Campaign Manager edit. Tracked separately from this MCP item.
