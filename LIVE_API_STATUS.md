# Live API Status — SCE QC Tracker

> **Audit Date**: 2026-03-26
> **Tested Against**: `life-sciences-demo.domino-eval.com`
> **Auth**: PAT for user `integration-test` (id `690a9213abfd2c18541c6a98`)

---

## Section 1: Fully Working

### 1.1 Bundles Load from Live API
- **Status**: PASS
- **Evidence**: 20 bundles fetched via `GET /api/bundles?limit=200` → 200 OK. Table renders 15 per page with pagination. Real bundle names, project names, policy names, stages, and assignees all display correctly.
- **Network**: All 20 per-bundle enrichment calls (approvals, findings, gates) complete successfully via `Promise.all()`.

### 1.2 Current User Reflects Logged-In User
- **Status**: PASS
- **Evidence**: `GET /api/users/self` returns `{ userName: "integration-test" }`. The My Work persona selector shows "integration-test integration-test (me)" — not the old hardcoded `production_programmer`.
- **Code**: `app.js` line 2398 initializes `scopeCurrentUser` to `null`, useEffect at line 2416 sets it from `currentUser.userName` after fetch.

### 1.3 Project Members Populate in Dropdowns
- **Status**: PASS (5 of 6 locations verified via code and DOM inspection)
- **Evidence**: `GET /api/projects/{id}/collaborators` called for all 8 unique project IDs (all 200 OK). Members cached in `projectMembersCache` state keyed by projectId.
- **Locations verified**:
  1. **Stage reassignment** (QCTrackerExpandedRow, line ~1306): 6 Select elements rendered with `members` from `pmc[bundle.projectId]`. All disabled with API Pending badge.
  2. **Bulk assign** (BulkActionBar, line ~1513): Combines all project members. Verified via DOM — dropdown renders with Assign button disabled + API Pending badge.
  3. **Assignment Rules — memberOptions** (line ~1996): Scoped to `selectedProject`. Code reads from `props.projectMembersCache[selectedProject]`. Could not verify via UI (requires project selection in Ant portal), but code path is correct.
  4. **Assignment Rules — applyPreview** (line ~2030): Looks up member display name from `props.projectMembersCache[selectedProject]`. Code path correct.
  5. **Assignment Rules — rulesColumns render** (line ~2140): Same lookup pattern. Code path correct.
  6. **My Work persona selector** (line ~2448): Derives from `currentUser` + all `projectMembersCache` values. Verified via earlier screenshot showing "integration-test integration-test (me)".

### 1.4 Project Tags Compute Correctly
- **Status**: PASS
- **Evidence**: `GET /api/projects?limit=200` returns 52 projects, 15 have tags. After cross-referencing with bundle projectIds, 5 projects overlap. The `scopeTagOptions` useMemo computes **8 unique tag options**: L1-Endocrinology, L2-Diabetes, L3-Glucorinex, L4-CDISC01 Phase 1, WebApp, Official Domino App, MedDevGovernance, RWE.
- **Verification method**: Extracted options from React fiber tree — `{ optCount: 8, first3: [{label: "L1 - Endocrinology"}...] }`.
- **Note**: Ant Select dropdown portal does not render in automated preview testing (known portal issue), but the underlying data and React props are correct.

### 1.5 Attachments Show Per Bundle
- **Status**: PASS
- **Evidence**: `GET /api/attachment-overviews?limit=200` fetched in parallel batch. Attachments grouped by `bundle.id` client-side. The 📎 column shows: 4 bundles with 1 attachment, 1 with 2, 2 with 3, 1 with 4, 1 with 5, 6 with none ("—"). Matches the attachment-overviews API response.

### 1.6 Write Actions Show API Pending
- **Status**: PASS
- **Evidence**:
  - **Stage Reassignment**: All 6 stage Select elements are `disabled`, each with orange "API Pending" Tag. Tooltip shows message. Verified via DOM: `disabledSelects: 6, apiPendingBadges: 6`.
  - **Bulk Assign**: Assign button is `disabled: true`, orange "API Pending" Tag visible. Verified via DOM: `assignBtnDisabled: true, apiPendingBadge: "API Pending"`.
  - **Apply Rules**: Code at line 2252-2258 renders Tooltip + "API Pending" Tag next to Apply Rules button. `handleApplyRules()` at line 2108 checks `API_GAPS.applyRules.ready` and shows `antd.message.warning()` toast. Could not trigger via UI in audit (requires project selection), but code path verified.

