import os
import io
import json
import logging
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware
from reportlab.lib import colors
from reportlab.lib.pagesizes import landscape, A3
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table as RLTable, TableStyle, Paragraph, Spacer, HRFlowable, KeepTogether
from reportlab.lib.enums import TA_LEFT, TA_CENTER

load_dotenv()

app = FastAPI()
logger = logging.getLogger("app")
logging.basicConfig(level=logging.INFO)

# Capture the external hostname from incoming browser requests.
# Inside Domino, the nginx proxy sets X-Forwarded-Host with the real hostname.
_external_host_cache = {"host": None}


@app.middleware("http")
async def capture_external_host(request: Request, call_next):
    if not _external_host_cache["host"]:
        fwd = request.headers.get("x-forwarded-host") or request.headers.get("host")
        if fwd and "domino" in fwd.lower() or (fwd and "." in fwd and "localhost" not in fwd):
            scheme = request.headers.get("x-forwarded-proto", "https")
            _external_host_cache["host"] = f"{scheme}://{fwd}"
            logger.info(f"Captured external host: {_external_host_cache['host']}")
    return await call_next(request)


def get_domino_host():
    host = os.environ.get("DOMINO_API_HOST", "")
    return host.rstrip("/")


# Governance API may live on a different internal service than DOMINO_API_HOST.
# nucleus-frontend doesn't serve /api/governance/v1/* inside the cluster.
# We probe candidate hosts on first call and cache the working one.
_gov_host_cache = {"host": None, "probed": False}


def _get_gov_host_candidates():
    """Return list of (label, base_url) candidates for governance API."""
    primary = get_domino_host()
    candidates = []
    if primary:
        candidates.append(("DOMINO_API_HOST", primary))

    # DOMINO_API_PROXY may route to all APIs including governance
    proxy = os.environ.get("DOMINO_API_PROXY", "").rstrip("/")
    if proxy and proxy != primary:
        candidates.append(("DOMINO_API_PROXY", proxy))

    # DOMINO_USER_HOST may be the external-facing URL
    user_host = os.environ.get("DOMINO_USER_HOST", "").rstrip("/")
    if user_host:
        # Ensure it has a scheme
        if not user_host.startswith("http"):
            user_host = "https://" + user_host
        if user_host != primary:
            candidates.append(("DOMINO_USER_HOST", user_host))

    # External hostname captured from browser requests (goes through ingress which routes governance)
    ext_host = (_external_host_cache.get("host") or "").rstrip("/")
    if ext_host and ext_host != primary:
        candidates.append(("external_host", ext_host))

    # Common internal Kubernetes service names for governance
    for svc in [
        "http://governance-service.domino-platform:80",
        "http://governance-svc.domino-platform:80",
    ]:
        if svc.rstrip("/") != primary:
            candidates.append(("k8s:" + svc.split("//")[1].split(".")[0], svc))

    return candidates


def _get_gov_host():
    """Return the working governance API host, probing if needed."""
    # Re-probe if we failed before but now have the external host
    if _gov_host_cache["probed"] and _gov_host_cache["host"] is None:
        if _external_host_cache.get("host") and not _gov_host_cache.get("tried_external"):
            logger.info("Re-probing governance host with newly captured external host")
            _gov_host_cache["probed"] = False

    if _gov_host_cache["probed"]:
        return _gov_host_cache["host"]

    # Get auth for probing
    api_key = _get_api_key()
    if not api_key:
        token = _get_sidecar_token()
        if token:
            api_key = token  # Use sidecar token as API key for probe

    if not api_key:
        _gov_host_cache["probed"] = True
        return None

    candidates = _get_gov_host_candidates()
    for label, base_url in candidates:
        try:
            test_url = f"{base_url}/api/governance/v1/bundles?limit=1"
            r = requests.get(test_url, headers={"X-Domino-Api-Key": api_key}, timeout=10)
            if r.status_code == 200:
                logger.info(f"Governance host probe: {label} ({base_url}) WORKS")
                _gov_host_cache["host"] = base_url
                _gov_host_cache["probed"] = True
                return base_url
            else:
                logger.info(f"Governance host probe: {label} ({base_url}) → {r.status_code}")
        except Exception as e:
            logger.info(f"Governance host probe: {label} ({base_url}) → ERROR: {e}")

    # No candidate worked — fall back to primary
    logger.warning("Governance host probe: no candidate worked, falling back to DOMINO_API_HOST")
    _gov_host_cache["host"] = None
    _gov_host_cache["probed"] = True
    _gov_host_cache["tried_external"] = bool(_external_host_cache.get("host"))
    return None


def _get_api_key():
    """Return an API key if one is available (local dev or Domino env)."""
    return (
        os.environ.get("API_KEY_OVERRIDE")
        or os.environ.get("DOMINO_USER_API_KEY")
    )


def _get_sidecar_token():
    """Get token from Domino sidecar (inside Domino apps)."""
    try:
        response = requests.get("http://localhost:8899/access-token", timeout=5)
        token = response.text.strip()
        if token.startswith("Bearer "):
            token = token[len("Bearer "):]
        return token
    except Exception:
        return None


def get_auth_headers():
    """Auth headers for v4 endpoints — API key or Bearer token."""
    api_key = _get_api_key()
    if api_key:
        return {"X-Domino-Api-Key": api_key}
    token = _get_sidecar_token()
    if token:
        return {"Authorization": f"Bearer {token}"}
    raise HTTPException(status_code=503, detail="Cannot acquire auth token")


def gov_get(path, params=None):
    """GET governance endpoint, trying API key first, then Bearer, then API key with sidecar token."""
    gov_host = _get_gov_host() or get_domino_host()
    if not gov_host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    url = f"{gov_host}/api/governance/v1{path}"

    # Strategy 1: API key (works for local dev and if DOMINO_USER_API_KEY is set)
    api_key = _get_api_key()
    if api_key:
        resp = requests.get(url, headers={"X-Domino-Api-Key": api_key}, params=params, timeout=30)
        if resp.status_code == 200:
            return resp.json()
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    # No API key — get sidecar token and try multiple auth strategies
    token = _get_sidecar_token()
    if not token:
        raise HTTPException(status_code=503, detail="Cannot acquire auth token")

    logger.info(f"Governance auth for {path}: token length={len(token)}, starts_with={token[:10]}...")

    # Strategy 2: Send sidecar token as X-Domino-Api-Key (most likely to work for governance)
    resp = requests.get(url, headers={"X-Domino-Api-Key": token}, params=params, timeout=30)
    if resp.status_code == 200:
        logger.info("Governance auth: X-Domino-Api-Key with sidecar token worked")
        return resp.json()
    logger.warning(f"Governance strategy X-Domino-Api-Key failed: {resp.status_code} — {resp.text[:200]}")

    # Strategy 3: Bearer token (works for v4, may work on newer Domino for governance)
    resp2 = requests.get(url, headers={"Authorization": f"Bearer {token}"}, params=params, timeout=30)
    if resp2.status_code == 200:
        logger.info("Governance auth: Bearer token worked")
        return resp2.json()
    logger.warning(f"Governance strategy Bearer failed: {resp2.status_code} — {resp2.text[:200]}")

    # Strategy 4: Send both headers simultaneously
    resp3 = requests.get(url, headers={
        "Authorization": f"Bearer {token}",
        "X-Domino-Api-Key": token,
    }, params=params, timeout=30)
    if resp3.status_code == 200:
        logger.info("Governance auth: dual headers worked")
        return resp3.json()
    logger.warning(f"Governance strategy dual failed: {resp3.status_code} — {resp3.text[:200]}")

    # All strategies failed — return the most informative error
    logger.error(f"Governance auth FAILED for {path}. ApiKey: {resp.status_code}, Bearer: {resp2.status_code}, Dual: {resp3.status_code}")
    raise HTTPException(status_code=resp.status_code, detail=resp.text)


def gov_post(path, json_body=None):
    gov_host = _get_gov_host() or get_domino_host()
    if not gov_host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    url = f"{gov_host}/api/governance/v1{path}"

    api_key = _get_api_key()
    if api_key:
        headers = {"X-Domino-Api-Key": api_key, "Content-Type": "application/json"}
        resp = requests.post(url, headers=headers, json=json_body, timeout=30)
        if resp.status_code in (200, 201):
            return resp.json()
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    token = _get_sidecar_token()
    if not token:
        raise HTTPException(status_code=503, detail="Cannot acquire auth token")

    # Try X-Domino-Api-Key first (governance rejects Bearer), then Bearer, then both
    for headers in [
        {"X-Domino-Api-Key": token, "Content-Type": "application/json"},
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        {"Authorization": f"Bearer {token}", "X-Domino-Api-Key": token, "Content-Type": "application/json"},
    ]:
        resp = requests.post(url, headers=headers, json=json_body, timeout=30)
        if resp.status_code in (200, 201):
            return resp.json()

    raise HTTPException(status_code=resp.status_code, detail=resp.text)


def gov_patch(path, json_body=None):
    """PATCH governance endpoint (e.g. stage assignee updates)."""
    gov_host = _get_gov_host() or get_domino_host()
    if not gov_host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    url = f"{gov_host}/api/governance/v1{path}"

    api_key = _get_api_key()
    if api_key:
        headers = {"X-Domino-Api-Key": api_key, "Content-Type": "application/json"}
        resp = requests.patch(url, headers=headers, json=json_body, timeout=30)
        if resp.status_code == 200:
            return resp.json()
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    token = _get_sidecar_token()
    if not token:
        raise HTTPException(status_code=503, detail="Cannot acquire auth token")

    for headers in [
        {"X-Domino-Api-Key": token, "Content-Type": "application/json"},
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        {"Authorization": f"Bearer {token}", "X-Domino-Api-Key": token, "Content-Type": "application/json"},
    ]:
        resp = requests.patch(url, headers=headers, json=json_body, timeout=30)
        if resp.status_code == 200:
            return resp.json()

    raise HTTPException(status_code=resp.status_code, detail=resp.text)


def v4_get(path, params=None):
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    headers = get_auth_headers()
    url = f"{host}/v4{path}"
    resp = requests.get(url, headers=headers, params=params, timeout=30)
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


# ── Git-linkage helpers (Phase 1: attachment-anchored drift) ───────
# See GIT_LINKAGE_IMPLEMENTATION_SPEC.md. All reads go through v4_get.
# A small in-process TTL cache collapses repeated branch/commit lookups
# during one dashboard refresh — 218 deliverables fan out to far fewer
# distinct (project, repo, branch) tuples.
import time as _time
import threading as _threading

_ttl_store = {}
_ttl_lock = _threading.Lock()


def _ttl_cache(ttl_seconds=60):
    """Tiny positional-arg TTL memoizer. No cachetools dependency."""
    def deco(fn):
        def wrapped(*args):
            key = (fn.__name__, args)
            now = _time.monotonic()
            with _ttl_lock:
                hit = _ttl_store.get(key)
                if hit and (now - hit[0]) < ttl_seconds:
                    return hit[1]
            val = fn(*args)
            with _ttl_lock:
                _ttl_store[key] = (now, val)
            return val
        return wrapped
    return deco


def _commit_sha(c):
    if isinstance(c, str):
        return c
    if isinstance(c, dict):
        return c.get("id") or c.get("sha") or c.get("commitId")
    return None


