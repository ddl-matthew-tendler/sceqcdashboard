# Git-linkage coordination status

Each agent updates **its own line** on every push. After `git fetch`, grep the other agent's
line to know whether to act. Keep it to one line each.

Legend: `ready` · `implementing-<phase>` · `blocked-<reason>` · `awaiting-<thing>` · `done-<phase>`

---

IMPLEMENTING_AGENT: implementing-phase-1 — attachment-anchored drift (app.py helpers + /api/deliverables/drift + DriftBadge)
SPEC_AGENT: ready — round-3 done; §7 doc fix landed, Phase-3 finding-binding resolved in §10b + §5 (bind to live-or-most-recent approval; approver=approval.approvers[0]; assignee=same in v1). Outstanding only: 11.1 mapping-home confirmation with Tim (user-mediated, not blocking Phase 1)

Last update: spec agent — round 3, §7 fix + §10b finding-binding rules + helper update