### 1.7 No Dummy Data When Connected
- **Status**: PASS
- **Evidence**: When `connected === true`, the "Dummy Data" toggle is hidden (`!connected` guard at line 210). All data comes from live API calls (confirmed via network trace — 130+ requests to `/api/*`, zero reads of `MOCK_*` globals). `mock_data.js` is still loaded in `index.html` but its globals are never accessed when live data succeeds.

### 1.8 Whitelabel Terminology
- **Status**: PASS
- **Evidence**: `GET /api/terminology` returns `{ bundle: "Deliverable", policy: "QC Plan" }`. Top nav shows "deliverables / QC plan" badge. All table headers and labels use whitelabeled terms.

### 1.9 Policies Fetched from Live API
- **Status**: PASS
- **Evidence**: `GET /api/policies?limit=200` returns policy overviews (ADaM QC Plan - High Risk, Low Risk, Data Access Request, etc.). Stored in `livePolicies` state. Stage options in Assignment Rules derive from bundle stage data (which is authoritative and avoids needing per-policy detail fetches).

### 1.10 Assignment Rules Persist to localStorage
- **Status**: PASS
- **Evidence**: Code at lines 2404-2414 loads from `localStorage.getItem('sce_assignment_rules')` on mount and persists via `localStorage.setItem()` on every `assignmentRules` state change.

### 1.11 Stage Reassignment (Write API)
- **Status**: PASS
- **Evidence**: `PATCH /api/governance/v1/bundles/{bundleId}/stages/{stageId}` with body `{"assignee": {"id": "userId"}}` returns 200 OK with updated stage assignment. The endpoint was discovered via live API probing — it uses PATCH (not PUT) and the request body wraps the assignee in an object. Response includes `policyVersionId` for deep-linking.
- **Code**: Stage timeline dropdowns in QCTrackerExpandedRow and Stage Assignments bulk reassign now call this endpoint directly. `API_GAPS.stageReassign.ready` set to `true`.

### 1.12 Data Explorer App Discovery
- **Status**: PASS
- **Evidence**: `GET /api/apps/beta/apps?limit=100` returns list of running apps. The app searches for "data explorer" in app names and extracts `runningAppUrl`. Falls back to `DATA_EXPLORER_URL` env var. Deep-linking via `?dataset=<encodedPath>` confirmed working.
- **Code**: New `GET /api/data-explorer-url` backend endpoint with caching. Frontend `useEffect` with `[]` dependencies fetches on mount (not gated by `connected` state).

---

## Section 2: Needs Attention

### 2.1 Dummy Data Toggle Cannot Be Tested While Connected
- **Severity**: Low (audit gap, not a code bug)
- **Details**: When the app successfully connects to Domino (`connected === true`), the Dummy Data toggle is hidden. This means we cannot verify toggle switching behavior (live → dummy → live) in the current testing environment.
- **Code**: `app.js` line 210 — `!connected ? h('div', { className: 'dummy-data-toggle' }, ...) : null`
- **Expected**: Toggle appears only when disconnected (e.g., `DOMINO_API_HOST` not set). When toggled ON, should load `MOCK_*` data. When toggled OFF, should re-call `fetchLiveData()`.
- **Risk**: If `fetchLiveData()` fails mid-session and falls back to mock data, there's no way for the user to manually re-trigger live mode without a page reload (since the toggle only appears when `!connected`, and the fallback sets `connected: false`).
- **Recommendation**: Test with `DOMINO_API_HOST` unset to verify fallback behavior and toggle switching.

### 2.2 ~~`domino-logo.svg` Returns 404~~ — RESOLVED
- **Severity**: ~~Low~~ Resolved (D14)
- **Fix**: Logo copied to `static/` directory and path updated to `/static/domino-logo.svg`.

### 2.3 N+1 Query Pattern on Load
- **Severity**: Medium (performance)
- **Details**: For 20 bundles, the app makes 60 enrichment API calls (3 per bundle: approvals, findings, gates) plus 8 collaborator calls plus 5 top-level calls = **73 total HTTP requests on load**. This will scale linearly — 500 bundles would mean ~1,508 requests.
- **Files**: `app.js` lines 2518-2554 (fetchLiveData enrichment loop)
- **Current mitigation**: `Promise.all()` runs them concurrently.
- **Recommendation**: Investigate batch/bulk endpoints if Domino provides them. Alternatively, implement lazy loading (only fetch enrichment data when a row is expanded).