@_ttl_cache(60)
def resolve_repos(project_id):
    """Return [{id,name,uri,serviceProvider,isMain}], deduped; [] for non-git
    or on error. Mirrors the repo-resolution landmine fix in /api/attachments/raw:
    the project's OWN repo is `mainRepository` on the project detail; the
    /gitRepositories endpoint only returns IMPORTED repos (often empty)."""
    try:
        proj = v4_get(f"/projects/{project_id}")
    except HTTPException as e:
        logger.warning(f"[git-linkage] project fetch failed {project_id}: {e.status_code}")
        return []
    # NOTE: do NOT guard on projectType == "git_based". On this cluster git-backed
    # projects report projectType "Analytic" yet carry a `mainRepository`. The real
    # signal is whether any repo with a URI resolves below; non-git projects simply
    # yield no repos and are skipped by the empty-list return.
    seen, out = set(), []

    def add(r, is_main):
        if isinstance(r, dict) and r.get("id") and r["id"] not in seen:
            seen.add(r["id"])
            out.append({"id": r["id"], "name": r.get("name"), "uri": r.get("uri"),
                        "serviceProvider": r.get("serviceProvider"), "isMain": is_main})

    add(proj.get("mainRepository"), True)
    for ir in (proj.get("importedGitRepositories") or []):
        add(ir, False)
    try:
        extra = v4_get(f"/projects/{project_id}/gitRepositories")
        for r in (extra if isinstance(extra, list) else []):
            add(r, False)
    except HTTPException:
        pass
    return out


@_ttl_cache(60)
def get_branch_head(project_id, repo_id, branch):
    """Returns one of:
      {'branchName','commitId'}  — branch found
      None                       — read OK, branch genuinely absent
      {'_error': msg}            — read failed (e.g. 403 upstream git creds);
                                    caller must NOT treat this as 'not-started'.
    searchPattern is substring in some Domino versions and a glob in others, so
    we match by exact name server-side rather than trusting the filter."""
    if not branch:
        return None
    try:
        res = v4_get(
            f"/projects/{project_id}/gitRepositories/{repo_id}/git/branches",
            params={"searchPattern": branch, "count": 100},
        )
    except HTTPException as e:
        return {"_error": f"git branches read failed ({e.status_code})"}
    # Response shape varies: flat list, {branches:[...]}, or paginated {data:{items:[...]}}.
    branches = (res if isinstance(res, list)
                else (res or {}).get("branches")
                     or (res or {}).get("data", {}).get("items")
                     or [])
    for b in (branches or []):
        name = b.get("name") or b.get("branchName")
        if name == branch:
            return {"branchName": name,
                    "commitId": b.get("commitId") or b.get("sha") or b.get("headCommitId")}
    return None


@_ttl_cache(60)
def list_branch_names(project_id, repo_id):
    """All branch names for a repo. Returns a list of names, or {'_error': msg}
    on a failed read. Used for Phase-2 candidate-matching, which only ever
    resolves to a branch that actually exists."""
    try:
        res = v4_get(
            f"/projects/{project_id}/gitRepositories/{repo_id}/git/branches",
            params={"count": 1000},
        )
    except HTTPException as e:
        return {"_error": f"git branches read failed ({e.status_code})"}
    branches = (res if isinstance(res, list)
                else (res or {}).get("branches")
                     or (res or {}).get("data", {}).get("items")
                     or [])
    names = []
    for b in (branches or []):
        n = (b.get("name") or b.get("branchName")) if isinstance(b, dict) else b
        if n:
            names.append(n)
    return names


@_ttl_cache(60)
def list_commits(project_id, repo_id, branch, count=200):
    """HEAD-first list of commit objects for a branch; [] on error/absent."""
    if not branch:
        return []
    try:
        res = v4_get(
            f"/projects/{project_id}/gitRepositories/{repo_id}/git/commits",
            params={"branch": branch, "count": count},
        )
    except HTTPException:
        return []
    items = (res if isinstance(res, list)
             else (res or {}).get("commits")
                  or (res or {}).get("data", {}).get("items")
                  or [])
    return items or []


@_ttl_cache(60)
def project_default_branch(project_id):
    try:
        ref = v4_get(f"/projects/{project_id}/projectDefaultBranch")
    except HTTPException:
        ref = None
    if isinstance(ref, str):
        return ref
    val = (ref or {}).get("value") or (ref or {}).get("name") or (ref or {}).get("branch")
    if val:
        return val
    # Fallback: mainRepository.defaultRef.value (endpoint returns null on some clusters)
    try:
        proj = v4_get(f"/projects/{project_id}")
        return (proj.get("mainRepository") or {}).get("defaultRef", {}).get("value")
    except HTTPException:
        return None


@_ttl_cache(60)
def get_checkpoint_for_commit(project_id, commit_id):
    """ProvenanceCheckpointDto or None. Companion enrichment only — never gates a
    badge, and nothing in the UI calls it today.

    CLOSURE (verified by sce-coalition probe, Jun 2026): this enrichment path is
    DEAD for git-only projects. getCheckpointForCommitIds strictly requires a real
    DFS (Domino File System) commit id — no sentinel ("" / "0") is accepted — and
    git-backed projects have no DFS commit, so the call returns nothing useful for
    UCB. The companion MLflow path is dead too: attachment identifiers carry only
    {branch, commit, filename, source}, no executionId. Kept here as a correctly-
    formed stub for DFS-based projects; harmless (returns None) for git-only ones.

    Verified path + body shape: POST /v4/workspace/project/{projectId}/getCheckpointForCommitIds
    with BOTH dfsCommitId and gitRepoCommits[] required."""
    if not commit_id:
        return None
    repos = resolve_repos(project_id)
    if not repos:
        return None
    repo = next((r for r in repos if r.get("isMain")), repos[0])
    try:
        return _v4_post(
            f"/workspace/project/{project_id}/getCheckpointForCommitIds",
            json_body={"dfsCommitId": "",
                       "gitRepoCommits": [{"repoId": repo["id"], "commitId": commit_id}]},
        )
    except HTTPException:
        return None


# ── Phase 2: expected-branch resolution (configurable candidate-matching) ──
#
# Precedence (binding, per STATUS 11.1):
#   evidence-attachment branch  → explicit override → candidate-match → none.
# We NEVER guess a branch that doesn't exist: candidates are matched against the
# repo's ACTUAL branch list, so a match is always a real branch.
_DEFAULT_BRANCH_CONFIG = {
    "enabled": True,
    # Tokens expanded per deliverable; see _expand_branch_candidates.
    "templates": ["{name}", "{nameSlug}", "{nameFirstToken}", "{policyKey}"],
    # Cartesian-multiplied with each template.
    "prefixes": ["", "dev/", "feature/"],
}


def _branch_settings():
    """(branch_config, branch_overrides) merged over defaults. Reads the same
    assignment_rules.json store the Configuration page persists to."""
    try:
        store = _read_assignment_store()
    except (OSError, json.JSONDecodeError):
        store = {}
    cfg = dict(_DEFAULT_BRANCH_CONFIG)
    user_cfg = store.get("branch_config")
    if isinstance(user_cfg, dict):
        cfg.update({k: v for k, v in user_cfg.items() if v is not None})
    overrides = store.get("branch_overrides")
    return cfg, (overrides if isinstance(overrides, dict) else {})


def _slug(s, sep="_"):
    """Lowercase, collapse any run of non-alphanumerics to `sep`, trim."""
    out, prev_sep = [], False
    for ch in str(s).lower():
        if ch.isalnum():
            out.append(ch); prev_sep = False
        elif not prev_sep:
            out.append(sep); prev_sep = True
    return "".join(out).strip(sep)


def _expand_branch_candidates(d, cfg):
    """Generate candidate branch names from a deliverable using configured
    templates × prefixes. Unknown tokens drop that template (no literal
    '{name}' leaks into a candidate)."""
    name = (d.get("name") or d.get("bundleName") or "").strip()
    policy_key = (d.get("policyKey") or d.get("policyName") or "").strip()
    first_token = ""
    if name:
        # Split on whitespace and common separators for the first meaningful token.
        for tok in name.replace("-", " ").replace("_", " ").replace("/", " ").split():
            first_token = tok; break
    tokens = {
        "{name}": name,
        "{nameSlug}": _slug(name) if name else "",
        "{nameFirstToken}": first_token,
        "{policyKey}": policy_key,
        "{policyKeySlug}": _slug(policy_key) if policy_key else "",
    }
    candidates = []
    seen = set()
    for tmpl in (cfg.get("templates") or []):
        body = tmpl
        skip = False
        for tok, val in tokens.items():
            if tok in body:
                if not val:
                    skip = True; break
                body = body.replace(tok, val)
        if skip or "{" in body:  # unfilled token → not a usable candidate
            continue
        for pre in (cfg.get("prefixes") or [""]):
            cand = f"{pre}{body}"
            if cand and cand not in seen:
                seen.add(cand); candidates.append(cand)
    return candidates


def _match_candidate_branch(candidates, real_names):
    """First candidate that matches a real branch (case-insensitive) wins;
    returns the REAL branch name (preserving its actual casing)."""
    lower_map = {n.lower(): n for n in real_names}
    for cand in candidates:
        hit = lower_map.get(cand.lower())
        if hit:
            return hit
    return None


def _resolve_expected_branch(d, project_id, repo_id, settings):
    """Returns (branch_name, source) where source ∈
    {'evidence','override','candidate-match', None}. Evidence wins and is
    handled by the caller (d['expectedBranch']); this fills in the rest."""
    cfg, overrides = settings
    bundle_id = d.get("bundleId")
    ov = overrides.get(bundle_id) if bundle_id else None
    if ov:
        return ov, "override"
    if not cfg.get("enabled", True):
        return None, None
    candidates = _expand_branch_candidates(d, cfg)
    if not candidates:
        return None, None
    names = list_branch_names(project_id, repo_id)
    if isinstance(names, dict):  # {_error}
        return None, None
    match = _match_candidate_branch(candidates, names)
    return (match, "candidate-match") if match else (None, None)


