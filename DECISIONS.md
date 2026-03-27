# Decisions Log — SCE QC Tracker

## 2026-03-26: Live Data Migration

### D1: Current User Source
**Decision**: Fetch from `GET /v4/users/self` on app mount, store in `currentUser` state, default `scopeCurrentUser` to `currentUser.userName`.
**Rationale**: Replaces hardcoded `production_programmer`. The `/v4/users/self` endpoint returns the authenticated user based on the API key or token.

### D2: Project Members — Per-Project Fetch with Cache
**Decision**: Fetch collaborators per unique projectId found in bundles, cache in `projectMembersCache` state (keyed by projectId).
**Rationale**: The `/v4/projects/{id}/collaborators` endpoint is project-scoped. Fetching globally would miss the project context. Caching prevents redundant calls on re-renders.

### D3: Project Tags Shape
**Decision**: Use tags from `/v4/projects` response directly. Shape is `{ id, name, isApproved }` — display uses `tag.name` as the label.
**Rationale**: The old mock used `{ key, value }` pairs. Real Domino tags are flat `{ name }` labels. Updated all tag filter logic to use `tag.name`.

### D4: Policies — Stage Names from Bundles
**Decision**: Derive stage options in Assignment Rules from bundle stage data rather than fetching individual policy details.
**Rationale**: The `/api/policies` (policy-overviews) endpoint returns metadata but not stages. The full `/api/policies/{id}` endpoint has stages, but since bundles already carry their stage arrays, extracting from bundles avoids extra API calls and is always consistent with the actual bundle state.