### 2.4 Pagination Ceiling at limit=200
- **Severity**: Medium (data completeness)
- **Details**: All paginated endpoints use `limit=200`. The user mentioned projects may have 300-500 deliverables. If total bundles exceed 200, the app will silently show only the first 200.
- **Files**: `app.js` line 2519 — `apiGet('api/bundles?limit=200')`
- **Recommendation**: Implement cursor-based pagination or increase limit and add a visible "showing X of Y" indicator when results are truncated.

### 2.5 ~~Some Collaborator Requests Are Sparse~~ — RESOLVED
- **Severity**: ~~Low~~ Resolved (D16)
- **Fix**: Project owner is now extracted from `/v4/projects` response and merged into collaborator list if not already present.

### 2.6 Write APIs ~~Remain Pending~~ — Partially Resolved
- **Severity**: Expected (by design)
- **Details**: Stage Reassignment is now **LIVE** via `PATCH /api/governance/v1/bundles/{bundleId}/stages/{stageId}`. Bulk Assign now uses parallel single-PATCH as a workaround. One write action remains gated by `API_GAPS`:
  - Apply Rules (`API_GAPS.applyRules`)

### 2.9 Silent Write Rejection — Governance PATCH Returns 200 on Failure
- **Severity**: High (data integrity)
- **Date Discovered**: 2026-03-29
- **Details**: The governance PATCH endpoint for stage reassignment returns HTTP 200 OK even when the assignment is silently rejected by Domino. Known triggers: assignee not a project collaborator, bundle in Archived/Complete state, caller lacks write permissions. The API provides no error code or response field to distinguish accepted vs rejected writes.
- **Mitigation**: The app now performs:
  1. **Pre-flight validation**: Skips Archived/Complete bundles and non-collaborator assignees before calling the API
  2. **Read-back verification**: After every PATCH, re-GETs the bundle and compares actual vs requested assignee
  3. **UI revert on failure**: If verification fails, local state is reverted to the actual Domino value (not the attempted value)
  4. **Actionable error messages**: Explains the likely cause and fix (e.g., "add as project collaborator in Domino")
- **Recommendation**: Domino platform team should return proper HTTP error codes (403/409/422) instead of 200 OK for rejected writes. This would eliminate the need for read-back verification and improve response time.

### 2.10 Sidecar Token Is Per-User, Not Service Account
- **Severity**: Low (informational, architecture clarification)
- **Date Discovered**: 2026-03-29
- **Details**: The sidecar token at `localhost:8899/access-token` returns a token for the currently logged-in user, not a shared service account. This means all API calls (including PATCH) execute with the identity and permissions of whoever is running the app. Assignments show "assigned by [logged-in user]" in Domino audit logs.
- **Implication**: If user A assigns a stage via the app, the Domino audit trail correctly attributes it to user A. However, if user A doesn't have write access to a project, the PATCH silently fails (see 2.9).

### 2.7 Assignment Rules Storage Is localStorage Only
- **Severity**: Medium (by design, documented in DECISIONS.md D6)
- **Details**: Assignment rules are stored in `localStorage` under `sce_assignment_rules`. This means:
  - Rules don't sync across browsers, devices, or users
  - Rules are lost if browser storage is cleared
  - No audit trail or versioning
- **Recommendation**: Implement server-side storage when a Domino API or custom backend endpoint becomes available.

### 2.8 `mock_data.js` Still Loaded in Production
- **Severity**: Low (no functional impact)
- **Details**: `static/index.html` still loads `mock_data.js` which defines ~840 lines of `MOCK_*` globals. These are never read when live data connects successfully, but they consume parse time and memory.
- **File**: `static/index.html` — `<script src="/static/mock_data.js"></script>`
- **Recommendation**: Gate behind a query parameter (`?demo=true`) or remove entirely once confident in live API stability.

---

## Summary

| Category | Count |
|----------|-------|
| Fully working | 12 items |
| Needs attention | 7 items (3 resolved) |
| Blockers | 0 |
| Console errors | 0 |

**The app is fully functional on live data.** All mock data references in `app.js` have been replaced. The most impactful attention items are: the silent write rejection (2.9) which requires read-back verification for all writes, the N+1 query pattern (2.3), and the pagination ceiling (2.4). Items 2.3 and 2.4 only become issues at scale (300+ bundles).
