# Reply to the implementation spec — §10 answers + corrections

**From:** the implementing agent on `app.py` / `static/app.js`.
**Re:** `GIT_LINKAGE_IMPLEMENTATION_SPEC.md` §10.
**Status:** not "go" yet — three spec assumptions don't match the codebase/API and need a round-trip first. Answers below, then corrections, then my questions back.

---

## Answers to §10

**Q1 — Does the localStorage `deliverable → branch` mapping carry filename, or only branch?**
Neither — **that mapping does not exist.** Verified every localStorage key in `static/app.js`; the set is `sce_csv_column_mapping`, `sce_assignment_rules`, `sce_automation_rules`, `sce_scope_presets`, `sce_debug_mode`, `domino:drawerWidth`, etc. None is a deliverable→branch convention.

What we actually have: branch **and** filename are read live from the **most-recent Report attachment's `identifier`** ([static/app.js:1887-1899](static/app.js)): `a.identifier.branch` and `a.identifier.filename`.
- Good: `filename` **is** available, so `fileTouchedSinceValidated` is computable — the badge does **not** collapse to "Drift (any files)".
- Caveat: this anchor only exists once a deliverable has a Report attachment. A brand-new deliverable with no evidence has no branch to compare. See correction B / question 1.

**Q2 — Does `gov_get("/findings")` exist, or is it easy to add?**
- **List:** exists per-bundle — `gov_get("/bundles/{id}/findings")` ([app.py:331](app.py), batch variant at [app.py:365](app.py)). Sufficient for the idempotency check (scan one bundle's findings).
- **Create:** not exposed by our proxy today (we only read). The **governance API supports it** — `POST /api/governance/v1/findings` is in `governance_swagger.json` (alongside `PUT /findings/{id}`, `PUT /rpc/bulk-edit-findings`). So I'll add a thin `gov_post("/findings", …)` route. The script's `POST /api/governance/findings` target must be created — trivial, but I need the exact body contract (question 3).

**Q3 — OK to use the project's default hardware tier / environment for the Phase 3 job?**
**Yes.** `_find_hw_tier_id` / `_find_environment_id` already exist ([app.py:492](app.py), [app.py:507](app.py)), and the current job-start path already omits `environmentId`/`hardwareTierId` when they don't resolve, so Domino applies the project defaults ([app.py:606-612](app.py)). "Defaults, no override" is the existing, working behavior — no new code needed for the initial cut.

**Q4 — OK to ship Phase 1+2 behind a `?drift=1` flag for one sprint?**
Yes to gating — but the app's **established** gate is server-config-driven, not a query param: `/api/config` → `window.__SCE_AI_ENABLED` ([static/app.js:9374-9381](static/app.js), [12474](static/app.js)). I'll mirror that with a `drift_enabled` flag in `/api/config` so it toggles centrally and matches how AI controls are gated. Happy to also honor `?drift=1` as a dev override on top, but the config flag should be the real switch.

---

## Corrections (these block coding as written)

**A. The checkpoint endpoint path in §2/§3 is wrong.**
Spec uses `POST /v4/projects/{projectId}/getCheckpointForCommits`. That path does not exist. Verified in the full swagger, the real one is:
`POST /v4/workspace/project/{projectId}/getCheckpointForCommitIds` (note the `/workspace/project/` prefix and `…CommitIds`).
`GET /v4/mlflow/execution/{executionId}/provenanceCheckpoints` (the §2 row 2) is correct. I need the verified request/response schema for `getCheckpointForCommitIds` before wiring `get_checkpoint_for_commit` (question 4).

**B. No `deliverable → expectedBranch` convention exists** (expands Q1).
Spec §7 ("keep using the localStorage convention you already have") and §10 Q1 both assume a mapping that isn't there. Consequence: **Phase 1 (drift) works today** off the attachment anchor, but **Phase 2 ("Not started" / "someone just made an ADAE branch")** can't run until we define how a deliverable maps to an expected branch for deliverables with no evidence yet. This is the exact open decision flagged in the brief §5 that UCB has not made.

**C. Public Jobs API path/field unverified.**
I can't confirm `/api/jobs/v1/jobs` + `runCommand` from the available (nucleus) swagger — that's the Public API with a separate spec (nucleus shows only `/jobs` with `commandToRun`). I'll verify at implementation. Flagging that the §6 migration rewrites two **currently-working** paths (scripted-check at [app.py:609-614](app.py), RTF viewer raw-file read at [app.py:1091](app.py)) — regression risk worth isolating (question 2).

---

## Questions back (need these before "go")

1. **Branch source for pre-evidence deliverables.** Since branch currently derives only from the attachment identifier: shall I scope **Phase 1 to attachment-anchored deliverables** (ships now, no UCB dependency), and for **Phase 2** introduce a `deliverable → expectedBranch` rule — and if so, where does the explicit override live: localStorage (like other prefs), the existing `assignment_rules.json`, or a governance bundle attribute? This is the one UCB-facing decision.
2. **Decouple §6 migration from Phase 1?** I'd prefer to ship drift on the existing `v4_get`/`_v4_post` calls and do the Public-API migration (`/jobs/start` → `/api/jobs/v1/jobs`, `git/raw` → public `files/.../content`) as a separate, independently-tested change — keeps regression risk off the scripted-check and RTF viewer before the UCB demo. OK to split?
3. **`POST /findings` contract.** Confirm the required body for `POST /api/governance/v1/findings`. The script assumes `{bundleId, title, name, description, severity}` — does it also need `stageId`, `policyId`, or a status enum? I'll add the proxy route once the shape is confirmed.
4. **`getCheckpointForCommitIds` schema.** Per correction A — please supply the verified path's request body and the `ProvenanceCheckpointDto` field names as actually returned (the §2 list is plausible but unverified against this endpoint).

Answer 1–4 (and ack A–C) and I'm clear to implement Phase 1 immediately, with Phase 2 contingent on the branch-convention decision.

---

## Round 2 — ack + go

Corrections A and C landed; §10 schema details (checkpoint path, `S0–S3` findings body) confirmed. **Phase 1 is unblocked and I'm starting it now** (attachment-anchored drift, no findings dependency).

**§11 — going with your recommendations**, with one refinement:
1. **Mapping home:** `assignment_rules.json` + bundle-name-prefix fallback + editable "Expected branch" field. ✅
2. **Severity:** `S2` for the two red states — but **file Findings only on `drift-on-this-deliverable` and `merged-ahead-of-validation`, never on amber `drift-other-files`** (avoids dashboard noise). ✅
3. **Finding-only in v1, no auto-triggered jobs.** ✅

**Two items for you (neither blocks Phase 1):**
- **Doc fix:** §7 line 377 still reads "keep using the localStorage convention you already have… No new persistence" — contradicts §4/§10. Please update it to point at `assignment_rules.json` + the editable Expected-branch field.
- **Phase 3 blocker:** the confirmed findings body requires `approvalId`, `approver`, `assignee`. An automated drift Finding isn't tied to a human approval — **which approval does it bind to (current open stage? validation stage?), and what identity for `approver`/`assignee` (service account vs the stage's current assignee)?** Need this before Phase 3; Phase 1 doesn't touch it.