### D5: Attachments — Global Fetch + Client-Side Grouping
**Decision**: Fetch all attachment-overviews in one call (`?limit=200`), then group by `attachment.bundle.id` client-side.
**Rationale**: The governance API returns attachments with embedded bundle references. A single paginated call is more efficient than per-bundle attachment queries (which don't exist as an API).

### D6: Assignment Rules Persistence — localStorage (Temporary)
**Decision**: Store assignment rules in `localStorage` under key `sce_assignment_rules`. Load on mount, persist on every change.
**Rationale**: **This is a temporary solution.** Assignment rules are a client-side construct (the Domino governance API has no concept of assignment rules). Pending either: (a) a Domino API for rule storage, or (b) a custom backend table/file. localStorage works for single-user scenarios but does not sync across users or devices.

### D7: Write Actions — API_GAPS Pattern
**Decision**: Created a central `API_GAPS` config object with `{ label, message, ready }` for each pending write action. UI renders fully but disables confirm/submit buttons with tooltips and shows orange "API Pending" badges.
**Rationale**: The Domino governance API currently has no write endpoints for stage reassignment or bulk assignment. Rather than silently no-oping (which confuses users), the UI clearly communicates that the feature exists but the backend integration is pending. When the API becomes available, set `ready: true` and add the actual API call.

### D8: Fetch Parallelism
**Decision**: Use `Promise.all()` for all independent API calls. Top-level fetches (users, bundles, projects, policies, attachments) run in parallel. Per-bundle enrichment (approvals, findings, gates) also uses `Promise.all()` per bundle.
**Rationale**: Maximizes throughput. With 20 bundles, this means ~60 enrichment calls fire concurrently rather than sequentially.

### D9: Pagination Limit
**Decision**: Use `limit=200` for all paginated endpoints.
**Rationale**: Current data volume is <100 items per entity type. 200 provides headroom without requiring pagination logic. If data grows beyond 200, implement cursor-based pagination.

### D10: View in Domino URL Pattern
**Decision**: Use `{origin}/governance/bundles/{bundleId}` for all "View in Domino" / "Open in Domino" links.
**Rationale**: Replaces the previous owner/project/policy-scoped URL pattern (`/u/{owner}/{project}/governance/bundle/{bundleId}/policy/{policyId}`). The simpler pattern works across all Domino environments and only requires the bundle ID. Used in: expanded row "Open in Domino" button, FindingsDrawer, AttachmentsDrawer, DetailDrawer.

### D11: Findings & Attachments Click-Through Drawers
**Decision**: Added reusable `FindingsDrawer` and `AttachmentsDrawer` components. Findings drawer opens from: (1) stage pipeline dots with open findings, (2) findings count badge in Flags column. Attachments drawer opens from the attachment count in the table.
**Rationale**: Gives users immediate access to finding/attachment details without expanding the row. Both drawers include a "View in Domino" button using the D10 URL pattern.

### D12: "Assigned to Me" Checkbox Filters
**Decision**: Replaced the View dropdown (7 options) with 3 checkboxes: "Current stage", "Future stage", "Prior stage". Multiple can be selected (OR logic). No checkboxes checked = show all.
**Rationale**: Checkboxes are more discoverable and allow combining filters. The old dropdown forced a single selection. The persona selector is no longer needed since checkboxes implicitly use `scopeCurrentUser` (the logged-in user).

### D13: Tab Reorder and Rename
**Decision**: Reordered sidebar: QC Tracker (first), Portfolio Overview (second, renamed from Dashboard), Milestones, Approvals, Findings & QC, Team Metrics, Assignment Rules (last).
**Rationale**: QC Tracker is the primary workflow. "Portfolio Overview" better describes the dashboard's cross-project summary purpose. Assignment Rules is a configuration page, so it belongs last.

### D14: Logo Path Fix (LIVE_API_STATUS 2.2)
**Decision**: Copied `domino-logo.svg` from project root into `static/` directory and updated `src` path from `static/../domino-logo.svg` to `/static/domino-logo.svg`.
**Rationale**: The previous path resolved to `/domino-logo.svg` which wasn't served by FastAPI (only `/static/*` is mounted). The file existed at the project root but was inaccessible via HTTP.

### D15: Parallel Fetch Optimization (LIVE_API_STATUS 2.3)
**Decision**: Restructured `fetchLiveData()` to fire collaborator fetches and per-bundle enrichment calls (approvals, findings, gates) simultaneously in a single `Promise.all` batch.
**Before**: Phase 1 (top-level fetches) → Phase 2 (collaborators) → Phase 3 (per-bundle enrichment). Collaborators had to finish before enrichment started.
**After**: Phase 1 (top-level fetches) → Phase 2 (collaborators + all per-bundle enrichment fire together). For 20 bundles with 8 projects: 68 calls fire simultaneously instead of 8 completing first, then 60.
**Rationale**: Collaborator data is only needed for UI dropdowns, not for enrichment. No dependency between the two phases, so they can run in parallel.

### D16: Project Owner Merge into Collaborators (LIVE_API_STATUS 2.5)
**Decision**: Extract project owner from `/v4/projects` response and merge into each project's collaborator list if not already present.
**Rationale**: The `/v4/projects/{id}/collaborators` endpoint returns only explicitly added collaborators, not the project owner. Since the owner can assign work and be assigned work, they must appear in all assignee dropdowns. The owner is extracted from the `/v4/projects` response (`ownerUsername`, `owner.userName`) and prepended to the collaborator list if not already included.

## 2026-03-27: Risk Optimizer Tab

### D17: Risk Scoring Engine — Keyword-Based with Config UI
**Decision**: Risk scoring uses a configurable keyword-matching engine. Deliverable names and policy names are matched against keyword lists for High/Medium/Low risk tiers. When no keywords match, the algorithm defaults to Medium (conservative). Users can edit keyword lists via a Config modal without code changes.
**Rationale**: A keyword-based approach is transparent and explainable — users can see exactly why a deliverable was scored a certain way. The config-driven design means a non-engineer can tune the classification by editing comma-separated keyword lists. The conservative Medium default prevents under-QC of unclassified deliverables.

### D18: Policy Tier Tagging — User-Defined, Never Hardcoded
**Decision**: Users tag each existing policy as "Most Rigorous", "Moderate", or "Lightweight" via a dedicated Tiers tab. These tags drive recommendations. Policy names are never hardcoded in the scoring logic.
**Rationale**: Policy names vary across organizations and even studies. Hardcoding policy-to-rigor mappings would break portability. By letting users tag policies once, the recommendation engine adapts to any naming convention. Tags persist in localStorage (`sce_policy_tiers`).

### D19: Calibration Model — Over-QC'd / Well-Matched / Under-QC'd
**Decision**: Each bundle's calibration is computed by comparing its current policy tier (from the user-defined tag) against the recommended tier (from risk scoring). If the current tier is more rigorous than recommended, it's "Over-QC'd". If less rigorous, "Under-QC'd". If equal, "Well-Matched". If the policy is untagged, it's "Untagged".
**Rationale**: This three-state calibration gives users an immediate, actionable view of where to focus. Over-QC'd bundles represent resource savings; under-QC'd bundles represent risk. The "Untagged" state prompts users to complete setup.

### D20: Manual Risk Overrides — Human Judgment Wins
**Decision**: Users can override the algorithm's risk assessment for any bundle. Overrides persist in localStorage (`sce_risk_overrides`) and are visually distinguished with a blue "Override" tag. Overrides require a mandatory reason logged to the audit trail.
**Rationale**: Algorithmic risk scoring is a starting point, not the final word. Domain experts may know context the algorithm can't infer (e.g., regulatory importance, novel methodology). Making overrides explicit and auditable ensures accountability while preserving human judgment.

### D21: Reassignment Audit Trail — Always Logged
**Decision**: Every policy reassignment and risk override records an audit entry with bundle name, old/new values, rationale, and timestamp. The audit log persists in localStorage (`sce_risk_audit_log`, capped at 500 entries) and is viewable in a dedicated Audit Log tab.
**Rationale**: Regulatory and compliance requirements demand traceability for QC policy changes. Even before the Domino write API is available, the audit trail captures intent. Uses the API_GAPS pattern — reassignments are logged locally and will be persisted server-side when the write API supports it.

### D22: Automation Jobs API — Ready with Error Diagnostics
**Decision**: Set `API_GAPS.automationRun.ready = true`. Enhanced error handling provides contextual hints (404 → Jobs API not enabled, 403 → token permissions, etc.). Failed job starts are recorded in execution history. Polling failures stop after 3 consecutive errors with a user-facing notification.
**Rationale**: The proxy endpoints and UI are fully built. Keeping `ready: false` hides the feature unnecessarily. With clear error messages and diagnostic hints, users can self-diagnose issues on their Domino instance. Recording failures in history provides visibility into API availability.

## 2026-03-27: Data Explorer, Metrics & UI Polish

### D23: Data Explorer Deep-Linking — Cross-App File Opening
**Decision**: Attachments with extensions `.csv`, `.parquet`, `.xpt`, `.sas7bdat` render as clickable links that open in the Data Explorer app via a `?dataset=<encodedPath>` query parameter. Other file types (`.pdf`, `.sas`, `.log`) keep the existing "View in Domino" link behavior.
**Rationale**: The Data Explorer app supports deep-linking via query parameter. Path construction differs by attachment type: `DatasetSnapshotFile` → `/domino/datasets/local/snapshots/{datasetName}/{snapshotVersion}/{filename}`, `NetAppVolumeSnapshotFile` → `/domino/netapp-volumes/{volumeName}/{filename}`. These paths were reverse-engineered from the support bundle's `run.json` (which contains `datasetMounts` and `netAppVolumeMounts`) and verified against the Data Explorer app's "Copy Link" output.

### D24: Data Explorer URL Discovery — Beta Apps API + Env Var Fallback
**Decision**: The Data Explorer URL is discovered via `GET /api/apps/beta/apps`, searching for apps with "data explorer" in the name. Falls back to `DATA_EXPLORER_URL` env var. The fetch runs in a separate `useEffect` with `[]` dependencies — not gated by the `connected` state — because it's a local backend call that doesn't require Domino governance connectivity.
**Rationale**: Gating behind `connected` prevented the Data Explorer links from appearing in dummy mode. The Beta Apps API is a lightweight discovery mechanism. The env var fallback ensures the feature works even if auto-discovery fails.

### D25: Risk Optimizer — Standard StatCard Alignment
**Decision**: Replaced the Risk Optimizer's custom `summaryCard()` function (dark `#1E1E2E` background, inline styles) with the standard `StatCard` component used by all other pages. Removed the ⚖ emoji from the page title.
**Rationale**: The custom cards created visual inconsistency with the rest of the app. All pages should use the same `StatCard` component with `.stats-row` CSS class, white backgrounds, and the standard color palette (primary/danger/warning/success/info).

### D26: Stage Dot Illumination — Glow on Blocked Only
**Decision**: Removed the always-visible `box-shadow` glow from active (yellow/in-progress) stage dots. Kept the glow on blocked (red) dots only. All hover and click effects remain unchanged for all dot colors.
**Rationale**: In-progress is a normal state that doesn't need visual emphasis. Blocked (open finding) is the exceptional state that warrants the user's attention via a persistent glow.

### D27: Metrics — Sample Data Indicator Pattern
**Decision**: When computed metrics have no data (e.g., no completed bundles for cycle time), the app injects realistic sample values and displays an orange "Sample data — no completed deliverables yet" tag above the chart.
**Rationale**: Empty charts provide no value to demo viewers. Sample data shows the chart's intended purpose while the tag clearly communicates the data isn't real. Uses the same `Tag` component with `color: 'orange'` pattern as the "API Pending" badges.

### D28: Whitelabel Terms — Always Use capFirst()
**Decision**: All chart titles and UI labels that use whitelabel terms (`terms.bundle`, `terms.policy`) must wrap them in `capFirst()` for proper capitalization.
**Rationale**: The live Domino API returns lowercase terms (e.g., "deliverable", "qc plan"). Without `capFirst()`, chart titles render as "deliverables by qc plan" instead of "Deliverables by QC Plan". This was caught during live testing.
