# Implementation spec: Git-linkage for SCE QC Tracker

**Reader:** the agent maintaining `/mnt/code/app.py` + `/mnt/code/static/app.js`.
**Companion to:** `GIT_LINKAGE_FOR_DOMINO_EXPERT.md` (the brief).
**Scope:** Phases 1–3 of git-linkage. Phase 4 (provider webhook receiver) is **out of scope** until UCB asks for sub-minute reaction time.
**Assumption:** all UCB projects are `projectType == "git_based"`. No DFS code paths anywhere. Add a one-line guard that logs+skips a deliverable whose project is not git_based; do not branch logic on project type.

---

## 0. TL;DR — what changes in this codebase

1. **Add three thin endpoints** to `app.py`: `/api/projects/{id}/branches`, `/api/projects/{id}/provenance/{commit}`, `/api/deliverables/drift`. (Section 4.)
2. **Migrate two existing v4 calls to the Public API** (Section 6): job-start, and project-file-content.
3. **One scheduled-job script** in the project (`/mnt/code/scripts/qc_drift_sweep.py`) plus a single Scheduled Job definition in the UCB project. (Section 5.)
4. **Frontend changes** in `static/app.js`: a drift badge near each deliverable row + a dev-status pill. (Section 7.)
5. **No new dependencies.** No DB. No standing infra. Token re-acquired per call (existing pattern).

Effort: Phase 1 ≈ 1–1.5d. Phase 2 ≈ 1d. Phase 3 ≈ 1d. Frontend integration ≈ 0.5d.

---

## 1. The data model (single source of truth)

For each **deliverable = governance bundle**, derive two new computed values:

| Field | Type | Definition | Anchor |
|---|---|---|---|
| `validated_at` | `{branch, commit, source: "git", filename, executionId?, checkpointId?}` | The code state the most-recent Validated/Complete evidence was generated from. | `attachment.identifier` (canonical) + Provenance Checkpoint (companion). |
| `branch_state` | `{branchName, headCommit, exists, aheadOfValidated, mergedToDefault, fileTouchedSinceValidated}` | Current dev state of the deliverable's expected branch. | `gitRepositories/{repoId}/git/branches` + `git/commits` + `projectDefaultBranch`. |

Drift badge logic (one of):
- `validated_at` is null → **"No validated commit"** (gray).
- `branch_state.exists` is false → **"Not started"** (gray).
- `branch_state.headCommit == validated_at.commit` → **"In sync"** (green).
- `branch_state.aheadOfValidated > 0` and `fileTouchedSinceValidated == false` → **"Drift (other files)"** (amber).
- `branch_state.aheadOfValidated > 0` and `fileTouchedSinceValidated == true` → **"Drift on this deliverable"** (red).
- `branch_state.mergedToDefault == true` and head ≠ validated → **"Merged ahead of validation"** (red; explicit GxP signal).

**Governance state never reads from this.** "Validated" remains human-signed via existing stage-progression flow.

---

## 2. Endpoints to call (Domino side)

All are GETs unless noted. Auth pattern: existing `gov_get` / `v4_get` helpers continue to apply; new helpers in Section 3 for the public API.

### Governance (`/api/governance/v1/*`)
Already wired via `gov_get`. No change. Pull `attachment-overviews` (existing route at `app.py:836`) for the `identifier` payload.

### v4 — keep using
| Path | Use |
|---|---|
| `GET /v4/projects/{projectId}` | resolve `mainRepository`, `importedGitRepositories[]`, `projectType` guard |
| `GET /v4/projects/{projectId}/gitRepositories/{repoId}/git/branches?searchPattern=…&count=…` | branch-existence + HEAD |
| `GET /v4/projects/{projectId}/gitRepositories/{repoId}/git/commits?branch=…&count=…` | commit history for ancestry/drift |
| `GET /v4/projects/{projectId}/projectDefaultBranch` | default branch (for "merged ahead" detection) |