**Status:** Phase 1 — starting now. Phase 2 — unblocked once you confirm 11.1 with Tim. Phase 3 — pending the approval-binding answer above. Ready on my side.

---

## Round 4 — Phase 1 shipped + new badge state for §7

Phase 1 is implemented and verified in-browser against the live cluster (backend + frontend). The badge now renders in **three** surfaces: the main QC Tracker list, the Metrics "Validation Task Status" table, and the deliverable detail drawer header. ack §7 doc fix + §10b finding-binding — both good, will use §10b verbatim when I build Phase 3.

**Please add this 10th state to the §7 DriftBadge spec — it's already shipped:**

> **`check-unavailable`** (gray tag, **dashed** border, warning icon). Emitted when the Domino git proxy read fails (e.g. 403 `INVALID_UPSTREAM_CREDENTIALS`) so the branch HEAD could not be resolved. Tooltip: "Domino could not read the branch — drift is NOT being checked. Git credential mapping may need configuration." This state is deliberately distinct from `not-started`: a failed read must **never** be shown as absent-branch or in-sync. Backend `get_branch_head` returns `{_error}` (vs `None` for a confirmed-absent branch) and `_compute_drift` short-circuits to this badge before any commit comparison.

**Why it matters on this cluster:** with a bare platform API key, every git-backed deliverable currently lands on `check-unavailable` (403). That's the open creds question — Matt is running `git_branches_probe.py` inside a Domino workspace to confirm whether the sidecar identity carries the upstream git credential. If yes, all these flip to real in-sync/drift states with no code change.
