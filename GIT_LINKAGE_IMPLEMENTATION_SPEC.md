# Implementation spec: Git-linkage for SCE QC Tracker

**Reader:** the agent maintaining `/mnt/code/app.py` + `/mnt/code/static/app.js`.
**Companion to:** `GIT_LINKAGE_FOR_DOMINO_EXPERT.md` (the brief).
**Scope:** Phases 1–3 of git-linkage. Phase 4 (provider webhook receiver) is **out of scope** until UCB asks for sub-minute reaction time.
**Assumption:** all UCB projects are git-backed (i.e., git provider, not DFS). No DFS code paths anywhere.

> **Corrected in round 4** (`app.py:340-353`, implementing agent finding): **do not guard on `projectType == "git_based"`.** On this cluster, git-backed projects report `projectType: "Analytic"` despite carrying a real `mainRepository`. The enum we documented in §A3 (`git_based | dfs`) is the swagger's documented surface, but the deployed value here is the legacy `Analytic`/`DataSet` enum from `swagger.json:53604` siblings. **Real signal:** resolve repos and check `mainRepository` (and/or `importedGitRepositories[]`) for a non-empty `uri`. Non-git projects yield no repos and are skipped by the empty-list return — no explicit guard needed.

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
- **The git read failed (e.g. 403, network error, repo not resolvable) → "Check unavailable"** (loud, dashed warning tag — *never green*). See §C7 for the credential context. This state is mandatory on a GxP dashboard: a failed read must never silently fall back to "in sync."
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

**Corrected from initial draft** — the path was wrong in the first cut of this spec. Verified against `swagger.json:7249`:

| Path | Use |
|---|---|
| `POST /v4/workspace/project/{projectId}/getCheckpointForCommitIds` | given a (dfsCommitId, [{repoId, commitId}]) tuple, get the **Provenance Checkpoint** |
| `GET /v4/mlflow/execution/{executionId}/provenanceCheckpoints` | when you know the execution that produced the evidence, pull checkpoints array |

`FetchCheckpointForCommitsRequest` (request body for the POST — both fields marked `required` in swagger):
```json
{
  "dfsCommitId": "",
  "gitRepoCommits": [
    { "repoId": "<24-hex>", "commitId": "<sha>" }
  ]
}
```
For git-based projects pass `dfsCommitId: ""` (sentinel). If the API rejects empty string, treat as 400 and skip the checkpoint enrichment — drift still works off `attachment.identifier`. Worth a probe on first integration.

