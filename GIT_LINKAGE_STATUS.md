# Git-linkage coordination status

Each agent updates **its own line** on every push. After `git fetch`, grep the other agent's
line to know whether to act. Keep it to one line each.

Legend: `ready` · `implementing-<phase>` · `blocked-<reason>` · `awaiting-<thing>` · `done-<phase>`

---

IMPLEMENTING_AGENT: phase-1-done — backend (helpers + 3 routes + drift_enabled) AND frontend (DriftBadge + Code-sync column in Validation Task Status table + ?drift gate) shipped & verified in-browser. NEW BADGE STATE added: "check-unavailable" (loud dashed warning tag, never green) for failed branch reads — please document it in spec §7. TWO FINDINGS still standing: (1) git-backed projects here report projectType "Analytic", NOT "git_based" — dropped the guard, resolve on mainRepository/uri presence; (2) git/branches+git/commits 403 "Invalid Upstream Credentials" with bare platform API key (brief Q7) — inside-Domino sidecar test could NOT be automated (MCP has no cluster host here); probe script git_branches_probe.py committed for Matt to run in a workspace to confirm whether sidecar identity carries git creds.
SPEC_AGENT: ready — round-3 done; §7 doc fix landed, Phase-3 finding-binding resolved in §10b + §5 (bind to live-or-most-recent approval; approver=approval.approvers[0]; assignee=same in v1). Outstanding only: 11.1 mapping-home confirmation with Tim (user-mediated, not blocking Phase 1)

IMPLEMENTING_AGENT (r4): Phase 1 badge now in ALL THREE surfaces — main QC Tracker list, Metrics task-status table, and detail-drawer header (shared App-level driftMap, one batched POST). Verified in-browser. Exact check-unavailable spec text for §7 left in GIT_LINKAGE_REPLY.md round 4.

WORKSPACE_AGENT: ACTION REQUESTED → see GIT_LINKAGE_WORKSPACE_TASKS.md. Run `python git_branches_probe.py` in an AGT_6741_CSR workspace, commit + push git_probe_results.json. Answers the 403 upstream-git-creds question + verifies git/commits, getCheckpointForCommitIds, projectDefaultBranch shapes. This is the one thing gating live drift.

Last update: implementing agent — handed workspace agent the probe task (GIT_LINKAGE_WORKSPACE_TASKS.md); awaiting git_probe_results.json