### v4 — new (this is the missed primitive)
| Path | Use | Schema |
|---|---|---|
| `POST /v4/projects/{projectId}/getCheckpointForCommits` | given a list of commit SHAs, get the **Provenance Checkpoint** that produced them | request: `{commitIds: [string]}` ; response: `ProvenanceCheckpointDto` |
| `GET /v4/mlflow/execution/{executionId}/provenanceCheckpoints` | when you know the execution that produced an attachment (rare for now), pull checkpoints | response: array of `ProvenanceCheckpointDto` |

`ProvenanceCheckpointDto` fields we use:
- `id`, `executionId`, `executionName`, `executionStart`
- `gitRepoCommits[]` — `{repositoryId, commitId, branch?}` per repo. **This is the cross-repo lineage** including imported repos.
- `mainGitBranch`
- `commitMessage`
- (ignore: `dfsCommit`, `dfsBranch`, `importedProjects[]` for our scope)

### Public API — migrate to these
| Path | Replaces |
|---|---|
| `POST /api/jobs/v1/jobs` body `{projectId, runCommand, title, hardwareTierId?, environmentId?}` | the current `_v4_post("/jobs/start", …)` at `app.py:614` |
| `GET /api/projects/v1/projects/{projectId}/files/{commitId}/{path}/content` | the v4 `git/raw` path used by `/api/attachments/raw` at `app.py:1091` (the RTF viewer) |
| `GET /api/projects/v1/projects/{projectId}` | optional cleanup; same data as `/v4/projects/{id}` via public API |

### Governance host gotcha
Per the Domino governance skill: governance is **not** routed through `$DOMINO_API_HOST`. The existing `_get_gov_host()` probe in `app.py` already handles this; do not regress it during these changes.

---

## 3. New helpers in `app.py`

Add adjacent to the existing helpers (~line 280, near `v4_get`).

```python
# --- Public API (preferred for new code) ---

def _public_base() -> str:
    # $DOMINO_API_HOST is set in workspaces/jobs; outside, fall back to captured external host.
    return (os.environ.get("DOMINO_API_HOST") or _external_host_cache.get("host") or "").rstrip("/")

def public_get(path: str, params=None):
    headers = get_auth_headers()  # existing helper, Bearer token
    url = f"{_public_base()}{path}"
    r = requests.get(url, headers=headers, params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def public_post(path: str, json_body=None):
    headers = get_auth_headers()
    url = f"{_public_base()}{path}"
    r = requests.post(url, headers=headers, json=json_body, timeout=30)
    r.raise_for_status()
    return r.json() if r.content else {}

# --- Repo resolution: unchanged from existing landmine fix at app.py:1103-1134 ---

def resolve_repos(project_id: str) -> list[dict]:
    """Returns [{id, uri, ref, serviceProvider, isMain: bool}, ...] deduped by id.
    Mirrors the existing logic in /api/attachments/raw; extract to a single helper
    and reuse from there to eliminate the duplication."""
    proj = v4_get(f"/projects/{project_id}")
    if proj.get("projectType") != "git_based":
        logger.warning(f"[git-linkage] skipping non-git project {project_id} (type={proj.get('projectType')})")
        return []
    seen, out = set(), []
    main = proj.get("mainRepository")
    if main and main.get("id") and main["id"] not in seen:
        seen.add(main["id"]); out.append({**main, "isMain": True})
    for ir in (proj.get("importedGitRepositories") or []):
        if ir.get("id") and ir["id"] not in seen:
            seen.add(ir["id"]); out.append({**ir, "isMain": False})
    return out

# --- Branch / commit lookups ---

def get_branch_head(project_id: str, repo_id: str, branch: str) -> dict | None:
    """Returns {branchName, commitId} or None if branch absent."""
    try:
        branches = v4_get(
            f"/projects/{project_id}/gitRepositories/{repo_id}/git/branches",
            params={"searchPattern": branch, "count": 50},
        )
    except HTTPException:
        return None
    for b in (branches or []):
        if b.get("name") == branch or b.get("branchName") == branch:
            return {"branchName": branch, "commitId": b.get("commitId") or b.get("sha")}
    return None

def list_commits(project_id: str, repo_id: str, branch: str, count: int = 200) -> list[dict]:
    return v4_get(
        f"/projects/{project_id}/gitRepositories/{repo_id}/git/commits",
        params={"branch": branch, "count": count},
    ) or []

def project_default_branch(project_id: str) -> str | None:
    try:
        ref = v4_get(f"/projects/{project_id}/projectDefaultBranch")
        return (ref or {}).get("value") or (ref or {}).get("name")
    except HTTPException:
        return None

# --- Provenance Checkpoint (companion anchor) ---

def get_checkpoint_for_commit(project_id: str, commit_id: str) -> dict | None:
    try:
        return _v4_post(
            f"/projects/{project_id}/getCheckpointForCommits",
            json_body={"commitIds": [commit_id]},
        )
    except HTTPException:
        return None
```