def _compute_drift(d, settings=None):
    """Compute the drift badge for one deliverable. Sequential within an item;
    the route fans these out across items. Badge vocabulary (frontend DriftBadge):
    no-validated-commit | not-started | in-development | in-sync |
    drift-other-files | drift-on-this-deliverable | drift | merged-ahead-of-validation | skipped."""
    bundle_id = d.get("bundleId")
    project_id = d.get("projectId")
    branch = d.get("expectedBranch") or None
    branch_source = "evidence" if branch else None
    filename = d.get("filename") or None
    validated_commit = d.get("validatedCommit") or None

    res = {"bundleId": bundle_id, "validated_at": None, "branch_state": None,
           "badge": "no-validated-commit", "badge_reason": ""}

    if not project_id:
        res["badge"] = "skipped"; res["badge_reason"] = "no projectId"
        return res
    repos = resolve_repos(project_id)
    if not repos:
        res["badge"] = "skipped"; res["badge_reason"] = "no git repo / non-git project"
        return res
    repo = next((r for r in repos if r.get("isMain")), repos[0])
    repo_id = repo["id"]

    # Phase 2: when there's no evidence-derived branch, fall back to an explicit
    # per-deliverable override, then candidate-matching against the real branch
    # list. Evidence always wins and is never overridden.
    if not branch:
        if settings is None:
            settings = _branch_settings()
        resolved, branch_source = _resolve_expected_branch(d, project_id, repo_id, settings)
        branch = resolved or None

    head = get_branch_head(project_id, repo_id, branch)
    git_error = head.get("_error") if isinstance(head, dict) and head.get("_error") else None
    found = isinstance(head, dict) and "branchName" in head
    head_commit = head.get("commitId") if found else None
    branch_exists = found
    branch_state = {"branchName": branch, "branchSource": branch_source,
                    "headCommit": head_commit, "exists": branch_exists,
                    "aheadOfValidated": None, "mergedToDefault": None,
                    "fileTouchedSinceValidated": None}
    res["branch_state"] = branch_state

    if validated_commit:
        res["validated_at"] = {"branch": branch, "commit": validated_commit,
                               "source": d.get("validatedSource"), "filename": filename}

    # Couldn't read the repo's branches — never imply 'not-started'/'in-sync'.
    if git_error:
        res["badge"] = "check-unavailable"; res["badge_reason"] = git_error
        return res

    # No validated anchor → dev-status only (Phase 2 territory; still useful).
    if not validated_commit:
        if not branch:
            res["badge"] = "no-validated-commit"; res["badge_reason"] = "no evidence and no expected branch"
        elif not branch_exists:
            res["badge"] = "not-started"; res["badge_reason"] = f"branch '{branch}' not found"
        else:
            res["badge"] = "in-development"; res["badge_reason"] = f"branch '{branch}' exists; no validated evidence yet"
        return res

    if not branch:
        res["badge"] = "skipped"; res["badge_reason"] = "validated evidence has no branch on its identifier"
        return res
    if not branch_exists:
        res["badge"] = "not-started"; res["badge_reason"] = f"branch '{branch}' not found"
        return res

    commits = list_commits(project_id, repo_id, branch, count=200)
    shas = [_commit_sha(c) for c in commits]
    ahead = shas.index(validated_commit) if validated_commit in shas else None
    branch_state["aheadOfValidated"] = ahead

    # File-level check: best-effort, no extra calls — only if commit objects
    # already carry changed-file lists. Otherwise leave unknown (None).
    file_touched = None
    if filename and ahead and ahead > 0:
        known, touched = False, False
        for c in commits[:ahead]:
            files = (c.get("changedFiles") or c.get("affectedPaths")
                     or c.get("files")) if isinstance(c, dict) else None
            if files is not None:
                known = True
                for f in files:
                    name = (f.get("path") or f.get("filename")) if isinstance(f, dict) else f
                    if name and (filename in str(name) or str(name) in filename):
                        touched = True
                        break
            if touched:
                break
        file_touched = touched if known else None
    branch_state["fileTouchedSinceValidated"] = file_touched

    default_branch = project_default_branch(project_id)
    merged = None
    if default_branch and default_branch != branch:
        dshas = [_commit_sha(c) for c in list_commits(project_id, repo_id, default_branch, count=500)]
        merged = (validated_commit in dshas) and (head_commit != validated_commit)
    branch_state["mergedToDefault"] = merged

    # Badge rules (§1), most-significant first.
    if head_commit and head_commit == validated_commit:
        res["badge"] = "in-sync"; res["badge_reason"] = "branch HEAD == validated commit"
    elif merged:
        res["badge"] = "merged-ahead-of-validation"
        res["badge_reason"] = "validated commit merged to default branch; HEAD has advanced"
    elif ahead and ahead > 0:
        if file_touched is True:
            res["badge"] = "drift-on-this-deliverable"
            res["badge_reason"] = f"{ahead} commit(s) ahead; {filename} changed since validation"
        elif file_touched is False:
            res["badge"] = "drift-other-files"
            res["badge_reason"] = f"{ahead} commit(s) ahead; {filename} unchanged"
        else:
            res["badge"] = "drift"
            res["badge_reason"] = f"{ahead} commit(s) ahead; file-level check unavailable"
    elif ahead is None:
        res["badge"] = "drift"; res["badge_reason"] = "validated commit not found in branch history"
    else:
        res["badge"] = "in-sync"; res["badge_reason"] = "at validated commit"
    return res


# ── Bundles (Studies) ──────────────────────────────────────────────

@app.get("/api/bundles")
def list_bundles(
    limit: int = 50,
    offset: int = 0,
    search: str = "",
    state: str = "",
):
    params = {"limit": limit, "offset": offset}
    if search:
        params["search"] = search
    if state:
        params["state"] = [state]
    result = gov_get("/bundles", params=params)
    # Debug: log assignee data shapes to diagnose "Unknown user" issues
    bundles = result.get("data", []) if isinstance(result, dict) else []
    for b in bundles[:5]:  # Sample first 5
        sa = b.get("stageAssignee")
        if sa and sa.get("id"):
            logger.info(
                f"[Assignee Debug] bundle={b.get('name', '?')} "
                f"stageAssignee keys={list(sa.keys())} "
                f"id={sa.get('id', '')[:12]}... name={sa.get('name', '<missing>')} "
                f"userName={sa.get('userName', '<missing>')}"
            )
    return result


@app.get("/api/bundles/{bundle_id}")
def get_bundle(bundle_id: str):
    return gov_get(f"/bundles/{bundle_id}")


@app.get("/api/bundles/{bundle_id}/approvals")
def get_bundle_approvals(bundle_id: str):
    return gov_get(f"/bundles/{bundle_id}/approvals")


@app.get("/api/bundles/{bundle_id}/findings")
def get_bundle_findings(bundle_id: str, limit: int = 100, offset: int = 0):
    params = {"limit": limit, "offset": offset}
    return gov_get(f"/bundles/{bundle_id}/findings", params=params)


@app.get("/api/bundles/{bundle_id}/gates")
def get_bundle_gates(bundle_id: str):
    return gov_get(f"/bundles/{bundle_id}/gates")


@app.post("/api/bundles/enrich")
def enrich_bundles(body: dict):
    """Bulk-fetch approvals + findings for many bundles in one request.

    The browser used to call /approvals and /findings once per bundle (2N
    round trips through the Domino proxy). This fans those calls out
    server-side with a thread pool and returns a
    {bundleId: {approvals: [...], findings: {...}}} map, collapsing a batch
    of N bundles into a single browser request. A failure on one bundle's
    call yields an empty result for that piece rather than failing the batch.
    """
    bundle_ids = body.get("bundleIds") or []
    findings_limit = int(body.get("findingsLimit") or 200)
    if not isinstance(bundle_ids, list) or not bundle_ids:
        return {}

    def fetch_approvals(bid):
        try:
            return bid, "approvals", gov_get(f"/bundles/{bid}/approvals")
        except Exception as e:
            logger.warning(f"enrich: approvals failed for {bid}: {e}")
            return bid, "approvals", []

    def fetch_findings(bid):
        try:
            return bid, "findings", gov_get(
                f"/bundles/{bid}/findings",
                params={"limit": findings_limit, "offset": 0},
            )
        except Exception as e:
            logger.warning(f"enrich: findings failed for {bid}: {e}")
            return bid, "findings", {"data": []}

    result = {bid: {"approvals": [], "findings": {"data": []}} for bid in bundle_ids}
    with ThreadPoolExecutor(max_workers=16) as ex:
        tasks = []
        for bid in bundle_ids:
            tasks.append(ex.submit(fetch_approvals, bid))
            tasks.append(ex.submit(fetch_findings, bid))
        for fut in as_completed(tasks):
            bid, kind, data = fut.result()
            result[bid][kind] = data
    return result


@app.get("/api/bundles/{bundle_id}/detail")
def get_bundle_detail(bundle_id: str):
    """
    Consolidated evidence view: merges bundle metadata, policy artifact
    structure, and submitted evidence values into one payload.

    Evidence values live in results[].artifactContent — results[].value
    is always null. submit-result-to-policy requires a valid evidenceId,
    so we pick the first one from the policy.
    """
    bundle = gov_get(f"/bundles/{bundle_id}")
    policy_id = bundle.get("policyId")
    if not policy_id:
        raise HTTPException(status_code=400, detail="Bundle has no policyId")

    policy = gov_get(f"/policies/{policy_id}")

    evidence_id = None
    for stage in policy.get("stages", []) or []:
        for ev_set in stage.get("evidenceSet", []) or []:
            if ev_set.get("id"):
                evidence_id = ev_set["id"]
                break
        if evidence_id:
            break
    if not evidence_id:
        for stage in policy.get("stages", []) or []:
            for approval in stage.get("approvals", []) or []:
                eid = (approval.get("evidence") or {}).get("id")
                if eid:
                    evidence_id = eid
                    break
            if evidence_id:
                break

    evidence_map = {}
    if evidence_id:
        try:
            ev_data = gov_post(
                "/rpc/submit-result-to-policy",
                json_body={
                    "bundleId": bundle_id,
                    "policyId": policy_id,
                    "evidenceId": evidence_id,
                    "content": {},
                },
            )
        except HTTPException as e:
            logger.warning(f"submit-result-to-policy probe failed for bundle {bundle_id}: {e.detail[:200] if isinstance(e.detail, str) else e.detail}")
            ev_data = {}

        for r in (ev_data.get("results") or []):
            art_id = r.get("artifactId")
            if not art_id:
                continue
            evidence_map[art_id] = {
                "value": r.get("artifactContent"),
                "submittedBy": (r.get("createdBy") or {}).get("userName"),
                "submittedAt": r.get("createdAt"),
            }
        for d in (ev_data.get("drafts") or []):
            art_id = d.get("artifactId")
            if not art_id:
                continue
            content = d.get("artifactContent") or {}
            evidence_map[art_id] = {
                "value": content,
                "jobId": content.get("jobId") if isinstance(content, dict) else None,
                "jobStatus": content.get("jobStatus") if isinstance(content, dict) else None,
                "parameters": content.get("parameters") if isinstance(content, dict) else None,
            }

    return {"bundle": bundle, "policy": policy, "evidenceMap": evidence_map}


# ── Evidence submission + scripted-check execution ──────────────

@app.post("/api/bundles/{bundle_id}/evidence")
def submit_bundle_evidence(bundle_id: str, body: dict):
    """
    Submit evidence values for one evidence set.
    Body: { evidenceId: str, content: { artifactId: value, ... } }
    Calls Domino's /rpc/submit-result-to-policy.
    """
    evidence_id = body.get("evidenceId")
    content = body.get("content") or {}
    if not evidence_id:
        raise HTTPException(status_code=400, detail="evidenceId is required")

    bundle = gov_get(f"/bundles/{bundle_id}")
    policy_id = bundle.get("policyId")
    if not policy_id:
        raise HTTPException(status_code=400, detail="Bundle has no policyId")

    return gov_post(
        "/rpc/submit-result-to-policy",
        json_body={
            "bundleId": bundle_id,
            "policyId": policy_id,
            "evidenceId": evidence_id,
            "content": content,
        },
    )


def _find_hw_tier_id(name, project_id):
    """Resolve hardware tier name → id via /v4/projects/{id}/hardwareTiers."""
    if not name or not project_id:
        return None
    try:
        tiers = v4_get(f"/projects/{project_id}/hardwareTiers")
        for t in (tiers or []):
            ht = t.get("hardwareTier") or t
            if (ht.get("name") or "").lower() == name.lower() or ht.get("id") == name:
                return ht.get("id")
    except Exception as e:
        logger.warning(f"hw tier lookup failed for '{name}': {e}")
    return None


def _find_environment_id(name, project_id):
    """Resolve environment name → id via /v4/environments?projectId=..."""
    if not name:
        return None
    try:
        envs = v4_get("/environments", params={"projectId": project_id} if project_id else None)
        items = envs.get("data") if isinstance(envs, dict) else envs
        for e in (items or []):
            if (e.get("name") or "").lower() == name.lower() or e.get("id") == name:
                return e.get("id")
    except Exception as e:
        logger.warning(f"environment lookup failed for '{name}': {e}")
    return None