`ProvenanceCheckpointDto` (response) fields we consume:
- `id`, `executionId`, `executionName`, `executionStart`, `commitMessage`
- `gitRepoCommits[]` — each item is a `ProvenanceGitRepoDto`: **`{id, name, commitId, branchName, isMainRepo}`** (note: `id`/`branchName`, not `repositoryId`/`branch` — different shape from the request side).
- `mainGitBranch`
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
    and reuse from there to eliminate the duplication.

    NOTE: do NOT guard on projectType == "git_based". On this cluster git-backed
    projects report projectType "Analytic" yet carry a real mainRepository.
    Resolve repos and let the empty-list return skip non-git projects.
    """
    proj = v4_get(f"/projects/{project_id}")
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

def get_checkpoint_for_commit(project_id: str, repo_id: str, commit_id: str) -> dict | None:
    """Returns ProvenanceCheckpointDto or None.

    Path is /v4/workspace/project/{projectId}/getCheckpointForCommitIds
    (NOT /v4/projects/{id}/... — different namespace).
    Both dfsCommitId and gitRepoCommits are schema-required; pass "" for the
    DFS side since UCB is git-only.
    """
    body = {"dfsCommitId": "", "gitRepoCommits": [{"repoId": repo_id, "commitId": commit_id}]}
    try:
        return _v4_post(
            f"/workspace/project/{project_id}/getCheckpointForCommitIds",
            json_body=body,
        )
    except HTTPException:
        return None
```

**Caching.** Wrap `resolve_repos`, `get_branch_head`, `list_commits`, `project_default_branch`, `get_checkpoint_for_commit` with a 60s TTL in-process cache keyed on the arg tuple. Use a tiny `_ttl_cache` decorator — do not add `cachetools`. The dashboard refresh latency on 218 deliverables drops by an order of magnitude once you collapse on `(projectId, repoId, branch)`.

---

## 4. New FastAPI routes (Phase 1 + Phase 2)

### `GET /api/projects/{projectId}/branches?names=ADAE,ADSL`

Returns `{branches: {<name>: {branchName, headCommit} | null}}`. Multi-name to let the frontend batch per project. Projects that resolve to zero repos return empty (replaces the prior "skip non-git_based" wording — see §0 correction).

Internally: `resolve_repos(projectId)` → for each `(repo, name)`, `get_branch_head(...)`. Aggregate. ThreadPool fan-out using the existing 16-worker pattern (`app.py:376`).

### `GET /api/projects/{projectId}/provenance?commit=<sha>`

Returns `ProvenanceCheckpointDto` or `null`. Used by the drift card to enrich the "validated at" panel with `executionName`, `executionStart`, full `gitRepoCommits[]`.

### Where `expectedBranch` and `filename` come from

**Resolved with implementing agent — no new convention needed for Phase 1.** Branch + filename are read live from the bundle's most-recent **Report** attachment identifier (parser already exists at `static/app.js:1887-1899`). That is the only Phase 1 data source.

Phase 2's "branch exists but no evidence yet" case (Tim's UCB ask: *"if someone makes a branch to work on ADAE, can this automatically track its status"*) cannot ride on attachments — by definition there is no attachment yet. Three options, **pick one with UCB** before coding Phase 2:

1. **`assignment_rules.json` override** (recommended). The tracker already file-backs per-deliverable config via `/api/assignment-rules` (`app.py:849-882`). Add a `branch_overrides: {bundleId: branchName}` map. Pros: team owns the file, audit-trail-friendly, no governance policy change, easy to bulk-load via CSV (matches the bulk-objectives flow you already shipped). Cons: another field for Study Leads to maintain.
2. **Bundle-name convention.** Derive `expectedBranch` from the bundle name (e.g., "ADAE Dataset v3" → `ADAE`). Pros: zero config. Cons: fragile, breaks the moment Study Leads name a bundle differently.
3. **Governance evidenceSet artifact.** Add an "expected branch" artifact to the policy's first stage so it's captured during bundle creation. Pros: GxP-clean. Cons: requires UCB-side policy change.

**Recommendation:** ship Phase 2 with #1 plus optional #2 fallback ("if no override, try `expectedBranch = bundle.name.split()[0]`"). Surface this in the dashboard as an editable "Expected branch" field on the deliverable detail panel.

### `POST /api/deliverables/drift`

Body: `{ deliverables: [{bundleId, projectId, expectedBranch, filename, validatedCommit, validatedSource}] }`.
Returns `{ results: [{bundleId, validated_at, branch_state, badge, badge_reason}] }` — one entry per input.

Caller (frontend) builds the deliverable list. For each bundle:
- If it has a most-recent Report attachment: pass `expectedBranch`, `filename`, `validatedCommit` from the attachment identifier.
- If it has none and Phase 2 mapping resolves a branch: pass `expectedBranch` only; `validatedCommit` = null. Server returns `branch_state` and a `not-started` / `in-development` badge.
- If neither: skip the bundle. The badge is rendered client-side as `no-validated-commit`.

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

def pick_drift_approval(bundle_id):
    """Return (approval_id, approver_user) for binding an automated drift Finding.

    Rules (round-3 decision, see Phase-3 finding-binding doc below):
      1. Prefer the currently-open approval (status PendingSubmission or
         PendingReview) — that's the stage actively gating the deliverable, so
         drift findings show up in the gating reviewer's queue.
      2. If the bundle is fully approved (no Pending* status), bind to the
         most-recent Approved approval — that's the stage whose validity is now
         questioned by the drift signal.
      3. approver = approval.approvers[0] mapped to {id, name}.
      4. assignee = same as approver in v1. (Alternative: per-bundle override
         from assignment_rules.json; not implemented in v1.)
    """
    approvals = requests.get(f"{BASE}/api/bundles/{bundle_id}/approvals",
                             headers=HEADERS).json() or []
    pending = next((a for a in approvals
                    if a.get("status") in ("PendingSubmission", "PendingReview")), None)
    target = pending or sorted(
        [a for a in approvals if a.get("status") == "Approved"],
        key=lambda a: a.get("updatedAt", ""), reverse=True
    )[:1]
    target = pending or (target[0] if target else None)
    if not target or not target.get("approvers"):
        return None, None
    a = target["approvers"][0]
    return target["id"], {"id": a["id"], "name": a["name"]}

def file_finding(bundle, name, description, severity="S2"):
    """Create a governance Finding for automated drift.

    Per governance_swagger.json:1599 + guardrails.CreateFindingRequest, REQUIRED:
    bundleId, approvalId, approver, assignee, name, severity. 'title' is NOT a
    field. Severity is S0–S3 (NOT High/Medium/Low). approver/assignee are {id,name}.
    """
    approval_id, approver = pick_drift_approval(bundle["id"])
    if not approval_id:
        # No bindable approval — log and skip rather than 400. Should be rare;
        # a bundle with no approvals at all isn't a normal SCE state.
        logger.warning(f"[drift-sweep] no approval to bind finding on bundle {bundle['id']}; skipping")
        return None
    body = {
        "bundleId": bundle["id"],
        "approvalId": approval_id,
        "approver": approver,                # first approver on the live/most-recent approval
        "assignee": approver,                # v1: same person; routes to gating reviewer
        "name": name,
        "description": description,
        "severity": severity,                # "S0" | "S1" | "S2" | "S3"; default S2 for drift
    }
    return requests.post(f"{BASE}/api/governance/findings", headers=HEADERS, json=body).json()

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

## 6. v4 → Public API migration — **deferred, separate PR, post-demo**

Originally I bundled this with Phase 1. Decoupling at the implementing agent's request: two of the touched paths (scripted-check job-start at `app.py:614`; RTF viewer raw read at `app.py:1091`) are working today, and the Public Jobs API shape (`/api/jobs/v1/jobs`, `runCommand` field) isn't in the nucleus swagger we have locally — it's documented in the Domino plugin's jobs skill but unverified against this cluster's `assets/public-api.json`. Regression risk on the demo path outweighs the cleanup benefit.

**Action for Phases 1–3:** ignore this section. Keep using `_v4_post("/jobs/start", …)` and the existing `git/raw` flow. Drift sweep job-starts (§5) also use existing v4 calls until §6 is verified.

**Action post-demo:**
1. Curl `$DOMINO_API_HOST/assets/public-api.json` from a workspace, confirm `/api/jobs/v1/jobs` is present and the body shape matches.
2. Behind a feature flag, dual-write: send to both `/v4/jobs/start` and `/api/jobs/v1/jobs` for one job and diff the resulting execution records.
3. Cut over scripted-check → public Jobs API.
4. Repeat the verification for the public files-at-commit reader before touching the RTF viewer.

### 6c. Governance host derivation (already in place — don't regress)

`_get_gov_host()` in `app.py:91` probes candidate hosts because governance is not on `$DOMINO_API_HOST`. Match this pattern if you ever proxy a new governance route — do not assume `$DOMINO_API_HOST` works. **This is the one §6 item that stays in scope** because it affects any new governance routes you add (e.g., the `gov_post("/findings", …)` route in §5).

---

## 7. Frontend (`static/app.js`)

### One new component: `DriftBadge`

Props: `{badge, validated_at, branch_state}` from the new `/api/deliverables/drift` response.
Renders one of the seven states from Section 1 with AntD `Tag` colors:
- `in-sync` → green
- `drift-other-files` → gold
- `drift-on-this-deliverable` → red
- `merged-ahead-of-validation` → red, bold
- `not-started` → default
- `no-validated-commit` → default
- `check-unavailable` → dashed warning tag; tooltip surfaces the underlying error (e.g. "Invalid Upstream Credentials" — see §7b). Never silently degrades to green.

### §7b. Git read credentials — known 403 on `git/branches` and `git/commits`

**Confirmed in round 4** by the implementing agent: with a bare platform API key, `gitRepositories/{repoId}/git/branches` and `git/commits` return **`403 "Invalid Upstream Credentials"`** on this cluster. This contradicts my round-1 brief answer to Q7 ("v4 ref endpoints serve from Domino-cached refs — no provider creds needed for branches/commits"); on UCB's deployment they do reach upstream and require a mapped credential.

**What this means for Phase 1:**
- The frontend ships with the `check-unavailable` badge state. Live drift lights up the moment the credential path is sorted; no frontend rework needed.
- A probe script `git_branches_probe.py` is committed to the repo. Matt should run it inside a Domino workspace (where the sidecar identity carries his GitHub credentials) to confirm whether the same call succeeds. This disambiguates "sidecar identity doesn't inherit git creds outside Domino" vs "this cluster never serves cached refs."

**Outcomes and follow-ups (one of):**
- Probe succeeds inside Domino → sidecar-identity issue. **Action:** document as a deployment prerequisite ("the app must run inside Domino as a user whose project has mapped GitHub credentials"). No tracker code change.
- Probe still 403s inside Domino → cluster config / per-repo credential mapping is mandatory. **Action:** UCB sets up a service-account credential mapped at the project repository level (`/v4/projects/{projectId}/repository/{repoId}/credentialMapping`). No tracker code change.

**Do not engineer per-user credential propagation into the tracker.** That's a multi-day rabbit hole and the wrong abstraction for a read-mostly dashboard. Document the requirement, let UCB configure the deployment.

Tooltip on hover: "Validated @ `<branch>@<sha[:8]>` · HEAD @ `<sha[:8]>` · `N` commits ahead". If `checkpoint` is present, append "Generated by execution `<executionName>` at `<executionStart>`".

### Batch the drift fetch

In the existing bundle-list refresh (`static/app.js` ~1895 area where attachments are processed), after the bundle list resolves, collect `{bundleId, projectId, expectedBranch, filename, validatedCommit}` and `POST /api/deliverables/drift` once. Set badges from the response.

`expectedBranch` mapping (matches §4 "Where expectedBranch and filename come from"):
- Phase 1: read live from the most-recent Report attachment identifier (`static/app.js:1887-1899`). No persistence needed.
- Phase 2: `assignment_rules.json` `branch_overrides: {bundleId: branchName}` field (file-backed, audit-trail-friendly), with bundle-name-prefix as a fallback heuristic. Surface as an editable "Expected branch" field on the deliverable detail panel.
- There is **no** localStorage deliverable→branch convention today; do not add one.

### Deep-link the badge

Click `DriftBadge` → open the existing file viewer at the branch HEAD if drift, or at `validatedCommit` if green. Use the existing `/api/attachments/raw` flow (v4 `git/raw`) — the §6 Public-API migration is deferred per the note in §6.

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
- Verify non-git projects: a bundle whose project resolves to zero repos returns empty (replaces prior "guard on projectType" test — see §0 correction).

### Migration sanity
- Compare a job started via the **old** `/v4/jobs/start` flow against one started via the **new** `/api/jobs/v1/jobs` for the same `runCommand` — both should produce equivalent execution records.

---

## 9. Out of scope (do not implement)

- Webhook receiver for Git providers. Push to Phase 4 if and only if UCB explicitly asks for sub-minute reaction time and accepts the standing-infra trade.
- Domino Flows. Stay with Scheduled Jobs. If QC for a deliverable evolves into a true multi-step DAG with heterogeneous environments, revisit; otherwise the Flyte-via-DominoJobTask wrapping is overhead.
- MCP routing on the request hot path. Keep the v4 + public API proxy as the read path; reserve MCP for operator/setup workflows.
- DFS code paths. All UCB projects are git-backed. (Don't guard on `projectType == "git_based"` either — see §0 correction; resolve on `mainRepository` presence.)
- Replacing `attachment.identifier.commit` parsing with provenance-only lookups. The attachment identifier is the canonical, documented anchor. Provenance is a companion enrichment.

---

## 10. Open questions — resolved

Answers from the implementing agent, recorded here so future readers don't re-litigate:

1. **Branch + filename source.** No localStorage convention — both come live from the most-recent Report attachment identifier (`static/app.js:1887-1899`). Spec §4 updated accordingly: Phase 1 is attachment-anchored only; Phase 2 needs a separate mapping (see §4 "Where expectedBranch and filename come from").
2. **Findings list/create.** Per-bundle list exists (`app.py:331`). Create is not currently proxied — implementing agent will add a thin `gov_post("/findings", body)` route. Body shape confirmed in §5 (required: `bundleId`, `approvalId`, `approver`, `assignee`, `name`, `severity`; severity enum is `S0..S3`, not `High/Medium/Low`).
3. **HW tier / environment.** Use project defaults — existing job-start path already omits unresolved ids and Domino falls back (`app.py:606-612`). No new resolution logic for Phase 3.
4. **Feature gate.** Mirror the existing config-driven pattern (`/api/config → window.__SCE_AI_ENABLED`, `app.js:9374`) with a `drift_enabled` flag. Honor `?drift=1` as a dev override.

## 10b. Phase 3 finding-binding (resolved round 3)

The implementing agent flagged that the verified `CreateFindingRequest` schema requires `approvalId`, `approver`, `assignee` — but an automated drift Finding has no human approval action behind it. Resolution:

- **`approvalId`:** bind to the **currently-open approval** (status `PendingSubmission` or `PendingReview`). If the bundle is fully approved, bind to the **most-recent `Approved`** approval — the stage whose validity is now in question.
- **`approver`:** the first entry in that approval's `approvers[]` array, mapped to `{id, name}`. Drives the routing — the finding lands in the gating reviewer's queue, which is the right human attention for "this stage may be stale."
- **`assignee`:** same person as `approver` for v1. (A later option: per-bundle override via `assignment_rules.json` if Study Leads want to triage to a different role first. Not in v1 scope.)
- **No service-account identity.** The schema requires real Domino users on both `approver` and `assignee`. There is no "system" enum value. Routing to the gating reviewer is therefore both the simplest and most defensible choice — the human who has authority over the stage is the human who sees the drift signal.
- **Edge case — bundle with zero approvals:** log + skip rather than 400. Not a normal SCE state; if it happens, the missing Findings will surface in the sweep logs.

See the updated `pick_drift_approval` + `file_finding` helpers in §5.

## 11. Open questions back to the brief author / UCB

These are customer-facing decisions, not implementation choices:

1. **Phase 2 mapping home.** §4 lists three options for where `expectedBranch` lives for deliverables without evidence yet. Recommendation is `assignment_rules.json` + a bundle-name-prefix fallback. Confirm with Tim before Phase 2 coding starts.
2. **Severity scale for drift Findings.** Severity is `S0..S3`. Default `S2` for drift-on-this-deliverable / merged-ahead-of-validation? Or only file Findings at all when QC fails (rather than on drift)?
3. **Auto-trigger QC jobs in v1, or Finding-only?** Recommendation is Finding-only for v1 (human in the loop, no automated job spend) and revisit after one cycle of dashboard accuracy data.

Send §11 answers (or "go with recommendations") and the implementing agent has everything needed to ship.
