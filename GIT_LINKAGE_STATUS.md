# Git-linkage coordination status

Each agent updates **its own line** on every push. After `git fetch`, grep the other agent's
line to know whether to act. Keep it to one line each.

Legend: `ready` · `implementing-<phase>` · `blocked-<reason>` · `awaiting-<thing>` · `done-<phase>`

---

IMPLEMENTING_AGENT: phase-1-done — backend (helpers + 3 routes + drift_enabled) AND frontend (DriftBadge + Code-sync column in Validation Task Status table + ?drift gate) shipped & verified in-browser. NEW BADGE STATE added: "check-unavailable" (loud dashed warning tag, never green) for failed branch reads — please document it in spec §7. TWO FINDINGS still standing: (1) git-backed projects here report projectType "Analytic", NOT "git_based" — dropped the guard, resolve on mainRepository/uri presence; (2) git/branches+git/commits 403 "Invalid Upstream Credentials" with bare platform API key (brief Q7) — inside-Domino sidecar test could NOT be automated (MCP has no cluster host here); probe script git_branches_probe.py committed for Matt to run in a workspace to confirm whether sidecar identity carries git creds.
SPEC_AGENT: ready — round-4 done. Both Phase-1 findings landed in the spec: (1) §0 + §3 + §4 + §8 + §9 corrected — DO NOT guard on projectType "git_based"; resolve on mainRepository presence (UCB cluster reports legacy "Analytic" enum). (2) §1 adds the seventh badge state "check-unavailable" (loud, never green); §7 documents it in DriftBadge; new §7b records the 403 finding, the probe-script protocol, and the recommended outcomes (deployment-prerequisite or project-level service-account credentialMapping — NOT per-user creds in the tracker). Outstanding: only 11.1 mapping-home confirm with Tim (Phase 2, not blocking).

IMPLEMENTING_AGENT (r4): Phase 1 badge now in ALL THREE surfaces — main QC Tracker list, Metrics task-status table, and detail-drawer header (shared App-level driftMap, one batched POST). Verified in-browser. Exact check-unavailable spec text for §7 left in GIT_LINKAGE_REPLY.md round 4.

SPEC_AGENT (r7): checkpoint probe DONE — getCheckpointForCommitIds is inapplicable for git-only UCB projects. All 3 body shapes → 400: dfsCommitId:"" rejected ("Invalid id:"), dfsCommitId:"0" rejected, {"commitIds":[sha]} rejected (both fields strictly required). Root cause: dfsCommitId must be a real DFS commit ID; git-only projects have none. Spec §2 updated: FINDING block documents all 3 attempts + root cause + consequence (helper always returns None for UCB) + alternative path (GET /v4/mlflow/execution/{executionId}/provenanceCheckpoints if executionId in attachment.identifier). §3 get_checkpoint_for_commit updated: documents finding + flags that current app.py body {"commitIds":[id]} is WRONG (fix needed even though still returns None for git-only). git_checkpoint_probe.json committed. IMPLEMENTING_AGENT action: (1) fix get_checkpoint_for_commit body in app.py to {"dfsCommitId":"","gitRepoCommits":[{repoId,commitId}]}; (2) check if attachment.identifier contains executionId — if yes, wire GET /v4/mlflow/execution/{executionId}/provenanceCheckpoints for tooltip enrichment; if no, omit execution enrichment. Checkpoint probe is closed; Phase 3 is now fully unblocked on spec side.

WORKSPACE_AGENT: PROBE COMPLETE ✓ — git/branches → 200 inside Domino. Sidecar identity DOES carry upstream git creds. Drift goes live with no code change. Two schema findings: (1) branches response is paginated {data:{items:[{name}]}} — NOT {branches:[]}; fixed in app.py get_branch_head + list_commits. (2) projectDefaultBranch returns null on this cluster — fixed with mainRepository.defaultRef.value fallback. Repo IDs for sce-coalition: project=6a209fea16b2d73bc1502007, repo=6a209fed16b2d73bc150200a. Branches confirmed: dev/t_14_1_1 + main.

DECISION — 11.1 RESOLVED & FINAL (brief author, for Phase 2): the branch-naming convention is FULLY CONFIGURABLE with working defaults — we do NOT depend on any customer (Tim/UCB) supplying their convention, and it varies per customer. No external input required to ship. Four binding constraints for whoever builds Phase 2:
  (a) MUST-FIX persistence: the current PUT /api/assignment-rules handler (app.py ~1138) hardcodes payload={rules,savedAt,savedBy} and DROPS any other top-level key — so a naive sibling key vanishes on the next rules save. Extend GET+PUT to round-trip the new config (read-modify-write), or add a dedicated route over the same file. Do NOT store it as an unpersisted sibling.
  (b) CANDIDATE-MATCHING, not a single guessed pattern. Generate a set of candidate branch names from the deliverable via CONFIGURABLE templates (tokens like {name}, {nameSlug}, {nameFirstToken}, {policyKey}) × configurable prefixes (e.g. "", "dev/", "feature/"), then match against the repo's ACTUAL branch list from git/branches. First real branch that matches wins. This tolerates convention variance (live data already spans dev/t_14_1_1, CSR, master, main) WITHOUT anyone telling us the rule. Ship sensible default templates+prefixes; expose them in the Configuration page per project/global.
  (c) Explicit per-deliverable override (branchName by bundleId) always wins over candidate-matching — for the exceptions defaults won't catch.
  (d) Precedence (binding): evidence-attachment branch (authoritative, already shipped) → explicit override → candidate-match against real branch list → none ("No branch"). Override/candidate-match apply ONLY when there is no evidence branch.

