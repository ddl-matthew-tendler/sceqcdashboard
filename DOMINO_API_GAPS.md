# Domino API Gaps — SCE QC Tracker

> **Date**: 2026-03-26
> **App**: SCE QC Tracker (Domino App)
> **Audience**: Engineering leads, Domino platform team, program management

---

## Overview

The SCE QC Tracker is a Domino App built for pharmaceutical statistical programming teams to manage Quality Control workflows across study deliverables. The app provides a unified view of bundles (deliverables), their QC plan stages, stage assignees, findings, attachments, and assignment rules — all within the Domino platform. Live API integration is complete for all **read** operations: the app fetches bundles, approvals, findings, gates, attachments, project collaborators, policies, and whitelabel terminology from the Domino governance and v4 APIs in real time. It also renders a stage timeline, findings/attachments drawers, scope filters by project and tag, "My Work" filtering, and an Assignment Rules configuration page. However, the app currently cannot **write** any data back to Domino. All assignment changes, bulk operations, and rule applications are either disabled with "API Pending" badges or persist only to browser localStorage. These six API gaps block the app from delivering its core value proposition: allowing QC leads to assign, reassign, and track stage ownership across deliverables in a regulated environment.

---

## Gap Details

### 1. Stage Reassignment

- **Priority**: High
- **User Impact**: A QC lead opens a deliverable's expanded row and wants to reassign a stage (e.g., "Double Programming") to a different team member. Today, the six stage assignment dropdowns are rendered but **disabled**, each showing an orange "API Pending" badge. The user cannot change any stage assignee. The app checks `API_GAPS.stageReassign.ready` and prevents interaction.
- **Current Behavior**: The `onChange` handler at `app.js` line ~1332 is gated by `API_GAPS.stageReassign.ready === false`. If bypassed, it would only update local React state and log to the console — no data is sent to Domino. The dropdown options are correctly populated from live project collaborators via `GET /v4/projects/{id}/collaborators`.
- **What We Need**:
  ```
  PUT /api/governance/v1/bundles/{bundleId}/stages/{stageId}/assignee

  Request:
  {
    "assigneeId": "userId"    // Domino user ID from collaborators list
  }

  Response (200 OK):
  {
    "stageId": "stage-abc-123",
    "stage": {
      "id": "stage-def-456",
      "name": "Double Programming"
    },
    "assignee": {
      "id": "userId",
      "userName": "jane_doe",
      "fullName": "Jane Doe"
    },
    "updatedAt": "2026-03-26T14:30:00Z",
    "updatedBy": "current-user-id"
  }
  ```
  - **HTTP method**: `PUT` (idempotent update of a single field on an existing resource).
  - **Auth**: Same Bearer token / X-Domino-Api-Key pattern used by all existing governance endpoints.
  - **Error cases**: 404 if bundleId or stageId not found; 403 if user lacks project write permissions; 400 if assigneeId is not a valid project collaborator.
- **Notes**: This is the foundational write endpoint. Gaps 2, 3, and 6 all depend on this capability existing first. The URL pattern follows the existing governance convention (`/api/governance/v1/bundles/{id}/...`).

---

### 2. Bulk Assign

- **Priority**: High
- **User Impact**: A QC lead selects 15 deliverables using the table checkboxes and wants to assign the "Self QC" stage across all of them to a single person. Today, the Bulk Action Bar renders a disabled "Assign" button with an "API Pending" badge. The user must wait for single-reassignment (Gap 1) and then change each deliverable one at a time — which is impractical for studies with 100+ deliverables.
- **Current Behavior**: The `handleBulkAssign` function at `app.js` line ~1536 checks `API_GAPS.bulkAssign.ready` and shows a warning toast. If bypassed, it logs to console and updates local React state only. The bulk action bar correctly collects the selected bundle IDs, chosen stage, and chosen assignee from live data.
- **What We Need**:
  ```
  POST /api/governance/v1/bundles/bulk-assign

  Request:
  {
    "assignments": [
      {
        "bundleId": "bundle-001",
        "stageId": "stage-abc",
        "assigneeId": "user-xyz"
      },
      {
        "bundleId": "bundle-002",
        "stageId": "stage-abc",
        "assigneeId": "user-xyz"
      }
    ]
  }

  Response (200 OK):
  {
    "results": [
      {
        "bundleId": "bundle-001",
        "stageId": "stage-abc",
        "success": true,
        "assignee": {
          "id": "user-xyz",
          "userName": "jane_doe",
          "fullName": "Jane Doe"
        }
      },
      {
        "bundleId": "bundle-002",
        "stageId": "stage-abc",
        "success": true,
        "assignee": {
          "id": "user-xyz",
          "userName": "jane_doe",
          "fullName": "Jane Doe"
        }
      }
    ],
    "totalRequested": 2,
    "totalSucceeded": 2,
    "totalFailed": 0
  }
  ```
  - **HTTP method**: `POST` (non-idempotent batch operation).
  - **Partial failure handling**: The response must report per-item success/failure so the UI can show which assignments succeeded and which failed (e.g., due to permissions on individual projects).
  - **Size limit**: Should support at least 200 assignments per request (matching the current bundle fetch limit).
  - **Error cases**: 400 if any bundleId/stageId pair is invalid; 403 per-item if user lacks write access to that project; 413 if batch exceeds server limit.