def _v4_post(path, json_body=None):
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    headers = get_auth_headers()
    headers["Content-Type"] = "application/json"
    resp = requests.post(f"{host}/v4{path}", headers=headers, json=json_body, timeout=30)
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@app.post("/api/bundles/{bundle_id}/scripted-check/{artifact_id}")
def run_scripted_check(bundle_id: str, artifact_id: str, body: dict):
    """
    Execute a policyScriptedCheck artifact:
      1) look up the artifact in the policy → get command, environment, hwTier
      2) start a Domino job in the bundle's project
      3) write {jobId, parameters, jobStatus} back as evidence draft

    Body: { evidenceId: str, parameters: {name: value, ...} (optional, overrides defaults) }
    """
    evidence_id = body.get("evidenceId")
    user_params = body.get("parameters") or {}
    if not evidence_id:
        raise HTTPException(status_code=400, detail="evidenceId is required")

    bundle = gov_get(f"/bundles/{bundle_id}")
    policy_id = bundle.get("policyId")
    project_id = bundle.get("projectId")
    if not (policy_id and project_id):
        raise HTTPException(status_code=400, detail="Bundle missing policyId or projectId")

    policy = gov_get(f"/policies/{policy_id}")
    artifact = None
    for stage in (policy.get("stages") or []):
        for es in (stage.get("evidenceSet") or []):
            for a in (es.get("artifacts") or []):
                if a.get("id") == artifact_id:
                    artifact = a
                    break
            if artifact: break
        if artifact: break
    if not artifact:
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_id} not in policy")
    if artifact.get("artifactType") != "policyScriptedCheck":
        raise HTTPException(status_code=400, detail="Artifact is not a scripted check")

    details = artifact.get("details") or {}
    command = details.get("command")
    if not command:
        raise HTTPException(status_code=400, detail="Scripted check has no command")

    # Substitute parameters into command. Spec uses ${name} placeholders.
    declared_params = details.get("parameters") or []
    resolved = {}
    for p in declared_params:
        pname = p.get("name")
        if not pname: continue
        if pname in user_params:
            resolved[pname] = user_params[pname]
        elif p.get("default") is not None:
            resolved[pname] = p.get("default")
    final_command = command
    for k, v in resolved.items():
        final_command = final_command.replace("${" + k + "}", str(v))

    # Always expose the governance identifiers for substitution, even though
    # they are not declared parameters. This lets a policy's command template
    # pass the target bundle to the agent explicitly, e.g.:
    #     python scripts/qc_agent.py --bundle-id ${bundle_id} --tfl-name ...
    # so the script writes its result back to THIS bundle instead of guessing
    # by alias (which silently picks the wrong bundle when two share an alias).
    # If the template doesn't reference these, nothing changes.
    builtin_subs = {
        "bundle_id": bundle_id,
        "policy_id": policy_id,
        "project_id": project_id,
        "evidence_id": evidence_id,
    }
    for k, v in builtin_subs.items():
        final_command = final_command.replace("${" + k + "}", str(v))

    # Accept either name (resolve to ID) or direct ID/slug from policy YAML.
    env_id = details.get("environmentId") or _find_environment_id(details.get("environment"), project_id)
    hw_id  = details.get("hardwareTierId") or _find_hw_tier_id(details.get("hardwareTier"), project_id)

    job_req = {"projectId": project_id, "commandToRun": final_command}
    if env_id: job_req["environmentId"] = env_id
    if hw_id:  job_req["overrideHardwareTierId"] = hw_id

    try:
        job = _v4_post("/jobs/start", json_body=job_req)
    except HTTPException as e:
        logger.error(f"Job start failed for scripted check {artifact_id}: {e.detail}")
        raise

    job_id = job.get("id")

    # Persist as draft so the Evidence tab shows it on next refresh.
    try:
        gov_post(
            "/rpc/submit-result-to-policy",
            json_body={
                "bundleId": bundle_id,
                "policyId": policy_id,
                "evidenceId": evidence_id,
                "content": {
                    artifact_id: {
                        "jobId": job_id,
                        "jobStatus": (job.get("statuses") or {}).get("executionStatus") or "Queued",
                        "parameters": resolved,
                    }
                },
            },
        )
    except HTTPException as e:
        logger.warning(f"Saving jobId to evidence failed (job still started): {e.detail}")

    return {"jobId": job_id, "parameters": resolved, "command": final_command, "job": job}


@app.post("/api/bundles/{bundle_id}/transition")
def transition_bundle_stage(bundle_id: str, body: dict):
    """Advance the bundle to a different stage or change its overall state.

    Body: {stage: "name"} to move stages, OR {state: "Complete"} (or
    "Active" / "Archived") to change the bundle's overall lifecycle
    state. The UI uses the state variant to close out a bundle once the
    final stage's required evidence is filled.
    """
    stage = body.get("stage")
    state = body.get("state")
    if not stage and not state:
        raise HTTPException(status_code=400, detail="stage or state is required")
    payload = {}
    if stage: payload["stage"] = stage
    if state: payload["state"] = state
    return gov_patch(f"/bundles/{bundle_id}", json_body=payload)


@app.get("/api/jobs/{job_id}/logs")
def get_job_logs(job_id: str, logType: str = "stdoutstderr", limit: int = 2000):
    """Proxy to /v4/jobs/{id}/logsWithProblemSuggestions, returning just the
    log lines (joined) plus the job's executionStatus so the frontend can
    show progress + the final stdout without a second call."""
    try:
        logs_resp = v4_get(f"/jobs/{job_id}/logsWithProblemSuggestions",
                           params={"logType": logType, "limit": limit})
    except HTTPException as e:
        # Job-not-found / not-ready is normal early on; surface gracefully
        return {"jobId": job_id, "status": "unavailable", "text": "", "error": str(e.detail)[:300]}

    # Domino returns {logset: {logContent: [{log, logType, timestamp, size}, ...], isComplete, pagination}, problemSuggestion}
    # NOT {logContent: [...]} at the top level (that was wrong in earlier versions).
    logset = logs_resp.get("logset") or {}
    lines = []
    for item in (logset.get("logContent") or []):
        ln = item.get("log") if isinstance(item, dict) else str(item)
        if ln is not None:
            lines.append(ln)
    # Get job status separately (small call)
    status = None
    try:
        job = v4_get(f"/jobs/{job_id}")
        status = (job.get("statuses") or {}).get("executionStatus")
    except Exception:
        pass
    return {"jobId": job_id, "status": status, "text": "\n".join(lines), "lineCount": len(lines)}


# ── Stage Reassignment ───────────────────────────────────────────

@app.patch("/api/bundles/{bundle_id}/stages/{stage_id}")
def patch_bundle_stage(bundle_id: str, stage_id: str, body: dict):
    """Reassign a stage owner. Body: {"assignee": {"id": "userId"}}

    After the PATCH, re-reads the bundle from Domino to verify the
    assignment actually persisted.  Retries read-back up to 3 times
    with increasing delays to handle eventual consistency.
    Returns the verified stage data with a ``verified`` flag and
    ``_debug`` dict so the frontend can surface details.

    For unassignment (assignee is null), tries multiple payload formats
    since the Domino governance API may reject {assignee: null} silently.
    """
    requested_id = (body.get("assignee") or {}).get("id") if body.get("assignee") else None
    is_unassign = body.get("assignee") is None or requested_id is None

    # For unassignment, try multiple payload formats since Domino's
    # undocumented API may only accept certain shapes for clearing.
    unassign_formats_tried = []
    if is_unassign:
        unassign_payloads = [
            ("empty_body", {}),  # what Domino's own UI sends (content-length: 2)
            ("assignee_null", {"assignee": None}),
            ("assignee_empty_obj", {"assignee": {}}),
            ("assignee_id_empty", {"assignee": {"id": ""}}),
            ("assignee_id_null", {"assignee": {"id": None}}),
        ]
        patch_resp = None
        for fmt_name, payload in unassign_payloads:
            try:
                patch_resp = gov_patch(f"/bundles/{bundle_id}/stages/{stage_id}", json_body=payload)
                unassign_formats_tried.append({"format": fmt_name, "status": "ok", "payload": str(payload)})
                logger.info(f"Unassign PATCH with format={fmt_name} returned 200")
                # Quick check if this format actually cleared the assignee
                time.sleep(0.5)
                quick_check = gov_get(f"/bundles/{bundle_id}")
                for s in (quick_check.get("stages") or []):
                    sid = s.get("stageId") or (s.get("stage") or {}).get("id")
                    if sid == stage_id:
                        actual = (s.get("assignee") or {}).get("id") if s.get("assignee") else None
                        unassign_formats_tried[-1]["readBackAssignee"] = actual
                        if not actual:  # treat "" and None both as unassigned
                            unassign_formats_tried[-1]["worked"] = True
                            logger.info(f"Unassign format={fmt_name} WORKED — stage is now unassigned")
                        else:
                            unassign_formats_tried[-1]["worked"] = False
                            logger.warning(f"Unassign format={fmt_name} did NOT work — still assigned to {actual}")
                        break
                # If this format worked, stop trying others
                if unassign_formats_tried[-1].get("worked"):
                    break
            except Exception as e:
                unassign_formats_tried.append({"format": fmt_name, "status": "error", "error": str(e)})
                logger.warning(f"Unassign format={fmt_name} raised: {e}")

        if patch_resp is None:
            patch_resp = {}
    else:
        patch_resp = gov_patch(f"/bundles/{bundle_id}/stages/{stage_id}", json_body=body)

    debug = {
        "bundleId": bundle_id,
        "stageId": stage_id,
        "requestedId": requested_id,
        "isUnassign": is_unassign,
        "patchStatus": "ok",
        "patchRespKeys": list(patch_resp.keys()) if isinstance(patch_resp, dict) else str(type(patch_resp)),
        "patchAssigneeInResp": (patch_resp.get("assignee") or {}).get("id") if isinstance(patch_resp, dict) else None,
        "attempts": [],
    }
    if unassign_formats_tried:
        debug["unassignFormatsTried"] = unassign_formats_tried

    # ── Read-back verification with retry ────────────────────────
    # Domino's API has eventual consistency — retry up to 3 times
    # with increasing delays (0.5s, 1.5s, 3s) before declaring mismatch.
    delays = [0.5, 1.5, 3.0]
    verified = None  # None = indeterminate

    for attempt_num, delay in enumerate(delays, 1):
        time.sleep(delay)
        attempt_info = {"attempt": attempt_num, "delay": delay}
        try:
            bundle = gov_get(f"/bundles/{bundle_id}")
            stages = bundle.get("stages") or []
            all_stage_ids = []
            matched = None
            for s in stages:
                sid = s.get("stageId") or (s.get("stage") or {}).get("id")
                all_stage_ids.append(sid)
                if sid == stage_id:
                    matched = s
                    break

            if matched is not None:
                actual_id = (matched.get("assignee") or {}).get("id") if matched.get("assignee") else None
                attempt_info["actualId"] = actual_id
                attempt_info["matched"] = True
                if (not actual_id and not requested_id) or actual_id == requested_id:
                    verified = True
                    debug["attempts"].append(attempt_info)
                    break
                else:
                    attempt_info["reason"] = "id_mismatch"
            else:
                attempt_info["matched"] = False
                attempt_info["reason"] = "stage_not_found"
                attempt_info["availableStageIds"] = all_stage_ids

            debug["attempts"].append(attempt_info)

        except Exception as e:
            attempt_info["reason"] = "read_back_error"
            attempt_info["error"] = str(e)
            debug["attempts"].append(attempt_info)
            logger.warning(f"Assignment verification attempt {attempt_num} failed: {e}")

    if verified is True:
        patch_resp["verified"] = True
    elif verified is None and all(a.get("reason") == "read_back_error" for a in debug["attempts"]):
        # All attempts failed with errors — indeterminate
        logger.warning(f"Assignment verification: all read-back attempts failed for bundle={bundle_id} stage={stage_id}")
        patch_resp["verified"] = None
    else:
        # Final attempt still mismatched
        last = debug["attempts"][-1] if debug["attempts"] else {}
        logger.warning(
            f"Assignment verification mismatch after {len(delays)} attempts for "
            f"bundle={bundle_id} stage={stage_id}: requested={requested_id}, "
            f"actual={last.get('actualId', 'unknown')}"
        )
        patch_resp["verified"] = False
        if matched is not None:
            patch_resp["actualAssignee"] = matched.get("assignee")

    patch_resp["_debug"] = debug
    return patch_resp


# ── Attachment Overviews ──────────────────────────────────────────

@app.get("/api/attachment-overviews")
def list_attachment_overviews(limit: int = 200, offset: int = 0):
    params = {"limit": limit, "offset": offset}
    return gov_get("/attachment-overviews", params=params)


# ── Assignment Rules Persistence ────────────────────────────────
# Rules are written to a JSON file on disk so they sync across browsers,
# survive cache clears, and gain a real audit trail (file mtime + Domino
# Dataset versioning when the storage path is a Dataset mount). In Domino,
# /domino/datasets/local/<project> is a writable, versioned filesystem;
# outside Domino we fall back to a project-local file for dev.