**Caching.** Wrap `resolve_repos`, `get_branch_head`, `list_commits`, `project_default_branch`, `get_checkpoint_for_commit` with a 60s TTL in-process cache keyed on the arg tuple. Use a tiny `_ttl_cache` decorator — do not add `cachetools`. The dashboard refresh latency on 218 deliverables drops by an order of magnitude once you collapse on `(projectId, repoId, branch)`.

---

## 4. New FastAPI routes (Phase 1 + Phase 2)

### `GET /api/projects/{projectId}/branches?names=ADAE,ADSL`

Returns `{branches: {<name>: {branchName, headCommit} | null}}`. Multi-name to let the frontend batch per project. Skip non-git_based projects (return empty).

Internally: `resolve_repos(projectId)` → for each `(repo, name)`, `get_branch_head(...)`. Aggregate. ThreadPool fan-out using the existing 16-worker pattern (`app.py:376`).

### `GET /api/projects/{projectId}/provenance?commit=<sha>`

Returns `ProvenanceCheckpointDto` or `null`. Used by the drift card to enrich the "validated at" panel with `executionName`, `executionStart`, full `gitRepoCommits[]`.

### `POST /api/deliverables/drift`

Body: `{ deliverables: [{bundleId, projectId, expectedBranch, filename, validatedCommit, validatedSource}] }`.
Returns `{ results: [{bundleId, validated_at, branch_state, badge, badge_reason}] }` — one entry per input.

This is the **batch endpoint** the dashboard hits once per refresh. Server-side concurrency, server-side caching. The frontend does no fan-out itself.

Drift computation per deliverable (sequential within one item, parallel across items):

```
1. repos = resolve_repos(projectId); if empty, return badge "skipped".
2. Pick the relevant repo:
     - If validatedSource is set and matches a repo by uri/branch context, use it.
     - Else use the main repo.
3. headInfo = get_branch_head(projectId, repo.id, expectedBranch)
4. defaultBranch = project_default_branch(projectId)
5. commits = list_commits(projectId, repo.id, expectedBranch, count=200)
6. aheadOfValidated = index_of(validatedCommit, commits)  # 0 if at head, N if N commits behind, None if not on branch
7. fileTouchedSinceValidated =
     any commit in commits[0:aheadOfValidated] whose changed-files contains `filename`
     (use git/commits with file-stats if available; if expensive, mark "unknown" and let the badge fall back to "Drift (any files)")
8. mergedToDefault = validatedCommit appears in list_commits(projectId, repo.id, defaultBranch, count=500)
9. checkpoint = get_checkpoint_for_commit(projectId, validatedCommit)   # companion enrichment, not gating
10. apply Section 1 badge rules.
```

**Notes / sharp edges:**
- True merge-base/is-ancestor isn't directly exposed; the "appears in default branch's commit list" approximation is fine for the dashboard but bound the page size and document the limitation in a code comment.
- If `validatedCommit` is null (no Validated evidence yet), short-circuit to `branch_state` only.
- `searchPattern` on `/git/branches` is a substring match in some Domino versions and a glob in others — match the result by exact `branchName` server-side rather than trusting the filter.

---

## 5. Phase 3 — Scheduled-Job drift sweep

### Script: `/mnt/code/scripts/qc_drift_sweep.py`

Runs in the **tracker project's own Scheduled Jobs**. Auth via the project's service identity (no per-user mapping needed for read paths).

