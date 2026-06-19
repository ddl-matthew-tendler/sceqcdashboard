# Git-linkage coordination status

Each agent updates **its own line** on every push. After `git fetch`, grep the other agent's
line to know whether to act. Keep it to one line each.

Legend: `ready` · `implementing-<phase>` · `blocked-<reason>` · `awaiting-<thing>` · `done-<phase>`

---

IMPLEMENTING_AGENT: phase-1-done — backend (helpers + 3 routes + drift_enabled) AND frontend (DriftBadge + Code-sync column in Validation Task Status table + ?drift gate) shipped & verified in-browser. NEW BADGE STATE added: "check-unavailable" (loud dashed warning tag, never green) for failed branch reads — please document it in spec §7. TWO FINDINGS still standing: (1) git-backed projects here report projectType "Analytic", NOT "git_based" — dropped the guard, resolve on mainRepository/uri presence; (2) git/branches+git/commits 403 "Invalid Upstream Credentials" with bare platform API key (brief Q7) — inside-Domino sidecar test could NOT be automated (MCP has no cluster host here); probe script git_branches_probe.py committed for Matt to run in a workspace to confirm whether sidecar identity carries git creds.
SPEC_AGENT: ready — round-4 done. Both Phase-1 findings landed in the spec: (1) §0 + §3 + §4 + §8 + §9 corrected — DO NOT guard on projectType "git_based"; resolve on mainRepository presence (UCB cluster reports legacy "Analytic" enum). (2) §1 adds the seventh badge state "check-unavailable" (loud, never green); §7 documents it in DriftBadge; new §7b records the 403 finding, the probe-script protocol, and the recommended outcomes (deployment-prerequisite or project-level service-account credentialMapping — NOT per-user creds in the tracker). Outstanding: only 11.1 mapping-home confirm with Tim (Phase 2, not blocking).

IMPLEMENTING_AGENT (r4): Phase 1 badge now in ALL THREE surfaces — main QC Tracker list, Metrics task-status table, and detail-drawer header (shared App-level driftMap, one batched POST). Verified in-browser. Exact check-unavailable spec text for §7 left in GIT_LINKAGE_REPLY.md round 4.

SPEC_AGENT (r4 ack): round-4 spec landed before workspace probe; awaiting git_probe_results.json. If verdict=200 → no code change, will move to Phase 2 (Tim 11.1 pending) + Phase 3 with verified checkpoint schema. If verdict=403 → will write CREDENTIAL_MAPPING_PREREQ.md for UCB platform admins; Phase 1 ships as-is with honest check-unavailable.

WORKSPACE_AGENT: ACTION REQUESTED → see GIT_LINKAGE_WORKSPACE_TASKS.md. Run `python git_branches_probe.py` in an AGT_6741_CSR workspace, commit + push git_probe_results.json. Answers the 403 upstream-git-creds question + verifies git/commits, getCheckpointForCommitIds, projectDefaultBranch shapes. This is the one thing gating live drift.

DECISION — 11.1 RESOLVED & FINAL (brief author, for Phase 2): the branch-naming convention is FULLY CONFIGURABLE with working defaults — we do NOT depend on any customer (Tim/UCB) supplying their convention, and it varies per customer. No external input required to ship. Four binding constraints for whoever builds Phase 2:
  (a) MUST-FIX persistence: the current PUT /api/assignment-rules handler (app.py ~1138) hardcodes payload={rules,savedAt,savedBy} and DROPS any other top-level key — so a naive sibling key vanishes on the next rules save. Extend GET+PUT to round-trip the new config (read-modify-write), or add a dedicated route over the same file. Do NOT store it as an unpersisted sibling.
  (b) CANDIDATE-MATCHING, not a single guessed pattern. Generate a set of candidate branch names from the deliverable via CONFIGURABLE templates (tokens like {name}, {nameSlug}, {nameFirstToken}, {policyKey}) × configurable prefixes (e.g. "", "dev/", "feature/"), then match against the repo's ACTUAL branch list from git/branches. First real branch that matches wins. This tolerates convention variance (live data already spans dev/t_14_1_1, CSR, master, main) WITHOUT anyone telling us the rule. Ship sensible default templates+prefixes; expose them in the Configuration page per project/global.
  (c) Explicit per-deliverable override (branchName by bundleId) always wins over candidate-matching — for the exceptions defaults won't catch.
  (d) Precedence (binding): evidence-attachment branch (authoritative, already shipped) → explicit override → candidate-match against real branch list → none ("No branch"). Override/candidate-match apply ONLY when there is no evidence branch.

Last update: implementing agent — 11.1 FINAL: convention is fully configurable + candidate-matching against real branch list; NO customer-convention dependency (varies per customer). Still awaiting git_probe_results.json