def _assignment_rules_path() -> str:
    """Return the absolute path where assignment rules should live."""
    override = os.environ.get("ASSIGNMENT_RULES_PATH")
    if override:
        return override
    project = os.environ.get("DOMINO_PROJECT_NAME")
    if project and os.path.isdir("/domino/datasets/local"):
        d = f"/domino/datasets/local/{project}"
        try:
            os.makedirs(d, exist_ok=True)
        except OSError:
            pass
        return os.path.join(d, "assignment_rules.json")
    return os.path.join(os.path.dirname(__file__), "assignment_rules.json")


def _read_assignment_store() -> dict:
    """Load the full assignment-rules file as a dict. Tolerates a legacy
    bare-list file (older saves stored just the rules array) and a missing
    file. Returns {} when there is nothing to read so callers can merge."""
    path = _assignment_rules_path()
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        data = json.load(f)
    if isinstance(data, list):
        return {"rules": data}
    return data if isinstance(data, dict) else {}


@app.get("/api/assignment-rules")
def get_assignment_rules():
    path = _assignment_rules_path()
    try:
        data = _read_assignment_store()
    except (OSError, json.JSONDecodeError) as e:
        logger.warning(f"Failed to read assignment rules from {path}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read rules: {e}")
    # Return every stored top-level key (e.g. branch_overrides, branch_config
    # for Phase 2) so the client sees the whole config, plus source.
    out = dict(data)
    out.setdefault("rules", [])
    out.setdefault("savedAt", None)
    out["source"] = path
    return out


@app.put("/api/assignment-rules")
def put_assignment_rules(body: dict):
    """Read-modify-write: merge the body's top-level keys over whatever is
    already stored, then re-stamp savedAt/savedBy. A PUT that sends only
    'rules' preserves any sibling config (branch_overrides, branch_config),
    and vice-versa — nothing silently drops on the next save."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    if "rules" in body and not isinstance(body["rules"], list):
        raise HTTPException(status_code=400, detail="'rules' must be an array when present")
    path = _assignment_rules_path()
    try:
        payload = _read_assignment_store()
    except (OSError, json.JSONDecodeError) as e:
        logger.warning(f"Existing assignment rules unreadable, overwriting fresh: {e}")
        payload = {}
    # Merge caller-supplied keys (minus the server-owned stamps) over existing.
    for k, v in body.items():
        if k in ("savedAt", "savedBy", "source"):
            continue
        payload[k] = v
    payload.setdefault("rules", [])
    payload["savedAt"] = datetime.utcnow().isoformat() + "Z"
    payload["savedBy"] = os.environ.get("DOMINO_STARTING_USERNAME") or os.environ.get("USER") or "unknown"
    try:
        with open(path, "w") as f:
            json.dump(payload, f, indent=2)
        return {"ok": True, "source": path, "savedAt": payload["savedAt"],
                "count": len(payload["rules"])}
    except OSError as e:
        logger.warning(f"Failed to write assignment rules to {path}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to write rules: {e}")


# ── Dataset & Volume Snapshot Versions (Staleness Check) ─────────

@app.get("/api/datasets/{dataset_id}/snapshots")
def list_dataset_snapshots(dataset_id: str, limit: int = 5, sort: str = "-version"):
    """Fetch snapshots for a dataset to check for newer versions.
    Tries multiple known Domino dataset API paths."""
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    headers = get_auth_headers()

    endpoints = [
        f"{host}/v4/datasetrw/datasets/{dataset_id}/snapshots",
        f"{host}/api/datasetrw/v1/datasets/{dataset_id}/snapshots",
        f"{host}/v4/datasets/{dataset_id}/snapshots",
    ]

    for url in endpoints:
        try:
            resp = requests.get(
                url, headers=headers,
                params={"limit": limit, "sort": sort},
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                # Normalize response shape
                if isinstance(data, list):
                    return {"data": data}
                if isinstance(data, dict) and "data" not in data:
                    items = data.get("snapshots", data.get("items", []))
                    return {"data": items}
                return data
        except Exception:
            continue

    return {"data": [], "error": "No dataset snapshot endpoint responded"}


@app.get("/api/volumes/{volume_id}/snapshots")
def list_volume_snapshots(volume_id: str, limit: int = 5, sort: str = "-version"):
    """Fetch snapshots for a NetApp volume to check for newer versions.
    Tries multiple known Domino volume/storage API paths."""
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    headers = get_auth_headers()

    endpoints = [
        f"{host}/api/storage/v1/volumes/{volume_id}/snapshots",
        f"{host}/v4/storage/volumes/{volume_id}/snapshots",
        f"{host}/api/netapp/v1/volumes/{volume_id}/snapshots",
    ]

    for url in endpoints:
        try:
            resp = requests.get(
                url, headers=headers,
                params={"limit": limit, "sort": sort},
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return {"data": data}
                if isinstance(data, dict) and "data" not in data:
                    items = data.get("snapshots", data.get("items", []))
                    return {"data": items}
                return data
        except Exception:
            continue

    return {"data": [], "error": "No volume snapshot endpoint responded"}


# ── Create Bundle ─────────────────────────────────────────────────

@app.post("/api/bundles")
def create_bundle(body: dict):
    """Create a new governance bundle. Body: { name, policyId, projectId }."""
    return gov_post("/bundles", json_body=body)


# ── Computed Policy (rich detail per bundle+policy) ────────────────

@app.post("/api/compute-policy")
def compute_policy(body: dict):
    return gov_post("/rpc/compute-policy", json_body=body)


# ── Policies ───────────────────────────────────────────────────────

@app.get("/api/policies")
def list_policies(limit: int = 50, offset: int = 0, status: str = ""):
    params = {"limit": limit, "offset": offset}
    if status:
        params["status"] = [status]
    return gov_get("/policy-overviews", params=params)


@app.get("/api/policies/{policy_id}")
def get_policy(policy_id: str):
    return gov_get(f"/policies/{policy_id}")


# ── Users ─────────────────────────────────────────────────────────

@app.get("/api/users/self")
def get_current_user():
    return v4_get("/users/self")


@app.get("/api/users")
def list_users():
    return v4_get("/users")



# ── Projects ──────────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects(limit: int = 50, offset: int = 0):
    params = {"limit": limit, "offset": offset}
    return v4_get("/projects", params=params)


# ── Project git info ──────────────────────────────────────────────

@app.get("/api/projects/{project_id}/git-info")
def get_project_git_info(project_id: str):
    """
    Returns parsed git provider info for a project's primary repo so
    the frontend can build deep links to source files (e.g. GitHub blob
    URLs).  Shape: {provider, owner, repo, uri, defaultRef}.
    """
    try:
        repos = v4_get(f"/projects/{project_id}/gitRepositories")
    except HTTPException as e:
        return {"provider": None, "error": str(e.detail)[:200]}

    repo_list = repos if isinstance(repos, list) else []
    if not repo_list:
        return {"provider": None}

    repo = repo_list[0]
    provider = (repo.get("serviceProvider") or "").lower() or None
    uri = repo.get("uri") or ""

    # Parse host, owner, repo from any of:
    #   git@host:owner/repo.git
    #   https://host/owner/repo.git
    #   https://user@host/owner/repo
    #   ssh://git@host:22/owner/repo.git
    # Captures the host so GitHub Enterprise / self-hosted GitLab work.
    import re
    host, owner, repo_name = None, None, None
    m = re.search(
        r"(?:^|@|//)([^/:@\s]+)[:/]([^/\s]+)/([^\s]+?)(?:\.git)?/?$",
        uri,
    )
    if m:
        host = m.group(1)
        owner = m.group(2)
        repo_name = m.group(3)

    # Infer provider from host when Domino didn't tell us, then narrow
    # by hostname (handles Enterprise editions).
    inferred = None
    if host:
        h = host.lower()
        if "github" in h: inferred = "github"
        elif "gitlab" in h: inferred = "gitlab"
        elif "bitbucket" in h: inferred = "bitbucket"
        elif "dev.azure.com" in h or "visualstudio.com" in h: inferred = "azuredevops"
    if not provider and inferred:
        provider = inferred

    ref_obj = repo.get("ref") or {}
    default_ref = ref_obj.get("value") if isinstance(ref_obj, dict) else None

    return {
        "provider": provider,
        "host": host,
        "owner": owner,
        "repo": repo_name,
        "uri": uri,
        "defaultRef": default_ref,
    }


@app.get("/api/attachments/raw")
def get_attachment_raw(projectId: str, fileName: str, branch: str = "", commit: str = ""):
    """Proxy the raw bytes of a file in a project's git repo so the app can
    render it inline (RTF viewer). Tries every repo x every ref strategy
    (branch, commit, default) and returns the first 200. On total failure
    returns a structured diagnostic envelope (HTTP 502 detail) listing the
    repos found and every attempt's status/body — so a single failed click
    tells us exactly what to fix without another redeploy cycle."""
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")

    # Resolve candidate repos. The project's OWN repo is `mainRepository` on
    # the project detail; the /gitRepositories endpoint only returns IMPORTED
    # repos (often empty), which is why it found nothing before. Try the main
    # repo first, then imported repos from both sources, deduped by id.
    repo_resolution = {}
    repos_to_try = []
    seen_ids = set()

    def _add_repo(r):
        if not r or not isinstance(r, dict) or not r.get("id"):
            return
        if r["id"] in seen_ids:
            return
        seen_ids.add(r["id"])
        repos_to_try.append(r)

    try:
        proj = v4_get(f"/projects/{projectId}")
        _add_repo(proj.get("mainRepository"))
        for ir in (proj.get("importedGitRepositories") or []):
            _add_repo(ir)
        repo_resolution["projectDetail"] = "ok (main=%s, imported=%d)" % (
            bool(proj.get("mainRepository")), len(proj.get("importedGitRepositories") or []))
    except HTTPException as e:
        repo_resolution["projectDetail"] = "error %s: %s" % (e.status_code, str(e.detail)[:160])
    try:
        extra = v4_get(f"/projects/{projectId}/gitRepositories")
        for r in (extra if isinstance(extra, list) else []):
            _add_repo(r)
        repo_resolution["gitRepositories"] = "ok (%d)" % (len(extra) if isinstance(extra, list) else 0)
    except HTTPException as e:
        repo_resolution["gitRepositories"] = "error %s" % e.status_code

    repo_list = repos_to_try
    repo_summary = [{"id": r.get("id"), "name": r.get("name"),
                     "serviceProvider": r.get("serviceProvider"), "uri": r.get("uri")}
                    for r in repo_list]
    if not repo_list:
        raise HTTPException(status_code=404, detail={
            "message": "Could not resolve any git repository for this project",
            "projectId": projectId, "repoResolution": repo_resolution})

    ref_strategies = []
    if branch:
        ref_strategies.append(("branchName", branch))
    if commit:
        ref_strategies.append(("commit", commit))
    ref_strategies.append((None, None))  # default branch

    attempts = []
    for r in repo_list:
        rid = r.get("id")
        if not rid:
            continue
        url = f"{host}/v4/projects/{projectId}/gitRepositories/{rid}/git/raw"
        for pkey, pval in ref_strategies:
            params = {"fileName": fileName}
            if pkey:
                params[pkey] = pval
            ref_label = (pkey + "=" + str(pval)) if pkey else "default"
            try:
                resp = requests.get(url, headers=get_auth_headers(), params=params, timeout=60)
            except Exception as ex:
                attempts.append({"repo": r.get("name"), "repoId": rid, "ref": ref_label, "error": str(ex)[:200]})
                continue
            attempts.append({"repo": r.get("name"), "repoId": rid, "ref": ref_label,
                             "status": resp.status_code,
                             "bodyHead": "(ok)" if resp.status_code == 200 else resp.text[:160]})
            if resp.status_code == 200:
                out = Response(content=resp.content, media_type="text/plain; charset=utf-8")
                out.headers["X-Source-Repo"] = str(r.get("name") or rid)
                out.headers["X-Source-Ref"] = ref_label
                return out

    logger.error(f"[attachments/raw] all attempts failed for project={projectId} "
                 f"file={fileName} branch={branch!r} commit={commit!r}: {attempts}")
    raise HTTPException(status_code=502, detail={
        "message": "Could not fetch file from any repo/ref combination",
        "projectId": projectId,
        "fileNameReceived": fileName,
        "branchReceived": branch or None,
        "commitReceived": commit or None,
        "repoResolution": repo_resolution,
        "repos": repo_summary,
        "attempts": attempts,
    })


# ── Git-linkage routes (Phase 1) ──────────────────────────────────

@app.get("/api/projects/{project_id}/branches")
def list_project_branches(project_id: str, names: str = ""):
    """Resolve one or more expected branch names to their HEAD for a project.
    Multi-name (comma-separated) so the frontend batches per project."""
    wanted = [n.strip() for n in names.split(",") if n.strip()]
    repos = resolve_repos(project_id)
    if not repos or not wanted:
        return {"branches": {n: None for n in wanted}, "repo": None}
    main = next((r for r in repos if r.get("isMain")), repos[0])
    out = {}
    with ThreadPoolExecutor(max_workers=16) as ex:
        for name, head in ex.map(
            lambda n: (n, get_branch_head(project_id, main["id"], n)), wanted):
            out[name] = head
    return {"branches": out, "repo": main["id"]}


@app.get("/api/projects/{project_id}/provenance")
def get_project_provenance(project_id: str, commit: str):
    """Provenance Checkpoint for a commit. NOTE: returns {} for git-only projects
    (the enrichment path is dead there — see get_checkpoint_for_commit closure).
    Retained for DFS-based projects; not called by the current UI."""
    return get_checkpoint_for_commit(project_id, commit) or {}


@app.post("/api/deliverables/drift")
def deliverables_drift(body: dict):
    """Batch drift computation. Body: {deliverables: [{bundleId, projectId,
    expectedBranch, filename, validatedCommit, validatedSource}]}. The dashboard
    hits this once per refresh; concurrency + caching live server-side."""
    items = body.get("deliverables", [])
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="Body must include a 'deliverables' array")
    results = [None] * len(items)
    settings = _branch_settings()  # read store once; shared across all items

    def work(i):
        try:
            return i, _compute_drift(items[i] or {}, settings=settings)
        except Exception as e:
            logger.warning(f"[git-linkage] drift compute failed idx {i}: {e}")
            return i, {"bundleId": (items[i] or {}).get("bundleId"), "validated_at": None,
                       "branch_state": None, "badge": "skipped",
                       "badge_reason": f"error: {str(e)[:120]}"}

    if items:
        with ThreadPoolExecutor(max_workers=16) as ex:
            for i, res in ex.map(work, range(len(items))):
                results[i] = res
    return {"results": results}


# ── Project Collaborators ─────────────────────────────────────────

@app.get("/api/projects/{project_id}/collaborators")
def list_project_collaborators(project_id: str):
    result = v4_get(f"/projects/{project_id}/collaborators?getUsers=true")
    # Debug: log collaborator IDs to compare with governance assignee IDs
    members = result if isinstance(result, list) else []
    if members:
        sample = members[:3]
        logger.info(
            f"[Collaborators Debug] project={project_id[:12]}... "
            f"count={len(members)} "
            f"sample_ids={[m.get('id', '?')[:12] + '...' for m in sample]} "
            f"sample_userNames={[m.get('userName', '?') for m in sample]}"
        )
    return result


# ── Jobs / Runs (Automation) ───────────────────────────────────────

def v4_post(path, json_body=None):
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    headers = get_auth_headers()
    headers["Content-Type"] = "application/json"
    url = f"{host}/v4{path}"
    resp = requests.post(url, headers=headers, json=json_body, timeout=60)
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@app.post("/api/projects/{project_id}/runs")
def start_project_run(project_id: str, body: dict):
    """Start a Domino job in the given project.
    Body: {"command": "python scripts/validate.py", "title": "Automation: ..."}
    Tries multiple known Domino Jobs API paths.
    """
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    headers = get_auth_headers()
    headers["Content-Type"] = "application/json"

    payload = {
        "projectId": project_id,
        "commandToRun": body.get("command", ""),
        "title": body.get("title", "Automation Run"),
    }

    # Try known Domino Jobs API endpoint patterns
    endpoints = [
        f"{host}/v4/jobs/start",
        f"{host}/api/jobs/v1/jobs",
        f"{host}/v4/projects/{project_id}/runs",
        f"{host}/api/runs/v1/runs",
    ]

    last_resp = None
    for url in endpoints:
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=60)
            if resp.status_code in (200, 201):
                return resp.json()
            last_resp = resp
        except Exception:
            continue

    # If none worked, return the last error for debugging
    detail = last_resp.text if last_resp else "All endpoints failed"
    status = last_resp.status_code if last_resp else 503
    raise HTTPException(status_code=status, detail=detail)


@app.get("/api/projects/{project_id}/runs/{run_id}")
def get_project_run(project_id: str, run_id: str):
    """Get status of a Domino job run. Tries multiple endpoint patterns."""
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    headers = get_auth_headers()

    endpoints = [
        f"{host}/v4/jobs/{run_id}",
        f"{host}/api/jobs/v1/jobs/{run_id}",
        f"{host}/api/runs/v1/runs/{run_id}",
    ]

    last_resp = None
    for url in endpoints:
        try:
            resp = requests.get(url, headers=headers, timeout=30)
            if resp.status_code == 200:
                return resp.json()
            last_resp = resp
        except Exception:
            continue

    detail = last_resp.text if last_resp else "All endpoints failed"
    status = last_resp.status_code if last_resp else 503
    raise HTTPException(status_code=status, detail=detail)


# ── Data Explorer App URL Discovery ────────────────────────────────

_data_explorer_cache = {"url": None, "probed": False}


@app.get("/api/data-explorer-url")
def get_data_explorer_url():
    """Discover the Data Explorer app URL via the Beta Apps API.
    Supports DATA_EXPLORER_URL env var override."""
    # Check env var override first
    override = os.environ.get("DATA_EXPLORER_URL", "").strip()
    if override:
        return {"url": override}

    if _data_explorer_cache["probed"]:
        return {"url": _data_explorer_cache["url"]}

    host = get_domino_host()
    if not host:
        _data_explorer_cache["probed"] = True
        return {"url": None}

    try:
        headers = get_auth_headers()
        resp = requests.get(
            f"{host}/api/apps/beta/apps",
            headers=headers,
            params={"limit": 100},
            timeout=15,
        )
        if resp.status_code == 200:
            apps = resp.json()
            app_list = apps if isinstance(apps, list) else apps.get("items", apps.get("data", apps.get("apps", [])))
            for a in app_list:
                name = (a.get("name") or "").lower()
                if "data explorer" in name or "data_explorer" in name or "dataexplorer" in name:
                    # Build the public-facing URL from the vanity slug
                    ext_host = (_external_host_cache.get("host") or host).rstrip("/")
                    vanity = a.get("vanityUrl")
                    if vanity:
                        app_url = f"{ext_host}/apps/{vanity}/"
                    else:
                        # Fallback: use the url field or construct from app ID
                        app_url = a.get("url")
                        if not app_url:
                            app_id = a.get("id") or a.get("_id")
                            if app_id:
                                app_url = f"{ext_host}/apps/{app_id}/"
                    if app_url:
                        _data_explorer_cache["url"] = app_url
                        _data_explorer_cache["probed"] = True
                        logger.info(f"Data Explorer URL discovered: {app_url}")
                        return {"url": app_url}
    except Exception as e:
        logger.warning(f"Data Explorer discovery failed: {e}")

    _data_explorer_cache["probed"] = True
    return {"url": None}


# ── Whitelabel terminology ─────────────────────────────────────────

@app.get("/api/terminology")
def get_terminology():
    """
    Returns the whitelabeled terms for Bundle and Policy from
    GET /admin/whitelabel/configurations → govern.bundle / govern.policy.
    Falls back to defaults if the endpoint fails or fields are absent.
    """
    defaults = {"bundle": "Bundle", "policy": "Policy"}
    host = get_domino_host()
    if not host:
        return defaults
    try:
        headers = get_auth_headers()
        url = f"{host}/v4/admin/whitelabel/configurations"
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            govern = data.get("govern") or {}
            return {
                "bundle": govern.get("bundle") or defaults["bundle"],
                "policy": govern.get("policy") or defaults["policy"],
            }
    except Exception:
        pass
    return defaults


# ── Flows / Lineage ──────────────────────────────────────────────

@app.get("/api/flows/status")
def flows_status():
    """Check if Domino Flows (workflow orchestration) is available."""
    try:
        # Check for FlowArtifact attachments as a signal that Flows is in use
        result = gov_get("/attachment-overviews", params={"limit": 1, "type": "FlowArtifact"})
        has_flows = isinstance(result, dict) and len(result.get("data", result.get("overviews", []))) > 0
        return {"available": has_flows, "source": "attachment-overviews"}
    except Exception:
        return {"available": False, "source": "probe_failed"}


@app.get("/api/flows/artifacts")
def list_flow_artifacts(
    workflow_name: str = "",
    workflow_version: str = "",
    limit: int = 200,
):
    """List FlowArtifact attachments, which can imply dataset lineage."""
    params = {"limit": limit, "type": "FlowArtifact"}
    if workflow_name:
        params["identifier.executionWorkflowName"] = workflow_name
    if workflow_version:
        params["identifier.executionWorkflowVersion"] = workflow_version
    return gov_get("/attachment-overviews", params=params)


@app.get("/api/project-dependencies")
def project_dependencies(owner: str = "", project: str = ""):
    """Proxy to Domino's project dependency graph endpoint."""
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    params = {}
    if owner:
        params["ownerUsername"] = owner
    if project:
        params["projectName"] = project
    url = f"{host}/gateway/projects/dependency-graph"
    headers = get_auth_headers()
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code == 200:
            return resp.json()
        return {"error": f"Status {resp.status_code}", "detail": resp.text[:500]}
    except Exception as e:
        return {"error": str(e)}