- **Notes**: If a batch endpoint is not feasible, the app can fall back to calling the single-assignment endpoint (Gap 1) in parallel via `Promise.all()`, but this would generate N HTTP requests and has no transactional guarantee. A dedicated batch endpoint is strongly preferred for both performance and atomicity.

---

### 3. Apply Assignment Rules

- **Priority**: Medium
- **User Impact**: A QC lead has configured assignment rules on the Assignment Rules page (e.g., "For ADaM QC Plan - High Risk, assign Double Programming stage to Jane Doe"). They click "Apply Rules" expecting all matching deliverables to be updated. Today, `handleApplyRules()` at `app.js` line ~2108 checks `API_GAPS.applyRules.ready`, shows a warning toast, and does nothing.
- **Current Behavior**: The function deep-clones the current bundles array, iterates over rules, matches bundles by policyId and stage name, and would update the assignee in memory. No API call is made. The preview table correctly shows which bundles would be affected and what the new assignments would be — all derived from live data.
- **What We Need**:
  ```
  POST /api/governance/v1/bundles/apply-rules

  Request:
  {
    "projectId": "proj-abc-123",
    "rules": [
      {
        "policyId": "policy-001",
        "stageName": "Double Programming",
        "assigneeId": "user-xyz"
      },
      {
        "policyId": "policy-001",
        "stageName": "Study Lead Verification",
        "assigneeId": "user-abc"
      }
    ]
  }

  Response (200 OK):
  {
    "applied": [
      {
        "bundleId": "bundle-001",
        "bundleName": "adsl",
        "stageId": "stage-abc",
        "stageName": "Double Programming",
        "previousAssigneeId": "user-old",
        "newAssigneeId": "user-xyz",
        "success": true
      }
    ],
    "skipped": [
      {
        "bundleId": "bundle-005",
        "reason": "Stage not found on bundle"
      }
    ],
    "totalApplied": 1,
    "totalSkipped": 1
  }
  ```
  - **HTTP method**: `POST` (applies a batch of rule-based changes).
  - **Scoping**: The `projectId` ensures rules only apply to bundles within the selected project. The app already scopes rules this way in the UI.
  - **Matching logic**: The server should match bundles by `policyId` and `stageName` within the given project, then set the assignee on each matching stage.
  - **Error cases**: 404 if projectId not found; 403 if user lacks write access; 400 if any policyId is invalid.
- **Notes**: This endpoint depends on Gap 1 (stage reassignment) being available, since apply-rules is effectively a server-side batch of individual stage reassignments filtered by policy and stage name. If a dedicated apply-rules endpoint is not built, the app could alternatively use the bulk-assign endpoint (Gap 2) by pre-computing the assignments client-side — the preview table already does this computation.

---

### 4. Assignment Rules Persistence

