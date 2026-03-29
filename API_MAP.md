# API Map — SCE QC Tracker

All API calls made by the frontend, routed through the FastAPI backend proxy.

## Read Endpoints (Live)

| Endpoint | Backend Route | Upstream API | Payload | Response Shape |
|----------|--------------|--------------|---------|----------------|
| `GET /api/users/self` | `app.py:get_current_user` | `GET /v4/users/self` | — | `{ id, userName, firstName, lastName, fullName, email }` |
| `GET /api/users` | `app.py:list_users` | `GET /v4/users` | — | `[{ id, userName, firstName, lastName, fullName, email }]` — used for unknown assignee resolution |
| `GET /api/bundles?limit=200` | `app.py:list_bundles` | `GET /api/governance/v1/bundles` | `?limit=200` | `{ data: [{ id, name, policyId, policyName, projectId, projectName, projectOwner, stage, stages: [{ stageId, stage: { id, name }, assignee }], state, createdAt, createdBy }] }` |
| `GET /api/bundles/{id}/approvals` | `app.py:get_bundle_approvals` | `GET /api/governance/v1/bundles/{id}/approvals` | — | `[{ id, status, approver, ... }]` |
| `GET /api/bundles/{id}/findings?limit=200` | `app.py:get_bundle_findings` | `GET /api/governance/v1/bundles/{id}/findings` | `?limit=200` | `{ data: [{ id, name, severity, status }] }` |
| `GET /api/bundles/{id}/gates` | `app.py:get_bundle_gates` | `GET /api/governance/v1/bundles/{id}/gates` | — | `[{ id, name, status }]` |
| `GET /api/attachment-overviews?limit=200` | `app.py:list_attachment_overviews` | `GET /api/governance/v1/attachment-overviews` | `?limit=200` | `{ data: [{ id, type, identifier: { filename }, createdAt, createdBy, bundle: { id, name } }] }` |
| `GET /api/projects?limit=200` | `app.py:list_projects` | `GET /v4/projects` | `?limit=200` | `[{ id, name, tags: [{ id, name, isApproved }], collaborators: [{ collaboratorId, projectRole }] }]` |
| `GET /api/projects/{id}/collaborators` | `app.py:list_project_collaborators` | `GET /v4/projects/{id}/collaborators` | — | `[{ id, userName, firstName, lastName, fullName, email }]` |
| `GET /api/policies?limit=200` | `app.py:list_policies` | `GET /api/governance/v1/policy-overviews` | `?limit=200` | `{ data: [{ id, name, description, status, version, usage }] }` |
| `GET /api/policies/{id}` | `app.py:get_policy` | `GET /api/governance/v1/policies/{id}` | — | `{ id, name, stages: [{ id, name }], ... }` |
| `GET /api/terminology` | `app.py:get_terminology` | `GET /v4/admin/whitelabel/configurations` | — | `{ bundle: "string", policy: "string" }` |
| `GET /api/data-explorer-url` | `app.py:get_data_explorer_url` | `GET /api/apps/beta/apps` (+ env var override) | — | `{ url: "string" or null }` |

## Fetch Sequence (fetchLiveData)

```
Phase 1 — Top-level (parallel):
   - GET /api/users/self
   - GET /api/bundles?limit=200
   - GET /api/projects?limit=200       → also extracts project owner for D16 merge
   - GET /api/policies?limit=200
   - GET /api/attachment-overviews?limit=200

Phase 2 — All fire simultaneously (single Promise.all):
   Per unique projectId:
     - GET /api/projects/{projectId}/collaborators → owner merged if missing (D16)
   Per bundle (3 calls each):
     - GET /api/bundles/{id}/approvals
     - GET /api/bundles/{id}/findings?limit=200
     - GET /api/bundles/{id}/gates

Phase 2.5 — Unknown assignee resolution (conditional):
   If any stageAssignee has an ID but empty name AND is not in the collaborators cache:
     - GET /api/users → fetch global user list
     - Match unknown IDs against global users by id or userName
     - Patch resolved names into bundle data + members cache
```

**Note on project owners (D16)**: The `/v4/projects/{id}/collaborators` endpoint returns only explicitly added collaborators, not the project owner. The app extracts the owner from the `/v4/projects` response and merges them into the collaborator list if not already present. This ensures all assignee dropdowns include the project owner.