# ── Debug ─────────────────────────────────────────────────────────

@app.get("/api/debug/auth")
def debug_auth():
    """Show which auth method is available and test governance connectivity."""
    has_override = bool(os.environ.get("API_KEY_OVERRIDE"))
    has_user_key = bool(os.environ.get("DOMINO_USER_API_KEY"))
    has_host = bool(os.environ.get("DOMINO_API_HOST"))
    sidecar_token = None
    sidecar_raw = None
    try:
        resp = requests.get("http://localhost:8899/access-token", timeout=3)
        sidecar_raw = resp.text.strip()[:30] + "..." if resp.text.strip() else None
        token = resp.text.strip()
        if token.startswith("Bearer "):
            token = token[len("Bearer "):]
        sidecar_token = token[:20] + "..." if token else None
    except Exception as e:
        sidecar_raw = f"ERROR: {e}"

    # Show key host-related env vars (values, not secrets)
    host_vars = {}
    for k in ["DOMINO_API_HOST", "DOMINO_API_PROXY", "DOMINO_USER_HOST",
              "DOMINO_PROJECT_ID", "DOMINO_PROJECT_NAME", "DOMINO_PROJECT_OWNER"]:
        host_vars[k] = os.environ.get(k, "(not set)")

    # List all DOMINO_* env vars (names only)
    domino_vars = sorted([k for k in os.environ if k.startswith("DOMINO")])

    # Test governance API connectivity against multiple candidate hosts
    gov_test = {}
    candidates = _get_gov_host_candidates()

    try:
        full_resp = requests.get("http://localhost:8899/access-token", timeout=3)
        full_token = full_resp.text.strip()
        if full_token.startswith("Bearer "):
            full_token = full_token[len("Bearer "):]
        api_key = _get_api_key()
        auth_token = api_key or full_token

        for label, base_url in candidates:
            test_url = f"{base_url}/api/governance/v1/bundles?limit=1"
            try:
                r = requests.get(test_url, headers={"X-Domino-Api-Key": auth_token}, timeout=10)
                gov_test[label] = {"url": test_url, "status": r.status_code, "body_preview": r.text[:200]}
            except Exception as e:
                gov_test[label] = {"url": test_url, "error": str(e)}

        # Also test v4 on primary host
        v4_url = f"{get_domino_host()}/v4/users/self"
        r3 = requests.get(v4_url, headers={"Authorization": f"Bearer {full_token}"}, timeout=10)
        gov_test["v4_Bearer"] = {"url": v4_url, "status": r3.status_code, "body_preview": r3.text[:200]}
    except Exception as e:
        gov_test["error"] = str(e)

    return {
        "has_API_KEY_OVERRIDE": has_override,
        "has_DOMINO_USER_API_KEY": has_user_key,
        "has_DOMINO_API_HOST": has_host,
        "domino_host": get_domino_host() or "(not set)",
        "gov_host": _get_gov_host() or "(same as domino_host)",
        "external_host_captured": _external_host_cache.get("host", "(not yet)"),
        "sidecar_token_preview": sidecar_token,
        "sidecar_raw_preview": sidecar_raw,
        "host_vars": host_vars,
        "domino_env_vars": domino_vars,
        "governance_test": gov_test,
    }


