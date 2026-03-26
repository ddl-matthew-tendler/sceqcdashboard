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