## Write Endpoints

| Action | UI Location | Status | Notes |
|--------|------------|--------|-------|
| Stage Reassignment | QC Tracker expanded row, Stage Manager bulk reassign, Assignee dropdown | **LIVE** | PATCH method, body: {assignee: {id: userId}}. Upstream: `PATCH /api/governance/v1/bundles/{bundleId}/stages/{stageId}`. Read-back verification after every PATCH. |
| Create Bundle | CSV Import drawer, Utilities → Copy Deliverables | **LIVE** | POST method, body: {name, policyId, projectId}. Upstream: `POST /api/governance/v1/bundles` |
| Bulk Assign | QC Tracker bulk action bar | **LIVE (workaround)** | Fires N parallel single-PATCH requests. Pre-flight checks: bundle state (Active only), project collaborator membership. Per-item results with read-back verification. No native bulk endpoint exists. |
| Apply Bulk Assignment Rules | Bulk Assignment Rules page | API Pending | Warning toast on attempt |

Bulk Assign and Apply Rules are gated by the `API_GAPS` config object in `app.js`. Set `ready: true` when the Domino write API becomes available.

## Write Operation Constraints (Undocumented)

The governance PATCH endpoint returns 200 OK even when writes are silently rejected. The app mitigates this with:

| Constraint | Detection | App Mitigation |
|-----------|-----------|----------------|
| Assignee not a project collaborator | Read-back verification (actual ≠ requested) | Pre-flight check against `projectMembersCache`; skip with error message |
| Bundle is Archived or Complete | Read-back verification | Pre-flight check on `bundle.state`; skip with "reactivate/reopen in Domino" message |
| Caller lacks write permissions | Read-back verification | Actionable error: "check project collaborator settings" |
| Unknown constraints | Read-back verification | Generic: "Domino did not persist — assignment is still [actual]" |

All mitigations are in `app.js` in `handleBulkAssign()` (bulk) and the assignee `onChange` handler (single-row).

## Bundle Creation Constraints (Discovered)

The `POST /api/governance/v1/bundles` endpoint has the following behaviors discovered during cross-project copy testing:

| Constraint | HTTP Status | Error Message | App Mitigation |
|-----------|-------------|---------------|----------------|
| Duplicate name in same project | **409 Conflict** | `"There is already a bundle with the same name in the project. Please change your bundle name."` | Client-side duplicate detection against target project bundles. For intra-batch collisions (e.g., two source bundles named "T_POP Output" under different policies), the app auto-appends ` (PolicyName)` suffix and shows the rename at the review step. |
| Same name allowed across different policies in same project | N/A (inconsistency) | The governance API sometimes allows duplicate names within a project when bundles belong to different policies (observed in production data). However, the create endpoint enforces uniqueness regardless of policy. | The app treats all same-name bundles as collisions and disambiguates proactively. |

**Copy Deliverables flow** (Utilities tab → Copy Deliverables Between Projects):
1. Lists all bundles from source project with their policies
2. Detects intra-batch name collisions and auto-renames with policy suffix
3. Detects duplicates already existing in target project
4. Fires N parallel `POST /api/bundles` calls (concurrency: 3 for ≤50 items, 5 for larger batches)
5. Progress updates throttled for large batches (every N items instead of every item)
6. Only copies name + policyId — stage assignments, findings, approvals, and attachments do not carry over

## Cross-App Discovery

The app discovers other running Domino apps (e.g., Data Explorer) via the Beta Apps API:

| Step | Detail |
|------|--------|
| 1. Check env var | `DATA_EXPLORER_URL` override (highest priority) |
| 2. Call Beta Apps API | `GET /api/apps/beta/apps?limit=100` |
| 3. Name match | Search for apps with "data explorer" in name (case-insensitive) |
| 4. Extract URL | Use `runningAppUrl`, `url`, or `vanityUrl` field; fallback to constructing from app ID |
| 5. Cache | Result cached after first probe (won't re-fetch) |

Deep-link format: `{dataExplorerUrl}/?dataset={encodedPath}`

Path construction by attachment type:
- `DatasetSnapshotFile` → `/domino/datasets/local/snapshots/{datasetName}/{snapshotVersion}/{filename}`
- `NetAppVolumeSnapshotFile` → `/domino/netapp-volumes/{volumeName}/{filename}`