# ── Status Report (PDF Export) ────────────────────────────────────

def _format_date(iso_str):
    if not iso_str:
        return ""
    try:
        # Handle both "2026-01-20T10:00:00Z" and epoch-ms integers
        if isinstance(iso_str, (int, float)):
            dt = datetime.utcfromtimestamp(iso_str / 1000)
        else:
            s = iso_str.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
        return dt.strftime("%m/%d/%Y")
    except Exception:
        return str(iso_str)[:10]


def _get_output_type(policy_name):
    up = (policy_name or "").upper()
    if "SDTM" in up:
        return "SDTM"
    if "ADAM" in up:
        return "ADaM"
    if "TFL" in up or "TABLE" in up or "FIGURE" in up or "LISTING" in up:
        return "TFL"
    return "Other"


def _get_risk_level(policy_name):
    low = (policy_name or "").lower()
    if "high" in low or "level 3" in low or "level3" in low:
        return "Level 3"
    if "medium" in low or "level 2" in low or "level2" in low:
        return "Level 2"
    if "low" in low or "level 1" in low or "level1" in low:
        return "Level 1"
    return "Level 2"


def _get_rationale(policy_name):
    low = (policy_name or "").lower()
    if "high" in low or "level 3" in low or "level3" in low:
        return ("Full independent programming of datasets supporting new or critical "
                "analyses where no validated code exists")
    if "low" in low or "level 1" in low or "level1" in low:
        return ("Self-QC with study lead review; prior validated code available as "
                "reference")
    # Medium / default
    return ("Partial independent programming with peer review; some validated "
            "reference code available")


def _categorize_attachment(att):
    """Return ('prog', path) | ('qc', path) | ('output', path) | (None, None)."""
    ident = att.get("identifier") or {}
    fname = (ident.get("filename") or ident.get("name") or "").strip()
    if not fname:
        return None, None

    low = fname.lower()
    if "/" in fname:
        dir_path = fname.rsplit("/", 1)[0]
    else:
        dir_path = ""

    base = fname.rsplit("/", 1)[-1].lower()

    in_qc_path = (
        any(seg in low for seg in ["/qc/", "/validation/", "/verif/", "/verify/", "/tfl_qc/", "/qc_", "_qc/", "_val/"])
        or any(base.startswith(pfx) for pfx in ["v-", "v_", "vld_", "qc_", "chk_"])
        or "_qc." in base or "_val." in base
    )

    # Dataset / table outputs (real deliverables, never QC artifacts)
    if any(base.endswith(ext) for ext in (".sas7bdat", ".xpt", ".csv", ".xlsx", ".rtf")):
        return ("qc_output" if in_qc_path else "output"), dir_path

    # PDFs: qc path → qc artifact, else output report
    if base.endswith(".pdf") and not base.endswith("_pgm.pdf"):
        return ("qc_output" if in_qc_path else "output"), dir_path

    # Programs
    if base.endswith(".sas") or base.endswith(".r") or base.endswith(".py"):
        if in_qc_path:
            return "qc", dir_path
        return "prog", dir_path

    # Logs and other auxiliary files — ignored for the report
    return None, None


def _build_status_report_pdf(project_name, sections, meta, debug_info):
    """Render a landscape A3 PDF matching the BMS QC status report format."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A3),
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("ReportTitle", parent=styles["Normal"],
                                  fontSize=13, fontName="Helvetica-Bold",
                                  alignment=TA_CENTER, spaceAfter=4)
    path_style = ParagraphStyle("PathLine", parent=styles["Normal"],
                                 fontSize=8, fontName="Helvetica",
                                 alignment=TA_CENTER, spaceAfter=2)
    cell_style = ParagraphStyle("Cell", parent=styles["Normal"],
                                 fontSize=7, fontName="Helvetica", leading=9)
    hdr_style = ParagraphStyle("Hdr", parent=styles["Normal"],
                                fontSize=7, fontName="Helvetica-Bold",
                                textColor=colors.white, leading=9,
                                alignment=TA_CENTER)
    debug_style = ParagraphStyle("Debug", parent=styles["Normal"],
                                  fontSize=6, fontName="Courier", leading=8)

    DOMINO_PURPLE = colors.HexColor("#2D2B6B")
    DOMINO_ACCENT = colors.HexColor("#6B68B8")
    DOMINO_LIGHT = colors.HexColor("#EEEDF7")
    ALT_ROW = colors.HexColor("#F5F5FA")

    section_style = ParagraphStyle("Section", parent=styles["Normal"],
                                    fontSize=12, fontName="Helvetica-Bold",
                                    textColor=DOMINO_PURPLE,
                                    spaceBefore=10, spaceAfter=3,
                                    borderPadding=4, leftIndent=0)
    meta_label_style = ParagraphStyle("MetaLabel", parent=styles["Normal"],
                                       fontSize=8, fontName="Helvetica-Bold",
                                       textColor=DOMINO_PURPLE, leading=10)
    meta_value_style = ParagraphStyle("MetaValue", parent=styles["Normal"],
                                       fontSize=8, fontName="Helvetica", leading=10)
    footnote_style = ParagraphStyle("Footnote", parent=styles["Normal"],
                                     fontSize=7, fontName="Helvetica-Oblique",
                                     textColor=colors.HexColor("#555555"),
                                     leading=9, spaceBefore=2, spaceAfter=6)

    # Column widths (mm) — 13 cols, must sum to ≤ 400mm usable width on A3 landscape
    col_widths = [
        36 * mm,  # Deliverable Name
        30 * mm,  # Program Name
        30 * mm,  # Dataset Output File Name
        26 * mm,  # Programmer Email
        16 * mm,  # Execution Date
        44 * mm,  # Risk Level (full policy name)
        56 * mm,  # Rationale
        30 * mm,  # Verification Program Name
        26 * mm,  # Verifier Email
        16 * mm,  # QC Date
        26 * mm,  # Final Review Email
        16 * mm,  # Final Review Date
        16 * mm,  # Program Freeze Date
    ]

    headers = [
        "Deliverable\nName",
        "Program\nName",
        "Dataset Output\nFile Name",
        "Programmer\nEmail",
        "Execution\nDate",
        "Risk Level\n(Policy)",
        "Rationale for Risk Level\nAssignment",
        "Verification\nProgram Name",
        "Verifier\nEmail",
        "QC\nDate",
        "Final Review\nEmail",
        "Final Review\nDate",
        "Program\nFreeze Date",
    ]

    def make_table(data_rows):
        header_row = [Paragraph(h, hdr_style) for h in headers]
        table_data = [header_row]
        for i, row in enumerate(data_rows):
            table_data.append([Paragraph(str(v or ""), cell_style) for v in row])

        tbl = RLTable(table_data, colWidths=col_widths, repeatRows=1)
        row_count = len(table_data)
        style_cmds = [
            ("BACKGROUND", (0, 0), (-1, 0), DOMINO_PURPLE),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ALT_ROW]),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]
        tbl.setStyle(TableStyle(style_cmds))
        return tbl

    story = []
    meta = meta or {}

    # Title bar — Domino purple band
    title_style_v2 = ParagraphStyle("TitleBand", parent=styles["Normal"],
                                     fontSize=14, fontName="Helvetica-Bold",
                                     textColor=colors.white, alignment=TA_CENTER, leading=18)
    subtitle_style_v2 = ParagraphStyle("SubBand", parent=styles["Normal"],
                                        fontSize=9, fontName="Helvetica",
                                        textColor=colors.white, alignment=TA_CENTER, leading=11)
    scope_label_meta = (meta.get("scope") or project_name).strip()
    # If scope covers multiple projects, use a compact subtitle; full list appears in the metadata block.
    if scope_label_meta.lower().startswith(tuple(str(n) + " projects" for n in range(2, 100))):
        try:
            n_projects = int(scope_label_meta.split(" ", 1)[0])
            subtitle_text = f"{n_projects} Projects"
        except Exception:
            subtitle_text = "Multiple Projects"
    else:
        subtitle_text = scope_label_meta
    title_cell = [
        Paragraph(f"QC Status Report", title_style_v2),
        Paragraph(subtitle_text, subtitle_style_v2),
    ]
    title_tbl = RLTable([[title_cell]], colWidths=[380 * mm])
    title_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DOMINO_PURPLE),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(title_tbl)
    story.append(Spacer(1, 4 * mm))

    # Metadata block — who / when / filters
    gen_time = datetime.utcnow().strftime("%B %d, %Y %H:%M UTC")
    total = sum(len(s["rows"]) for s in sections.values())

    generated_by = meta.get("generatedBy") or "—"
    filters_summary = meta.get("filtersSummary") or "None (all deliverables in scope)"
    scope_label = meta.get("scope") or project_name

    meta_rows = [
        [Paragraph("Generated", meta_label_style), Paragraph(gen_time, meta_value_style),
         Paragraph("Generated By", meta_label_style), Paragraph(generated_by, meta_value_style)],
        [Paragraph("Scope", meta_label_style), Paragraph(scope_label, meta_value_style),
         Paragraph("Deliverables", meta_label_style), Paragraph(str(total), meta_value_style)],
        [Paragraph("Active Filters", meta_label_style), Paragraph(filters_summary, meta_value_style), "", ""],
    ]
    meta_tbl = RLTable(meta_rows, colWidths=[30 * mm, 140 * mm, 30 * mm, 180 * mm])
    meta_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DOMINO_LIGHT),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("SPAN", (1, 2), (3, 2)),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (0, 0), (-1, 0), 2, DOMINO_ACCENT),
    ]))
    story.append(meta_tbl)
    story.append(Spacer(1, 6 * mm))

    # Per-section rendering — table directly under the headline, paths as footnote below.
    for section_name in ["SDTM", "ADaM", "TFL", "Other"]:
        sec = sections.get(section_name)
        if not sec or not sec["rows"]:
            continue

        label = section_name + " Datasets" if section_name != "Other" else "Other Deliverables"
        story.append(Paragraph(label, section_style))
        story.append(make_table(sec["rows"]))

        path_bits = []
        if sec.get("prog_path"):
            path_bits.append(f"<b>Program:</b> {sec['prog_path']}")
        if sec.get("output_path"):
            path_bits.append(f"<b>Output:</b> {sec['output_path']}")
        if sec.get("qc_path"):
            path_bits.append(f"<b>Validation:</b> {sec['qc_path']}")
        if path_bits:
            story.append(Paragraph("  •  ".join(path_bits), footnote_style))
        story.append(Spacer(1, 4 * mm))

    # Debug appendix
    if debug_info:
        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
        story.append(Paragraph("Debug Appendix", section_style))
        debug_text = json.dumps(debug_info, indent=2, default=str)
        # Split into chunks to avoid ReportLab overflow
        for line in debug_text.splitlines():
            story.append(Paragraph(line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), debug_style))

    doc.build(story)
    return buf.getvalue()


@app.post("/api/bundles/report")
def generate_status_report(body: dict):
    """
    Generate a PDF status report from data already loaded in the frontend.
    Body: { projectName, bundles: [...], membersCache: {projectId: [member, ...]} }
    """
    project_name = body.get("projectName") or "Unknown Project"
    bundles_data = body.get("bundles") or []
    members_cache = body.get("membersCache") or {}
    generated_by = body.get("generatedBy") or ""
    filters_summary = body.get("filtersSummary") or ""
    scope_label = body.get("scope") or project_name

    # Build user_id → email map from the membersCache the frontend already has
    user_map = {}
    for members in members_cache.values():
        for m in (members or []):
            uid = m.get("id") or m.get("userId") or ""
            if not uid:
                continue
            email = (m.get("email") or m.get("emailAddress") or "").strip()
            uname = m.get("userName") or m.get("username") or ""
            if not email and "@" in uname:
                email = uname
            if uid not in user_map:
                user_map[uid] = email

    def resolve_email(assignee):
        if not assignee:
            return ""
        uid = assignee.get("id") or ""
        return user_map.get(uid) or assignee.get("userName") or ""

    def find_stage(stages, *keywords):
        for s in (stages or []):
            sname = ((s.get("stage") or {}).get("name") or "").lower()
            if any(kw in sname for kw in keywords):
                return s
        return None

    sections = {
        "SDTM": {"rows": [], "prog_path": "", "output_path": "", "qc_path": ""},
        "ADaM": {"rows": [], "prog_path": "", "output_path": "", "qc_path": ""},
        "TFL":  {"rows": [], "prog_path": "", "output_path": "", "qc_path": ""},
        "Other": {"rows": [], "prog_path": "", "output_path": "", "qc_path": ""},
    }

    for b in bundles_data:
        policy = b.get("policyName") or ""
        stages = b.get("stages") or []
        atts = b.get("_attachments") or []

        output_type = _get_output_type(policy)
        rationale = _get_rationale(policy)
        deliverable_name = b.get("name") or ""

        # Rank candidates so the row picks the most meaningful attachment per slot.
        # Output rank (lower = preferred): dataset binaries > text tables > report PDFs
        output_ext_rank = {
            ".sas7bdat": 0, ".xpt": 1, ".csv": 2, ".xlsx": 3, ".rtf": 4, ".pdf": 5,
        }
        buckets = {"prog": [], "qc": [], "output": []}
        for att in atts:
            cat, dir_p = _categorize_attachment(att)
            if cat not in buckets:
                continue  # qc_output, logs, unknown types are intentionally excluded
            fname_full = (att.get("identifier") or {}).get("filename") or ""
            fname_base = fname_full.rsplit("/", 1)[-1]
            ext = "." + fname_base.rsplit(".", 1)[-1].lower() if "." in fname_base else ""
            ext_rank = output_ext_rank.get(ext, 99) if cat == "output" else 0
            buckets[cat].append((ext_rank, fname_base, dir_p))

        def pick(bucket):
            if not bucket:
                return "", ""
            best = sorted(bucket, key=lambda t: (t[0], t[1]))[0]
            return best[1], best[2]

        prog_file, prog_path = pick(buckets["prog"])
        qc_file, qc_path = pick(buckets["qc"])
        out_file, out_path = pick(buckets["output"])

        # Collect all paths seen across this section for smarter path aggregation
        prog_stage = find_stage(stages, "self", "author", "production", "programmer") or (stages[0] if stages else None)
        qc_stage = find_stage(stages, "double", "independent", "verif", "qc")
        review_stage = find_stage(stages, "study lead", "review", "final")

        prog_email = resolve_email(prog_stage.get("assignee") if prog_stage else None)
        exec_date = _format_date((prog_stage or {}).get("assignedAt") or b.get("createdAt"))
        qc_email = resolve_email(qc_stage.get("assignee") if qc_stage else None)
        qc_date = _format_date((qc_stage or {}).get("assignedAt")) if qc_stage else ""
        review_email = resolve_email(review_stage.get("assignee") if review_stage else None)
        review_date = _format_date((review_stage or {}).get("assignedAt")) if review_stage else ""
        freeze_date = _format_date(b.get("updatedAt")) if b.get("state") == "Complete" else ""

        if output_type not in sections:
            continue
        sec = sections[output_type]
        sec["rows"].append([deliverable_name, prog_file, out_file, prog_email, exec_date, policy, rationale,
                            qc_file, qc_email, qc_date, review_email, review_date, freeze_date])
        # Keep the longest path seen (more specific = more useful)
        if prog_path and len(prog_path) > len(sec["prog_path"]): sec["prog_path"] = prog_path
        if out_path and len(out_path) > len(sec["output_path"]): sec["output_path"] = out_path
        if qc_path and len(qc_path) > len(sec["qc_path"]): sec["qc_path"] = qc_path

    logger.info(f"[StatusReport] Sections: { {k: len(v['rows']) for k, v in sections.items()} }")

    # ── Step 5: Render PDF ────────────────────────────────────────
    try:
        meta = {
            "generatedBy": generated_by,
            "filtersSummary": filters_summary,
            "scope": scope_label,
        }
        pdf_bytes = _build_status_report_pdf(project_name, sections, meta, None)
    except Exception as e:
        logger.error(f"[StatusReport] PDF render failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {e}")

    total_count = sum(len(s["rows"]) for s in sections.values())
    multi_project = scope_label.startswith(tuple(str(n) + " projects" for n in range(2, 100)))
    scope_for_name = "MultiProject" if multi_project else project_name
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in scope_for_name)
    date_stamp = datetime.utcnow().strftime("%Y-%m-%d_%H%MUTC")
    filename = f"QC_Status_Report_{safe_name}_{date_stamp}_{total_count}deliverables.pdf"
    logger.info(f"[StatusReport] PDF generated: {len(pdf_bytes)} bytes, file={filename}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── AI Analysis ───────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    """Return feature flags for the frontend."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    return {
        "ai_enabled": bool(api_key),
        # Git-linkage drift badges. Default on; set DRIFT_ENABLED=0 to hide.
        # Frontend also honors a ?drift=1 / ?drift=0 query override.
        "drift_enabled": os.environ.get("DRIFT_ENABLED", "1") != "0",
    }


