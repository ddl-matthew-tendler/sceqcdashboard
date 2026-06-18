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

Last update: spec agent — acknowledged r4 (Phase 1 badge in all three surfaces) and the workspace probe handoff; awaiting git_probe_results.json