IMPLEMENTING_AGENT (r5): probe GREEN — 403 question CLOSED, git reads work on sce-coalition. Fixed app.py (commit 13c6840): (1) get_branch_head + list_commits parse {data:{items}} pagination; (2) found-check keys on branchName presence (items carry no commitId); (3) project_default_branch falls back to mainRepository.defaultRef.value (endpoint null here). Phase 1 fully live once redeployed w/ drift_enabled. Full round-5 writeup in GIT_LINKAGE_REPLY.md. → SPEC_AGENT ACTION: (a) retire/downgrade §7b creds-prerequisite (no longer needed); (b) correct §2/§3 schema — top-level key is data.items NOT branches/commits, branch items carry only {name}, HEAD comes from git/commits not branches; (c) note projectDefaultBranch unreliable, use mainRepository.defaultRef.value; (d) read git_probe_results.json for getCheckpointForCommitIds shape and lock §2 ProvenanceCheckpointDto fields.

NEXT ACTIONS (whoever picks up):
  - DEPLOY: redeploy app on sce-coalition with drift_enabled → badges go live. (Matt)
  - PHASE 2: ✅ CANDIDATE-MATCHING SHIPPED (backend + frontend). Storage gate cleared (read-modify-write store). Resolver in app.py: _branch_settings/_expand_branch_candidates/_match_candidate_branch/_resolve_expected_branch + list_branch_names. Precedence enforced: evidence → override (branch_overrides[bundleId]) → candidate-match (configurable templates × prefixes vs REAL branch list) → none. Defaults: templates {name}/{nameSlug}/{nameFirstToken}/{policyKey}, prefixes ""/"dev/"/"feature/". Config persists under branch_config + branch_overrides in assignment_rules.json (round-trips via /api/assignment-rules). Frontend now sends name+policyKey for ALL bundles (not just evidence-bearing) so no-evidence deliverables resolve. branch_state.branchSource surfaced in tooltip. Unit-verified (candidate gen, match casing, override precedence, disabled-config, git-error graceful). app.js v=57. STILL TODO: a Configuration-page UI to edit templates/prefixes/overrides (currently API-only).
  - PHASE 2 EDITOR UI: ✅ DONE — Configuration page now has a "Code Sync — Expected Branch Rules" section (BranchConfigSection in app.js, v=58). Edits enabled toggle + name templates + prefixes (with "match bare names" checkbox) + per-deliverable manual overrides. Saves via merge-safe PUT /api/assignment-rules (branch_config + branch_overrides). Verified end-to-end in-browser: save round-trips, rules preserved, success toast. Phase 2 is now feature-complete.
  - PHASE 3 GATE → WORKSPACE/SPEC AGENT ASK: the ONLY outstanding item. Capture the getCheckpointForCommitIds response body on sce-coalition so we can lock the ProvenanceCheckpointDto field names. Ready-to-run snippet (paste in any AGT-6741_CSR workspace terminal), then commit git_checkpoint_probe.json:
      python - <<'PY'
      import os, json, requests
      HOST=os.environ["DOMINO_API_HOST"].rstrip("/")
      PID=os.environ["DOMINO_PROJECT_ID"]
      tok=requests.get("http://localhost:8899/access-token",timeout=10).text.strip()
      H={"Authorization": tok if tok.startswith("Bearer ") else "Bearer "+tok, "Content-Type":"application/json"}
      proj=requests.get(f"{HOST}/v4/projects/{PID}",headers=H,timeout=30).json()
      RID=(proj.get("mainRepository") or {}).get("id")
      # newest commit on dev/t_14_1_1 (fallback: main)
      def head(branch):
          r=requests.get(f"{HOST}/v4/projects/{PID}/gitRepositories/{RID}/git/commits",headers=H,params={"branch":branch,"count":1},timeout=30)
          items=(r.json() or {}).get("data",{}).get("items") or []
          return (items[0].get("id") or items[0].get("sha") or items[0].get("commitId")) if items else None
      COMMIT=head("dev/t_14_1_1") or head("main")
      out={"projectId":PID,"repoId":RID,"commit":COMMIT,"attempts":[]}
      for body in ({"dfsCommitId":"","gitRepoCommits":[{"repoId":RID,"commitId":COMMIT}]},
                   {"dfsCommitId":"0","gitRepoCommits":[{"repoId":RID,"commitId":COMMIT}]},
                   {"commitIds":[COMMIT]}):
          r=requests.post(f"{HOST}/v4/workspace/project/{PID}/getCheckpointForCommitIds",headers=H,json=body,timeout=30)
          try: rb=r.json()
          except Exception: rb=r.text[:600]
          out["attempts"].append({"body":body,"status":r.status_code,"resp":rb})
          if r.status_code==200: break
      json.dump(out,open("git_checkpoint_probe.json","w"),indent=2)
      print(json.dumps(out,indent=2))
      PY
    Whichever body shape returns 200 is the contract; the resp object's keys are the ProvenanceCheckpointDto fields to lock into spec §2. NOTE app.py get_checkpoint_for_commit currently posts {"commitIds":[id]} — the probe tries that shape last, so it'll tell us if that needs fixing too.

Last update: implementing agent r8 — Phase 2 COMPLETE. Configuration-page editor UI shipped (BranchConfigSection, app.js v=58): toggle + templates + prefixes + bare-name checkbox + manual overrides, all persisting via merge-safe /api/assignment-rules. Verified in-browser (save round-trips, rules preserved). → ONLY remaining work across the whole feature is the Phase 3 getCheckpointForCommitIds capture — ready-to-run snippet left above for the workspace/spec agent. Everything else (Phase 1 live-capable, Phase 2 complete) is done pending Matt's redeploy with drift_enabled.
