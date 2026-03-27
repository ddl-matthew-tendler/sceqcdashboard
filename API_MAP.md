# API Map — SCE QC Tracker

All API calls made by the frontend, routed through the FastAPI backend proxy.

## Read Endpoints (Live)

| Endpoint | Backend Route | Upstream API | Payload | Response Shape |
|----------|--------------|--------------|---------|----------------|
| `GET /api/users/self` | `app.py:get_current_user` | `GET /v4/users/self` | — | `{ id, userName, firstName, lastName, fullName, email }` |
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
```

**Note on project owners (D16)**: The `/v4/projects/{id}/collaborators` endpoint returns only explicitly added collaborators, not the project owner. The app extracts the owner from the `/v4/projects` response and merges them into the collaborator list if not already present. This ensures all assignee dropdowns include the project owner.

## Write Endpoints

| Action | UI Location | Status | Notes |
|--------|------------|--------|-------|
| Stage Reassignment | QC Tracker expanded row, Stage Manager bulk reassign | **LIVE** | PATCH method, body: {assignee: {id: userId}}. Upstream: `PATCH /api/governance/v1/bundles/{bundleId}/stages/{stageId}` |
| Create Bundle | CSV Import drawer | **LIVE** | POST method, body: {name, policyId, projectId}. Upstream: `POST /api/governance/v1/bundles` |
| Bulk Assign | QC Tracker bulk action bar | API Pending | Button disabled, tooltip explains |
| Apply Bulk Assignment Rules | Bulk Assignment Rules page | API Pending | Warning toast on attempt |

These are gated by the `API_GAPS` config object in `app.js`. Set `ready: true` when the Domino write API becomes available.

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