- **Priority**: Medium
- **User Impact**: A QC lead creates assignment rules (e.g., "For all High Risk ADaM deliverables, assign Double Programming to Jane Doe"). These rules persist only in the browser's localStorage under the key `sce_assignment_rules` (Decision D6). If the user switches to a different browser, clears storage, or another team member opens the app, all rules are gone. There is no shared view of assignment rules across the team and no audit trail of rule changes.
- **Current Behavior**: Rules are loaded from `localStorage.getItem('sce_assignment_rules')` on mount (`app.js` lines 2404-2414) and written back on every state change. The data shape is an array of `{ id, policyId, stageName, assigneeId }` objects. This works for single-user prototyping but is not viable for production use in a multi-user regulated environment.
- **What We Need**:
  ```
  GET /api/governance/v1/projects/{projectId}/assignment-rules

  Response (200 OK):
  {
    "data": [
      {
        "id": "rule-001",
        "policyId": "policy-abc",
        "policyName": "ADaM QC Plan - High Risk",
        "stageName": "Double Programming",
        "assigneeId": "user-xyz",
        "assigneeName": "Jane Doe",
        "createdAt": "2026-03-20T10:00:00Z",
        "createdBy": "admin-user",
        "updatedAt": "2026-03-25T14:00:00Z",
        "updatedBy": "admin-user"
      }
    ]
  }

  PUT /api/governance/v1/projects/{projectId}/assignment-rules

  Request:
  {
    "rules": [
      {
        "policyId": "policy-abc",
        "stageName": "Double Programming",
        "assigneeId": "user-xyz"
      }
    ]
  }

  Response (200 OK):
  {
    "data": [
      {
        "id": "rule-001",
        "policyId": "policy-abc",
        "policyName": "ADaM QC Plan - High Risk",
        "stageName": "Double Programming",
        "assigneeId": "user-xyz",
        "assigneeName": "Jane Doe",
        "createdAt": "2026-03-20T10:00:00Z",
        "createdBy": "admin-user",
        "updatedAt": "2026-03-26T09:00:00Z",
        "updatedBy": "current-user"
      }
    ]
  }
  ```
  - **HTTP methods**: `GET` to load rules, `PUT` to replace the full rule set for a project (idempotent).
  - **Scoping**: Rules are per-project, matching the current UI behavior where rules are scoped to the selected project.
  - **Alternative**: If a governance API endpoint is not feasible, a custom backend table (managed by the app's FastAPI layer) could store rules in a JSON file or lightweight database within the Domino project filesystem. This would at least make rules persistent across sessions and users within the same Domino deployment.
  - **Error cases**: 404 if projectId not found; 403 if user lacks project admin/write permissions.
- **Notes**: This is independent of Gaps 1-3 (rules can be stored without being applied). However, the value of persisted rules is limited until Gap 3 (apply rules) is also available. Consider implementing Gaps 4 and 3 together.

---

### 5. Pagination

- **Priority**: Medium
- **User Impact**: A study with 300+ deliverables will show only the first 200 in the QC Tracker table. The user has no indication that bundles are missing. They may make incorrect assumptions about QC coverage (e.g., thinking all deliverables have been assigned when 100+ are not even visible). This is a data completeness issue with direct regulatory risk.
- **Current Behavior**: All paginated endpoints use `limit=200` (Decision D9). The governance API returns `{ data: [...] }` with no `totalCount`, `nextCursor`, or `hasMore` field. The app has no way to detect whether results were truncated. The bundles endpoint (`GET /api/governance/v1/bundles?limit=200`) is the primary concern; attachments and findings also use `limit=200` but are less likely to exceed this threshold per bundle.
- **What We Need**: One or both of the following:
  ```
  Option A: Add pagination metadata to existing responses

  GET /api/governance/v1/bundles?limit=200&offset=0

  Response:
  {
    "data": [...],
    "totalCount": 347,
    "limit": 200,
    "offset": 0,
    "hasMore": true
  }

  Option B: Cursor-based pagination

  GET /api/governance/v1/bundles?limit=200

  Response:
  {
    "data": [...],
    "nextCursor": "eyJpZCI6ImJ1bmRsZS0yMDAifQ==",
    "hasMore": true
  }

  GET /api/governance/v1/bundles?limit=200&cursor=eyJpZCI6ImJ1bmRsZS0yMDAifQ==

  Response:
  {
    "data": [...],
    "nextCursor": null,
    "hasMore": false
  }
  ```
  - **Minimum viable solution**: Even without full pagination support, adding `totalCount` to the response would let the app display a "Showing 200 of 347 deliverables" warning banner, alerting users to truncation.
  - **Applies to**: `GET /api/governance/v1/bundles`, `GET /api/governance/v1/attachment-overviews`, `GET /api/governance/v1/bundles/{id}/findings`.
- **Notes**: The N+1 enrichment pattern (LIVE_API_STATUS item 2.3) compounds this issue. With 300 bundles and 3 enrichment calls each, the app would make 900+ requests on load. Pagination should be paired with lazy-loading enrichment data (only fetch approvals/findings/gates when a row is expanded) to keep request volume manageable.

---

### 6. Write Action Audit Trail

- **Priority**: Low (but required for GxP-regulated environments)
- **User Impact**: In a GxP-regulated pharma environment, every change to a deliverable's QC assignment must be traceable: who changed it, when, what the previous value was, and what the new value is. Today, no assignment changes persist at all (Gaps 1-3), so no audit trail exists. When write endpoints are implemented, the audit trail must be built in from the start — retrofitting audit logging after the fact is significantly harder and may not satisfy regulatory requirements.
- **Current Behavior**: No write operations exist, so there is nothing to audit. The app's local React state updates leave no trace after a page reload.
- **What We Need**: Every write endpoint (Gaps 1, 2, and 3) should include audit metadata in its response:
  ```
  Audit metadata (included in all write responses):

  {
    "audit": {
      "action": "stage_assignee_changed",
      "performedBy": {
        "id": "current-user-id",
        "userName": "jane_doe"
      },
      "performedAt": "2026-03-26T14:30:00Z",
      "changes": [
        {
          "field": "assignee",
          "bundleId": "bundle-001",
          "stageId": "stage-abc",
          "stageName": "Double Programming",
          "previousValue": {
            "id": "old-user-id",
            "userName": "john_smith"
          },
          "newValue": {
            "id": "new-user-id",
            "userName": "jane_doe"
          }
        }
      ]
    }
  }
  ```
  Additionally, a read endpoint to retrieve audit history would enable the app to display a change log:
  ```
  GET /api/governance/v1/bundles/{bundleId}/audit-log?limit=50

  Response:
  {
    "data": [
      {
        "id": "audit-001",
        "action": "stage_assignee_changed",
        "performedBy": { "id": "...", "userName": "..." },
        "performedAt": "2026-03-26T14:30:00Z",
        "changes": [...]
      }
    ]
  }
  ```
- **Notes**: This gap is sequentially dependent on Gaps 1-3. There is nothing to audit until write operations exist. However, the audit schema should be designed alongside the write endpoints so that audit metadata is baked into the response format from day one. Pharma companies operating under 21 CFR Part 11 or EU Annex 11 will require this for validation.

---

## Priority Summary

| Gap | Priority | Blocking | Proposed Endpoint |
|-----|----------|----------|-------------------|
| 1. Stage Reassignment | High | Blocks all individual assignment changes | `PUT /api/governance/v1/bundles/{bundleId}/stages/{stageId}/assignee` |
| 2. Bulk Assign | High | Blocks efficient multi-deliverable assignment | `POST /api/governance/v1/bundles/bulk-assign` |
| 3. Apply Assignment Rules | Medium | Blocks rule-based auto-assignment; depends on Gap 1 | `POST /api/governance/v1/bundles/apply-rules` |
| 4. Assignment Rules Persistence | Medium | Blocks multi-user/multi-session rule sharing | `GET/PUT /api/governance/v1/projects/{projectId}/assignment-rules` |
| 5. Pagination | Medium | Silently drops data in projects with 200+ deliverables | Pagination metadata on existing `GET` endpoints |
| 6. Write Action Audit Trail | Low | Required for GxP compliance; depends on Gaps 1-3 | Audit metadata on all write responses + `GET .../audit-log` |

### Dependency Graph

```
Gap 1 (Stage Reassignment)
  ├── Gap 2 (Bulk Assign) — can use Gap 1 as fallback
  ├── Gap 3 (Apply Rules) — requires Gap 1 or Gap 2
  └── Gap 6 (Audit Trail) — requires Gaps 1-3 to exist

Gap 4 (Rules Persistence) — independent, but value increases with Gap 3
Gap 5 (Pagination) — independent, no dependencies
```

### Recommended Implementation Order

1. **Gap 1** — Stage Reassignment (unblocks all write workflows)
2. **Gap 2** — Bulk Assign (high-value for QC leads managing large studies)
3. **Gap 5** — Pagination (data correctness, no write API dependency)
4. **Gap 4 + Gap 3** — Rules Persistence + Apply Rules (implement together)
5. **Gap 6** — Audit Trail (design with Gaps 1-2, implement when write APIs stabilize)
