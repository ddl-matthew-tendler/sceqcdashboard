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