```python
"""
Periodic drift sweep. For each Active bundle, check drift; on red badge, optionally
trigger a per-deliverable QC job (project-specific runCommand from a mapping file or
bundle-level config) and write a Finding if QC fails.

Idempotency: keyed on (bundleId, validatedCommit). Skip if we already filed a
Finding for the same key today (look back via /findings list).
"""
import os, requests, json, datetime as dt

BASE = os.environ["TRACKER_INTERNAL_BASE"]  # e.g. http://localhost:8888 inside the same project
TOKEN = open("/var/run/domino/access-token").read().strip() if os.path.exists("/var/run/domino/access-token") \
        else requests.get("http://localhost:8899/access-token").text.strip()
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

def list_active_bundles():
    return requests.get(f"{BASE}/api/bundles", headers=HEADERS,
                        params={"state": "Active", "limit": 500}).json()

def deliverable_payload(bundle):
    # Pull the most-recent Report attachment's identifier as the validated anchor.
    # Use the existing /api/bundles/{id}/detail or /api/attachment-overviews.
    ...

def trigger_qc_job(project_id, run_command, title):
    # Public Jobs API — replaces v4 /jobs/start
    return requests.post(f"{os.environ['DOMINO_API_HOST']}/api/jobs/v1/jobs",
        headers=HEADERS,
        json={"projectId": project_id, "runCommand": run_command, "title": title}).json()

def file_finding(bundle_id, title, description, severity="Medium"):
    return requests.post(f"{BASE}/api/governance/findings", headers=HEADERS,
        json={"bundleId": bundle_id, "title": title, "name": title,
              "description": description, "severity": severity}).json()

def main():
    deliverables = [deliverable_payload(b) for b in list_active_bundles()]
    drift = requests.post(f"{BASE}/api/deliverables/drift",
                          headers=HEADERS, json={"deliverables": deliverables}).json()
    for r in drift["results"]:
        if r["badge"] in ("drift-on-this-deliverable", "merged-ahead-of-validation"):
            # Optional: trigger QC job. Initial rollout: no auto-trigger; just file a Finding.
            file_finding(r["bundleId"], "Validation may be stale",
                         f"Branch HEAD is {r['branch_state']['headCommit'][:8]}, "
                         f"validated at {r['validated_at']['commit'][:8]}. "
                         f"Reason: {r['badge_reason']}.")

if __name__ == "__main__":
    main()
```

**Scheduled-Job definition** (created once via UI or `POST /v4/projects/{trackerProjectId}/scheduledjobs`):
- Schedule: `0 */15 * * * ?` (every 15 min) — tune after watching for a week.
- Command: `python scripts/qc_drift_sweep.py`
- Run mode: **Sequential** (avoid overlapping sweeps).
- Notifications: email on failure only.

**Why not auto-trigger QC jobs in v1:** keeps the human in the loop, matches the "Validated must remain governance-owned" constraint, and lets ops watch the badge accuracy for a few cycles before introducing automated job spend.

---

## 6. v4 → Public API migration (do this alongside Phase 1)

### 6a. Replace `_v4_post("/jobs/start", ...)` at `app.py:614`

```python
# OLD
job_req = {"projectId": project_id, "commandToRun": final_command}
job = _v4_post("/jobs/start", json_body=job_req)

# NEW
job_req = {"projectId": project_id, "runCommand": final_command, "title": title or "Scripted check"}
job = public_post("/api/jobs/v1/jobs", json_body=job_req)
```

`runCommand` is the public-API field name (not `commandToRun`). Pass `hardwareTierId` and `environmentId` directly — no need for the lookup helpers (`_find_hw_tier_id`, `_find_environment_id`) if the caller can supply ids; keep the lookups as a convenience layer.

### 6b. Replace `git/raw` deep-link reads at `app.py:1091`

```python
# OLD (v4)
url = f"{host}/v4/projects/{projectId}/gitRepositories/{rid}/git/raw"

# NEW (public, when projectType is git_based)
url = f"{host}/api/projects/v1/projects/{projectId}/files/{commit}/{path}/content"
```

Keep the existing repo-resolution probe as a fallback (the public path needs a commit SHA, not a branch+repo tuple — for callers that pass branch instead, resolve to a commit first via `get_branch_head`).

### 6c. Governance host derivation (already in place — don't regress)

