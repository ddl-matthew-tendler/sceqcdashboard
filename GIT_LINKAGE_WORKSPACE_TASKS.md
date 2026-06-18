# Tasks for the in-Domino workspace agent

You are running inside a Domino workspace (you have the sidecar identity at
`http://localhost:8899/access-token` and `$DOMINO_API_HOST` is set). The other
agent built Phase 1 git-linkage but cannot reach the cluster — every git read
401/403s with a bare platform API key. We need you to answer ONE question and
verify a couple of endpoints from inside Domino.

## Step 0 — pull latest
```bash
cd <this repo>            # the Study_Lead_QCHub project checkout
git pull origin main
```

## Step 1 — run the probe (this is the main ask)
Launch in / run from a workspace opened in the **AGT_6741_CSR** project (project
id `6a28b1b84da5364a82ae0c65`), because that's the git-backed project the probe
points at.
```bash
python git_branches_probe.py
```
It writes `git_probe_results.json`. Then:
```bash
git add git_probe_results.json
git commit -m "Git-linkage: in-Domino probe results"
git push origin main
```

## Step 2 — what we need to learn (the probe checks all of these)
1. **THE KEY ONE — `git_branches`**: does `GET /v4/projects/{id}/gitRepositories/{repoId}/git/branches`
   return **200 with branch data** inside Domino (vs the local **403
   INVALID_UPSTREAM_CREDENTIALS**)? And which auth header worked
   (`Authorization: Bearer` vs `X-Domino-Api-Key`)? The probe records `working_auth`.
   - 200 ⇒ the deployed app shows live drift with **zero code change**.
   - 403 ⇒ it's a cluster git-credential-mapping prerequisite for UCB, not an app bug.
2. **`git_commits`** on `dev/t_14_1_1` — confirm commit objects come back and note
   the field that holds the SHA (`id` / `sha` / `commitId`) and whether each commit
   carries a changed-files list (we use that for the "drift on THIS deliverable" badge).
3. **`getCheckpointForCommitIds`** (`POST /v4/workspace/project/{id}/getCheckpointForCommitIds`)
   — confirm the path is right and capture the real `ProvenanceCheckpointDto` field
   names (we need them for the Phase 3 provenance tooltip).
4. **`projectDefaultBranch`** — confirm the response shape (we read `.value`/`.name`).

## Step 3 — report
The committed `git_probe_results.json` is the report; its `VERDICT` field states
the headline. If `git_branches` is 403, also paste the exact error body so we can
tell UCB whether it's a missing credential mapping vs a scope/permission issue.

## Notes
- The app code is already on `main` (helpers in `app.py`, `DriftBadge` +
  `/api/deliverables/drift` in `static/app.js`). You do NOT need to change app code.
- If `git_branches` returns 200, the backend already handles real drift states; the
  only reason it currently shows "check-unavailable" everywhere is the 403.
- If anything in the probe is wrong for this cluster (repo id, branch), fix the
  constants at the top of `git_branches_probe.py` and re-run.
