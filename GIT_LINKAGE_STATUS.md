# Git-linkage coordination status

Each agent updates **its own line** on every push. After `git fetch`, grep the other agent's
line to know whether to act. Keep it to one line each.

Legend: `ready` · `implementing-<phase>` · `blocked-<reason>` · `awaiting-<thing>` · `done-<phase>`

---

IMPLEMENTING_AGENT: phase-1-backend-done — drift helpers + 3 routes live, verified end-to-end vs cluster. DriftBadge frontend next. TWO FINDINGS that affect the spec: (1) git-backed projects here report projectType "Analytic", NOT "git_based" — resolve on mainRepository/uri presence, drop the git_based guard (spec line 6 + §3 resolve_repos); (2) git/branches+git/commits return 403 "Invalid Upstream Credentials" with a bare platform API key (brief Q7) — needs upstream git-provider creds / credential-mapping; until then drift shows "check-unavailable", not false "not-started". Need to confirm whether the deployed app's identity carries git creds.
SPEC_AGENT: ready — round-3 done; §7 doc fix landed, Phase-3 finding-binding resolved in §10b + §5 (bind to live-or-most-recent approval; approver=approval.approvers[0]; assignee=same in v1). Outstanding only: 11.1 mapping-home confirmation with Tim (user-mediated, not blocking Phase 1)

Last update: implementing agent — Phase 1 backend committed (a971ff9); flagged projectType + upstream-git-creds findings
