# Dummy Data Audit — SCE QC Tracker

> **Generated**: 2026-03-26
> **Scope**: All files in the SCE QC Tracker Domino app
> **Purpose**: Map every dummy/mock data reference before migrating to fully live APIs

---

## 1. Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐
│  Browser     │────▶│  FastAPI      │────▶│  Domino APIs      │
│  app.js      │     │  app.py       │     │  governance/v1    │
│  mock_data.js│     │  (proxy)      │     │  v4               │
└─────────────┘     └──────────────┘     └───────────────────┘
```

**Data flow on startup:**
1. Frontend calls `fetchLiveData()` → hits backend proxy → hits Domino APIs
2. If any step fails, frontend catches the error and calls `loadMockData()`
3. `loadMockData()` reads from `MOCK_*` globals defined in `mock_data.js`
4. A "Dummy Data" toggle in the top nav lets users manually switch

**Files involved:**
| File | Lines | Role |
|------|-------|------|
| `static/mock_data.js` | 840 | All mock data constants |
| `static/app.js` | ~2600 | React app, API calls, fallback logic |
| `app.py` | 186 | FastAPI backend proxy to Domino APIs |
| `static/index.html` | 35 | Loads `mock_data.js` before `app.js` |
| `app.sh` | 2 | Starts uvicorn on port 8888 |

---

## 2. Mock Data Constants (`static/mock_data.js`)

### MOCK_TERMINOLOGY (line 7)
| Field | Mock Value | Live API Equivalent |
|-------|-----------|---------------------|
| `bundle` | `"Deliverable"` | `GET /v4/admin/whitelabel/configurations` |
| `policy` | `"QC Plan"` | Same endpoint |

### MOCK_USERS (line 13)
Map of 6 user objects keyed by alias.

| Alias | userName | ID | Live API |
|-------|----------|----|----------|
| `agnes` | `agnes_domino` | `69160c9da4464d12be7f6e84` | `GET /v4/users` |
| `ross` | `ross_domino` | `690a96caa4464d12be7f6e83` | Same |
| `etan` | `etan_domino` | `6972a494aa27113e76bd1c6c` | Same |
| `studyLead` | `study_lead` | `6926323aa4464d12be7f6e87` | Same |
| `qcProg` | `qc_programmer` | `6966cdf424fcea6bf65ad4f5` | Same |
| `prodProg` | `production_programmer` | `6926318da4464d12be7f6e86` | Same |

### MOCK_PROJECT_MEMBERS (line 24)
Array of 6 objects derived from `MOCK_USERS`. Shape: `{ id, userName, firstName, lastName }`.

| Live API Equivalent |
|---------------------|
| `GET /v4/projects/{projectId}/collaborators` |

### MOCK_POLICIES (line 30)
Array of 7 policy/QC plan objects. Shape: `{ id, name, status, stages[] }`.

| Policy Name | Stages | Live API |
|-------------|--------|----------|
| ADaM QC Plan - High Risk | Self QC → Double Programming → Study Lead Verification | `GET /api/governance/v1/policy-overviews` |
| ADaM QC Plan - Low Risk | Self QC → Study Lead Verification | Same |
| TFL QC Plan - High Risk | Self QC → Study Lead Verification → Double Programming | Same |
| TFL QC Plan - Low Risk | Self QC → Study Lead Verification | Same |
| RWE Regulatory Submission Policy | 6 stages | Same |
| Surgical AI Governance QC Plan | 6 stages | Same |
| Data Access Request & Approval Policy | 5 stages | Same |

### MOCK_PROJECT_TAGS (line 113)
Map of 4 project IDs → arrays of `{ key, value }` tag objects (~30 tags total).

| Project ID | Project Name | Live API |
|------------|-------------|----------|
| `proj-cdiscpilot` | CDISC_Pilot_Study_01 | `GET /v4/projects` (tags on project metadata) |
| `proj-rwe-migraine` | Scalable_RWE_Migraine | Same |
| `proj-surgical-ai` | Surgical_AI_Validation | Same |
| `proj-data-access` | Data_Governance_Central | Same |

### MOCK_BUNDLES (line 149)
Array of 15 bundle/deliverable objects. Shape: `{ id, name, state, projectId, projectName, projectOwner, policyId, policyName, stage, stages[], stageAssignee, commentsCount, createdAt, updatedAt, createdBy }`.

| Live API Equivalent |
|---------------------|
| `GET /api/governance/v1/bundles?limit=100` |

### MOCK_APPROVALS (line 342)
Map of 10 bundle IDs → arrays of approval objects (~30 total). Shape: `{ id, name, bundleId, status, approvers[], updatedAt, updatedBy }`.

| Live API Equivalent |
|---------------------|
| `GET /api/governance/v1/bundles/{bundleId}/approvals` |

### MOCK_FINDINGS (line 429)
Map of 5 bundle IDs → arrays of finding objects (~7 total). Shape: `{ id, name, bundleId, severity, status, description, assignee, approver, dueDate, createdAt, updatedAt }`.

| Live API Equivalent |
|---------------------|
| `GET /api/governance/v1/bundles/{bundleId}/findings?limit=100` |

### MOCK_GATES (line 506)
Map of 2 bundle IDs → arrays of gate objects (~4 total). Shape: `{ id, name, bundleId, isOpen, reason }`.

| Live API Equivalent |
|---------------------|
| `GET /api/governance/v1/bundles/{bundleId}/gates` |

### MOCK_ATTACHMENTS (line 517)
Map of 11 bundle IDs → arrays of attachment objects (~38 total). Shape: `{ id, type, identifier, createdAt, createdBy }`. Types: `DatasetSnapshotFile`, `Report`, `NetAppVolumeSnapshotFile`.

| Live API Equivalent |
|---------------------|
| `GET /api/governance/v1/attachment-overviews` |

---

## 3. Frontend References (`static/app.js`)

### 3a. State & Toggle

| Location | Code | Purpose |
|----------|------|---------|
| Line 2324 | `useState(true)` → `useDummy` | Dummy data toggle state, **defaults to `true`** |
| Lines 191–200 | `h(Switch, { checked: useDummy, ... })` | Toggle switch in TopNav, shown when `!connected` |
| Lines 2485–2492 | `handleToggleDummy(checked)` | Switches between `loadMockData()` and `fetchLiveData()` |

### 3b. loadMockData() — Lines 2423–2443

Reads all `MOCK_*` constants and enriches bundles:

| Line | Reference | Fallback |
|------|-----------|----------|
| 2425 | `MOCK_BUNDLES` | `setBundles([])` if undefined |
| 2428 | `MOCK_APPROVALS[b.id]` | `[]` if undefined |
| 2429 | `MOCK_FINDINGS[b.id]` | `[]` if undefined |
| 2430 | `MOCK_GATES[b.id]` | `[]` if undefined |
| 2431 | `MOCK_ATTACHMENTS[b.id]` | `[]` if undefined |
| 2438 | `MOCK_TERMINOLOGY` | Uses `DEFAULT_TERMS` if undefined |

### 3c. fetchLiveData() — Lines 2446–2477

| Line | API Call | On Success | On Failure |
|------|----------|------------|------------|
| 2448 | `GET api/bundles?limit=100` | Sets `connected=true`, enriches bundles | Falls back to `loadMockData()` |
| 2455 | `GET api/bundles/{id}/approvals` | Adds to `bundle._approvals` | Returns `[]` |
| 2456 | `GET api/bundles/{id}/findings?limit=100` | Adds to `bundle._findings` | Returns `{ data: [] }` |
| 2457 | `GET api/bundles/{id}/gates` | Adds to `bundle._gates` | Returns `[]` |
| 2497 | `GET api/terminology` | Sets custom terms | Silently ignored |

### 3d. MOCK_PROJECT_MEMBERS References (6 locations)

| Line | Component | Usage |
|------|-----------|-------|
| 1286 | Bundle Drawer | Stage reassignment dropdown options |
| 1468 | Bulk Assign Bar | Bulk assignee dropdown options |
| 1945 | Assignment Rules | `memberOptions` useMemo for rule assignees |
| 1978 | Assignment Rules | `applyPreview` — resolving assignee display names |
| 2086 | Assignment Rules | Table column render — assignee display name |
| 2358 | App (Scope) | "My Work" persona selector dropdown |

**Live equivalent:** `GET /v4/projects/{projectId}/collaborators` — should be fetched per-project, not global.

### 3e. MOCK_PROJECT_TAGS References (3 locations)

| Line | Component | Usage |
|------|-----------|-------|
| 2348 | App (Scope) | Tag options for scope filter |
| 2350 | App (Scope) | Same — extracting tags per project |
| 2369–2370 | App (Scope) | `scopedBundles` filter — matching tags |

**Live equivalent:** Tags on project metadata from `GET /v4/projects`.

### 3f. MOCK_POLICIES Reference (1 location)

| Line | Component | Usage |
|------|-----------|-------|
| 1927–1928 | Assignment Rules | Stage options for selected QC Plan |

Falls back to extracting stages from bundle data if `MOCK_POLICIES` is undefined.

**Live equivalent:** `GET /api/governance/v1/policies/{policyId}` — stages array.

### 3g. DEFAULT_TERMS — Line 47

```javascript
var DEFAULT_TERMS = { bundle: 'Bundle', policy: 'Policy' };
```

Hardcoded fallback when terminology API unavailable. Used as `props.terms || DEFAULT_TERMS` in 50+ locations.

**Live equivalent:** `GET /api/terminology` → backend → `GET /v4/admin/whitelabel/configurations`.

### 3h. Hardcoded Default User — Line 2331

```javascript
useState('production_programmer')  // scopeCurrentUser
```

Default "My Work" persona. Should be the actual logged-in Domino user.

**Live equivalent:** `GET /v4/users/self` or Domino session context.

---

## 4. Backend API Endpoints (`app.py`)

### Governance API Proxy Routes

| Backend Route | Method | Domino API | Query Params |
|---------------|--------|------------|--------------|
| `/api/bundles` | GET | `GET /api/governance/v1/bundles` | limit, offset, search, state |
| `/api/bundles/{id}` | GET | `GET /api/governance/v1/bundles/{id}` | — |
| `/api/bundles/{id}/approvals` | GET | `GET /api/governance/v1/bundles/{id}/approvals` | — |
| `/api/bundles/{id}/findings` | GET | `GET /api/governance/v1/bundles/{id}/findings` | limit, offset |
| `/api/bundles/{id}/gates` | GET | `GET /api/governance/v1/bundles/{id}/gates` | — |
| `/api/attachment-overviews` | GET | `GET /api/governance/v1/attachment-overviews` | bundleId, limit, offset |
| `/api/compute-policy` | POST | `POST /api/governance/v1/rpc/compute-policy` | (JSON body) |
| `/api/policies` | GET | `GET /api/governance/v1/policy-overviews` | — |
| `/api/policies/{id}` | GET | `GET /api/governance/v1/policies/{id}` | — |

### v4 API Proxy Routes

| Backend Route | Method | Domino API |
|---------------|--------|------------|
| `/api/users` | GET | `GET /v4/users` |
| `/api/projects` | GET | `GET /v4/projects` |
| `/api/terminology` | GET | `GET /v4/admin/whitelabel/configurations` |

### Authentication (Lines 19–30)

```
1. Check API_KEY_OVERRIDE env var → X-Domino-Api-Key header
2. Else call http://localhost:8899/access-token → Bearer token
3. Else raise HTTP 503
```

### Terminology Fallback (Lines 166–186)

```python
defaults = {"bundle": "Bundle", "policy": "Policy"}
# Tries whitelabel API, silently returns defaults on failure
```

---

## 5. Environment Variables

| Variable | Required | Purpose | Used In |
|----------|----------|---------|---------|
| `DOMINO_API_HOST` | Yes | Base URL for Domino instance | `app.py` line 16 |
| `API_KEY_OVERRIDE` | No | Static API key (skips token endpoint) | `app.py` line 20 |

When `DOMINO_API_HOST` is not set, all backend endpoints return HTTP 503, and the frontend falls back to mock data.

---

## 6. No-Op / Placeholder Operations

These operations update local React state but do NOT persist to any backend API:

| Operation | Location | What Happens | What Should Happen |
|-----------|----------|-------------|-------------------|
| Stage Reassignment | `app.js` line 1307 | `console.log(...)` + local state update | `POST` or `PUT` to Domino governance API to update stage assignee |
| Bulk Assign | `app.js` line 1474 | `console.log(...)` + success toast + local state | Same — batch update stage assignees |
| Assignment Rules CRUD | `app.js` (AssignmentRulesPage) | Local `assignmentRules` state only | Persist rules to backend (no Domino API exists for this — custom storage needed) |
| Apply Rules | `app.js` `handleApplyRules()` | Deep-clones bundles, updates assignees in memory | Should call Domino API to update each bundle's stage assignee |

---

## 7. Data NOT Fetched from Live API

These data types are used in the app but have **no corresponding `fetchLiveData()` call**:

| Data | Mock Source | Why Not Fetched | What's Needed |
|------|-------------|-----------------|---------------|
| Project members | `MOCK_PROJECT_MEMBERS` | No API call in app | `GET /v4/projects/{id}/collaborators` |
| Project tags | `MOCK_PROJECT_TAGS` | No API call in app | `GET /v4/projects` (tags in metadata) |
| Policies/stages | `MOCK_POLICIES` | Only used in Assignment Rules | `GET /api/governance/v1/policy-overviews` (already proxied) |
| Attachments | `MOCK_ATTACHMENTS` | Fetched only via mock enrichment | `GET /api/governance/v1/attachment-overviews?bundleId={id}` (already proxied) |
| Current user | Hardcoded `'production_programmer'` | No API call | `GET /v4/users/self` or Domino session |

---

## 8. Script Loading Order (`static/index.html`)

```html
<script src="/static/mock_data.js"></script>   <!-- Defines window.MOCK_* globals -->
<script src="/static/app.js"></script>           <!-- Checks typeof MOCK_* at runtime -->
```

All mock constants are simple `var` declarations that become `window.*` globals. The app uses `typeof MOCK_X !== 'undefined'` guards before accessing them.

---

## 9. Migration Checklist

To go fully live (remove all dummy data dependency):

- [ ] **Fetch project members from API** — Replace all 6 `MOCK_PROJECT_MEMBERS` references with live data from `/v4/projects/{id}/collaborators`
- [ ] **Fetch project tags from API** — Replace 3 `MOCK_PROJECT_TAGS` references with project metadata from `/v4/projects`
- [ ] **Fetch policies from API** — Replace `MOCK_POLICIES` reference in Assignment Rules with `/api/policies`
- [ ] **Fetch attachments per bundle** — Add `GET /api/attachment-overviews?bundleId={id}` call in `fetchLiveData()`
- [ ] **Get current user** — Replace hardcoded `'production_programmer'` with actual user from Domino session
- [ ] **Implement write APIs** — Stage reassignment, bulk assign, and apply rules need real POST/PUT endpoints
- [ ] **Persist assignment rules** — Either add backend storage or use Domino project metadata
- [ ] **Remove mock_data.js from index.html** — Or gate it behind a dev/demo flag
- [ ] **Remove Dummy Data toggle** — Or keep as dev-only feature
- [ ] **Set DOMINO_API_HOST** — Required env var for all live API calls
- [ ] **Handle pagination** — Current `?limit=100` may miss bundles in large projects (300–500 deliverables)
- [ ] **Optimize N+1 queries** — 3 API calls per bundle (approvals, findings, gates) = 42+ requests on load