@app.post("/api/analyze-findings")
async def analyze_findings(body: dict):
    """Use Claude to cluster open QC findings by root cause and produce a prioritized resolution plan."""
    try:
        import anthropic as _anthropic
    except ImportError:
        raise HTTPException(status_code=503, detail="anthropic package not installed — run: pip install anthropic>=0.25.0")

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Claude integration not configured — set ANTHROPIC_API_KEY in environment.",
        )

    model = os.environ.get("CLAUDE_MODEL", "claude-3-5-sonnet-20241022")
    project_name = body.get("projectName", "Unknown Project")
    findings = body.get("findings", [])

    if not findings:
        raise HTTPException(status_code=400, detail="No findings provided.")

    ts = datetime.utcnow().isoformat() + "Z"
    prompt = (
        f'You are a clinical trial QC analyst. Analyze the following open QC findings for the study "{project_name}" '
        f"and return a structured JSON report.\n\nFindings (JSON):\n{json.dumps(findings, indent=2)}\n\n"
        "Return ONLY a valid JSON object (no markdown fences, no explanation) in exactly this shape:\n"
        '{\n'
        '  "clusters": [\n'
        '    {\n'
        '      "theme": "string — root cause theme name",\n'
        '      "count": <integer>,\n'
        '      "findingIds": ["id1", "id2"],\n'
        '      "priority": <integer 1-N where 1 = highest priority>,\n'
        '      "rationale": "string — why this theme is high priority"\n'
        '    }\n'
        '  ],\n'
        '  "quickWins": [\n'
        '    {\n'
        '      "findingId": "string",\n'
        '      "reason": "string — why this can be resolved quickly"\n'
        '    }\n'
        '  ],\n'
        '  "overdueSummary": "string — 2-3 sentences summarizing overdue risk and recommended next action",\n'
        f'  "generatedAt": "{ts}"\n'
        '}'
    )

    raw = ""
    try:
        client = _anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=model,
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:].strip()
        result = json.loads(raw)
        result["generatedAt"] = ts
        logger.info(f"[AnalyzeFindings] project={project_name} clusters={len(result.get('clusters', []))} quickWins={len(result.get('quickWins', []))}")
        return result
    except json.JSONDecodeError as e:
        logger.error(f"[AnalyzeFindings] JSON parse failed: {e} | raw[:200]={raw[:200]}")
        return {"error": "parse_failed", "raw": raw[:2000]}
    except Exception as e:
        logger.error(f"[AnalyzeFindings] Claude call failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


@app.post("/api/bundles/{bundle_id}/explain")
async def explain_bundle(bundle_id: str, body: dict):
    """Narrate, in plain English for a study lead, everything that happened on
    this deliverable: what each agent did, what was found, why (root cause if
    available), what changed, the recommendation, and what the human must
    decide. The frontend passes the already-loaded evidence + optional
    root-cause JSON so we don't re-fetch."""
    try:
        import anthropic as _anthropic
    except ImportError:
        raise HTTPException(status_code=503, detail="anthropic package not installed")
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="Claude integration not configured — set ANTHROPIC_API_KEY in environment.")

    model = os.environ.get("CLAUDE_MODEL", "claude-3-5-sonnet-20241022")
    bundle_name = body.get("bundleName", "this deliverable")
    stages = body.get("stages", [])
    rootcause = body.get("rootcause")
    attachments = body.get("attachments", [])
    ts = datetime.utcnow().isoformat() + "Z"

    prompt = (
        "You are explaining a governed clinical-trial QC workflow to a busy study lead who is NOT technical.\n"
        f'Deliverable: "{bundle_name}".\n\n'
        "Below is the full evidence trail captured on the governance bundle — each stage, what was answered, "
        "and which values an automated agent populated (author contains 'agent', or marked agent-populated).\n\n"
        f"STAGES + EVIDENCE (JSON):\n{json.dumps(stages, indent=2)[:12000]}\n\n"
    )
    if rootcause:
        prompt += f"ROOT-CAUSE ANALYSIS (JSON, from the root-cause agent):\n{json.dumps(rootcause, indent=2)[:6000]}\n\n"
    if attachments:
        prompt += f"ATTACHMENTS ON THE BUNDLE:\n{json.dumps(attachments, indent=2)[:2000]}\n\n"
    prompt += (
        "Write a clear plain-English narrative (markdown: short bold section headers, short paragraphs, bullets "
        "where useful; ~250-400 words). Use these sections:\n"
        "**What happened** — the journey through the stages in order.\n"
        "**What the agents found** — the key QC result/discrepancy in concrete terms.\n"
        "**Why it differs** — the root cause, tied to the code, if available.\n"
        "**What changed** — any fix/commit the agent proposed or made.\n"
        "**Recommendation & your decision** — what the agent recommends and exactly what the study lead must accept/reject.\n\n"
        "Be specific (cite the actual numbers/values). Do not invent facts not present above. No preamble."
    )

    try:
        client = _anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=model,
            max_tokens=1600,
            messages=[{"role": "user", "content": prompt}],
        )
        narrative = message.content[0].text.strip()
        logger.info(f"[ExplainBundle] bundle={bundle_id} stages={len(stages)} hasRootcause={bool(rootcause)}")
        return {"narrative": narrative, "generatedAt": ts}
    except Exception as e:
        logger.error(f"[ExplainBundle] Claude call failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Explain failed: {e}")


# ── Static files & SPA ────────────────────────────────────────────

# Prevent browser from caching static assets during development — ensures
# changes to app.js / styles.css / mock_data.js are picked up on every reload.
class NoCacheStaticMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheStaticMiddleware)

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def serve_index():
    resp = FileResponse("static/index.html")
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp
