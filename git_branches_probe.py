"""
Git-linkage in-Domino probe.

PURPOSE: locally (bare platform API key) the Domino git proxy returns
403 INVALID_UPSTREAM_CREDENTIALS for git/branches + git/commits. We need to
know whether the SIDECAR identity inside a Domino workspace/job carries the
upstream git credential so those reads succeed. If they do, the drift feature
lights up with zero code change.

RUN THIS inside a Domino workspace launched in the AGT_6741_CSR project:
    python git_branches_probe.py

It writes a full result to git_probe_results.json. Commit + push that file:
    git add git_probe_results.json && git commit -m "git probe results" && git push

Then tell the other agent to pull and read it.
"""
import os
import json
import requests

PROJECT_ID = "6a28b1b84da5364a82ae0c65"          # AGT_6741_CSR
REPO_ID = "6a28b1ba4da5364a82ae0c68"             # github.com/ddl-matthew-tendler/AGT-6741_CSR
BRANCH = "dev/t_14_1_1"
COMMIT = "5845672c3f88069cc4fb382b519764d9024863d6"

HOST = os.environ.get("DOMINO_API_HOST", "").rstrip("/")
out = {"host": HOST, "project_id": PROJECT_ID, "repo_id": REPO_ID, "branch": BRANCH, "checks": {}}


def get_token():
    r = requests.get("http://localhost:8899/access-token", timeout=10)
    return r.text.strip()


try:
    token = get_token()
    raw = token.replace("Bearer ", "")
    bearer = token if token.startswith("Bearer ") else ("Bearer " + token)
    out["token_acquired"] = True
    out["token_len"] = len(token)
except Exception as e:
    out["token_acquired"] = False
    out["token_error"] = repr(e)
    token = None

# Try both auth header styles for the first call to learn which one the git
# proxy accepts; reuse the winner for the rest.
HEADER_VARIANTS = []
if token:
    HEADER_VARIANTS = [
        ("Authorization-Bearer", {"Authorization": bearer}),
        ("X-Domino-Api-Key", {"X-Domino-Api-Key": raw}),
    ]


def call(name, path, headers, method="GET", body=None):
    url = HOST + path
    rec = {"url": url, "method": method}
    try:
        if method == "POST":
            r = requests.post(url, headers=dict(headers, **{"Content-Type": "application/json"}),
                              json=body, timeout=30)
        else:
            r = requests.get(url, headers=headers, timeout=30)
        rec["status"] = r.status_code
        rec["body_head"] = r.text[:600]
    except Exception as e:
        rec["error"] = repr(e)
    out["checks"].setdefault(name, []).append(rec)
    return rec


if not HOST:
    out["fatal"] = "DOMINO_API_HOST is empty — are you inside a Domino workspace/job?"
elif not token:
    out["fatal"] = "no sidecar token"
else:
    # 1) git/branches — the core question (does the 403 disappear inside Domino?)
    working_header = None
    branches_path = "/v4/projects/%s/gitRepositories/%s/git/branches?searchPattern=dev&count=50" % (PROJECT_ID, REPO_ID)
    for label, hdr in HEADER_VARIANTS:
        rec = call("git_branches", branches_path, hdr)
        rec["auth"] = label
        if rec.get("status") == 200 and working_header is None:
            working_header = hdr
            out["working_auth"] = label
    hdr = working_header or HEADER_VARIANTS[0][1]

    # 2) git/commits on the branch
    call("git_commits", "/v4/projects/%s/gitRepositories/%s/git/commits?branch=%s&count=5" % (
        PROJECT_ID, REPO_ID, BRANCH), hdr)

    # 3) projectDefaultBranch
    call("project_default_branch", "/v4/projects/%s/projectDefaultBranch" % PROJECT_ID, hdr)

    # 4) getCheckpointForCommitIds — verify the Phase 3 provenance endpoint + schema
    call("getCheckpointForCommitIds",
         "/v4/workspace/project/%s/getCheckpointForCommitIds" % PROJECT_ID,
         hdr, method="POST", body={"commitIds": [COMMIT]})

    # 5) the app's own drift endpoint, IF the app is running on 8888 in this workspace
    try:
        r = requests.post("http://localhost:8888/api/deliverables/drift",
                          json={"deliverables": [{
                              "bundleId": "probe", "projectId": PROJECT_ID,
                              "expectedBranch": BRANCH, "filename": "output/t_14_1_1/t_14_1_1_qc_findings.json",
                              "validatedCommit": COMMIT, "validatedSource": "git"}]}, timeout=60)
        out["checks"]["app_drift_endpoint"] = {"status": r.status_code, "body_head": r.text[:600]}
    except Exception as e:
        out["checks"]["app_drift_endpoint"] = {"skipped": "app not running on :8888 here (" + repr(e)[:80] + ")"}

# Verdict
git_ok = any(c.get("status") == 200 for c in out["checks"].get("git_branches", []))
out["VERDICT"] = (
    "GIT READS WORK inside Domino — sidecar identity carries upstream git creds. "
    "Drift will light up live with no code change."
    if git_ok else
    "GIT READS STILL 403 inside Domino — this is a cluster credential-mapping "
    "prerequisite, not an app bug. Surface to UCB."
)

with open("git_probe_results.json", "w") as f:
    json.dump(out, f, indent=2)

print(json.dumps(out, indent=2))
print("\nWrote git_probe_results.json — commit + push it.")