`_get_gov_host()` in `app.py:91` probes candidate hosts because governance is not on `$DOMINO_API_HOST`. Match this pattern if you ever proxy a new governance route — do not assume `$DOMINO_API_HOST` works.

---

## 7. Frontend (`static/app.js`)

### One new component: `DriftBadge`

Props: `{badge, validated_at, branch_state}` from the new `/api/deliverables/drift` response.
Renders one of the six states from Section 1 with AntD `Tag` colors:
- `in-sync` → green
- `drift-other-files` → gold
- `drift-on-this-deliverable` → red
- `merged-ahead-of-validation` → red, bold
- `not-started` → default
- `no-validated-commit` → default

Tooltip on hover: "Validated @ `<branch>@<sha[:8]>` · HEAD @ `<sha[:8]>` · `N` commits ahead". If `checkpoint` is present, append "Generated by execution `<executionName>` at `<executionStart>`".

### Batch the drift fetch

In the existing bundle-list refresh (`static/app.js` ~1895 area where attachments are processed), after the bundle list resolves, collect `{bundleId, projectId, expectedBranch, filename, validatedCommit}` and `POST /api/deliverables/drift` once. Set badges from the response.

`expectedBranch` mapping: keep using the localStorage convention you already have for study/deliverable → branch. No new persistence.

### Deep-link the badge

Click `DriftBadge` → open the existing file viewer at the branch HEAD if drift, or at `validatedCommit` if green. Use the new public-API `files/{commit}/{path}/content` route from 6b.

---

## 8. Test plan

### Phase 1 — drift badge
- A bundle with no attachments → badge `no-validated-commit`.
- A bundle whose most-recent Report attachment commit equals the current branch HEAD → `in-sync`.
- Bump the branch one commit (other files) → `drift-other-files`.
- Bump the branch with a change to the deliverable's `filename` → `drift-on-this-deliverable`.
- Merge that branch into default → `merged-ahead-of-validation`.
- Bundle whose attachment was produced by a known Job → checkpoint enrichment shown in tooltip.

### Phase 2 — branch existence
- Project without the expected branch → `not-started`.
- Branch exists but no commits ahead of base → `in-sync` or `not-started` per business rule (pick one and document).

### Phase 3 — scheduled-job sweep
- Run the script manually first (`python scripts/qc_drift_sweep.py` in a workspace) before scheduling.
- Verify idempotency: run twice in a row → no duplicate Findings.
- Verify project guard: a non-git_based project in the bundle list is skipped, not errored.

### Migration sanity
- Compare a job started via the **old** `/v4/jobs/start` flow against one started via the **new** `/api/jobs/v1/jobs` for the same `runCommand` — both should produce equivalent execution records.

---

## 9. Out of scope (do not implement)

- Webhook receiver for Git providers. Push to Phase 4 if and only if UCB explicitly asks for sub-minute reaction time and accepts the standing-infra trade.
- Domino Flows. Stay with Scheduled Jobs. If QC for a deliverable evolves into a true multi-step DAG with heterogeneous environments, revisit; otherwise the Flyte-via-DominoJobTask wrapping is overhead.
- MCP routing on the request hot path. Keep the v4 + public API proxy as the read path; reserve MCP for operator/setup workflows.
- DFS code paths. All UCB projects are git_based. Guard, don't branch.
- Replacing `attachment.identifier.commit` parsing with provenance-only lookups. The attachment identifier is the canonical, documented anchor. Provenance is a companion enrichment.

---

## 10. Open questions for the implementing agent to confirm before coding

1. Does your existing localStorage `study/deliverable → branch` mapping have a per-deliverable filename, or only branch? The badge needs both for the `fileTouchedSinceValidated` calculation. If only branch, the badge collapses to "Drift (any files)" — still useful.
2. Confirm `gov_get("/findings", ...)` exists or is easy to add — the scheduled job needs it for idempotency.
3. Hardware tier / environment id resolution for the Phase 3 scheduled job: are you OK using the project's defaults (no override) for the initial cut?
4. Acceptable to ship Phase 1 + 2 behind a feature flag (`?drift=1` query param) for one sprint before defaulting on?

Send these answers (or "go") and the implementing agent has everything needed to ship.
