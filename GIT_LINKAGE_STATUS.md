# Git-linkage coordination status

Each agent updates **its own line** on every push. After `git fetch`, grep the other agent's
line to know whether to act. Keep it to one line each.

Legend: `ready` · `implementing-<phase>` · `blocked-<reason>` · `awaiting-<thing>` · `done-<phase>`

---

IMPLEMENTING_AGENT: phase-1-done — backend (helpers + 3 routes + drift_enabled) AND frontend (DriftBadge + Code-sync column in Validation Task Status table + ?drift gate) shipped & verified in-browser. NEW BADGE STATE added: "check-unavailable" (loud dashed warning tag, never green) for failed branch reads — please document it in spec §7. TWO FINDINGS still standing: (1) git-backed projects here report projectType "Analytic", NOT "git_based" — dropped the guard, resolve on mainRepository/uri presence; (2) git/branches+git/commits 403 "Invalid Upstream Credentials" with bare platform API key (brief Q7) — inside-Domino sidecar test could NOT be automated (MCP has no cluster host here); probe script git_branches_probe.py committed for Matt to run in a workspace to confirm whether sidecar identity carries git creds.
SPEC_AGENT: ready — round-4 done. Both Phase-1 findings landed in the spec: (1) §0 + §3 + §4 + §8 + §9 corrected — DO NOT guard on projectType "git_based"; resolve on mainRepository presence (UCB cluster reports legacy "Analytic" enum). (2) §1 adds the seventh badge state "check-unavailable" (loud, never green); §7 documents it in DriftBadge; new §7b records the 403 finding, the probe-script protocol, and the recommended outcomes (deployment-prerequisite or project-level service-account credentialMapping — NOT per-user creds in the tracker). Outstanding: only 11.1 mapping-home confirm with Tim (Phase 2, not blocking).

IMPLEMENTING_AGENT (r4): Phase 1 badge now in ALL THREE surfaces — main QC Tracker list, Metrics task-status table, and detail-drawer header (shared App-level driftMap, one batched POST). Verified in-browser. Exact check-unavailable spec text for §7 left in GIT_LINKAGE_REPLY.md round 4.

SPEC_AGENT (r5): 11.1 refinements landed in §4. Three changes: (1) MUST-FIX storage gotcha — put_assignment_rules at app.py:882 silently drops non-{rules,savedAt,savedBy} keys; extend to read-modify-write before adding branch_overrides. (2) Bundle-name-prefix fallback dropped as default — verified UCB branches (dev/t_14_1_1, CSR, master, main) don't match it; pattern slot is now configurable + default-off until Tim names the convention. (3) Precedence locked: evidence-attachment branch → explicit override → derived pattern → none; override never overrides evidence. Still awaiting git_probe_results.json (no change from r4-ack).

WORKSPACE_AGENT: PROBE COMPLETE ✓ — git/branches → 200 inside Domino. Sidecar identity DOES carry upstream git creds. Drift goes live with no code change. Two schema findings: (1) branches response is paginated {data:{items:[{name}]}} — NOT {branches:[]}; fixed in app.py get_branch_head + list_commits. (2) projectDefaultBranch returns null on this cluster — fixed with mainRepository.defaultRef.value fallback. Repo IDs for sce-coalition: project=6a209fea16b2d73bc1502007, repo=6a209fed16b2d73bc150200a. Branches confirmed: dev/t_14_1_1 + main.

DECISION — 11.1 RESOLVED & FINAL (brief author, for Phase 2): the branch-naming convention is FULLY CONFIGURABLE with working defaults — we do NOT depend on any customer (Tim/UCB) supplying their convention, and it varies per customer. No external input required to ship. Four binding constraints for whoever builds Phase 2:
  (a) MUST-FIX persistence: the current PUT /api/assignment-rules handler (app.py ~1138) hardcodes payload={rules,savedAt,savedBy} and DROPS any other top-level key — so a naive sibling key vanishes on the next rules save. Extend GET+PUT to round-trip the new config (read-modify-write), or add a dedicated route over the same file. Do NOT store it as an unpersisted sibling.
  (b) CANDIDATE-MATCHING, not a single guessed pattern. Generate a set of candidate branch names from the deliverable via CONFIGURABLE templates (tokens like {name}, {nameSlug}, {nameFirstToken}, {policyKey}) × configurable prefixes (e.g. "", "dev/", "feature/"), then match against the repo's ACTUAL branch list from git/branches. First real branch that matches wins. This tolerates convention variance (live data already spans dev/t_14_1_1, CSR, master, main) WITHOUT anyone telling us the rule. Ship sensible default templates+prefixes; expose them in the Configuration page per project/global.
  (c) Explicit per-deliverable override (branchName by bundleId) always wins over candidate-matching — for the exceptions defaults won't catch.
  (d) Precedence (binding): evidence-attachment branch (authoritative, already shipped) → explicit override → candidate-match against real branch list → none ("No branch"). Override/candidate-match apply ONLY when there is no evidence branch.

IMPLEMENTING_AGENT (r5): probe GREEN — 403 question CLOSED, git reads work on sce-coalition. Fixed app.py (commit 13c6840): (1) get_branch_head + list_commits parse {data:{items}} pagination; (2) found-check keys on branchName presence (items carry no commitId); (3) project_default_branch falls back to mainRepository.defaultRef.value (endpoint null here). Phase 1 fully live once redeployed w/ drift_enabled. Full round-5 writeup in GIT_LINKAGE_REPLY.md. → SPEC_AGENT ACTION: (a) retire/downgrade §7b creds-prerequisite (no longer needed); (b) correct §2/§3 schema — top-level key is data.items NOT branches/commits, branch items carry only {name}, HEAD comes from git/commits not branches; (c) note projectDefaultBranch unreliable, use mainRepository.defaultRef.value; (d) read git_probe_results.json for getCheckpointForCommitIds shape and lock §2 ProvenanceCheckpointDto fields.

NEXT ACTIONS (whoever picks up):
  - DEPLOY: redeploy app on sce-coalition with drift_enabled → badges go live. (Matt)
  - PHASE 2 GATE: fix put_assignment_rules (app.py ~882) to read-modify-write before adding branch_overrides + templates/prefixes config. Required before candidate-matching.
  - PHASE 3 GATE: getCheckpointForCommitIds schema (from git_probe_results.json) + §10b approval-binding (answered) before drift→Finding creation.

Last update: implementing agent r5 — probe green, app.py shape fixes pushed, round-5 handoff written for spec agent.
