import os
import logging
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

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
    return gov_get("/bundles", params=params)


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


# ── Stage Reassignment ───────────────────────────────────────────

@app.patch("/api/bundles/{bundle_id}/stages/{stage_id}")
def patch_bundle_stage(bundle_id: str, stage_id: str, body: dict):
    """Reassign a stage owner. Body: {"assignee": {"id": "userId"}}

    After the PATCH, re-reads the bundle from Domino to verify the
    assignment actually persisted.  Returns the verified stage data
    with a ``verified`` flag so the frontend knows the read-back
    succeeded.
    """
    patch_resp = gov_patch(f"/bundles/{bundle_id}/stages/{stage_id}", json_body=body)

    # ── Read-back verification ───────────────────────────────────
    requested_id = (body.get("assignee") or {}).get("id") if body.get("assignee") else None
    try:
        bundle = gov_get(f"/bundles/{bundle_id}")
        stages = bundle.get("stages") or []
        matched = None
        for s in stages:
            sid = s.get("stageId") or (s.get("stage") or {}).get("id")
            if sid == stage_id:
                matched = s
                break

        if matched is not None:
            actual_id = (matched.get("assignee") or {}).get("id") if matched.get("assignee") else None
            if actual_id == requested_id:
                patch_resp["verified"] = True
            else:
                logger.warning(
                    f"Assignment verification mismatch for bundle={bundle_id} "
                    f"stage={stage_id}: requested={requested_id}, actual={actual_id}"
                )
                patch_resp["verified"] = False
                patch_resp["actualAssignee"] = matched.get("assignee")
        else:
            logger.warning(f"Verification: stage {stage_id} not found in bundle {bundle_id}")
            patch_resp["verified"] = False
    except Exception as e:
        logger.warning(f"Assignment verification read-back failed: {e}")
        patch_resp["verified"] = None  # indeterminate — PATCH succeeded but verify failed

    return patch_resp


# ── Attachment Overviews ──────────────────────────────────────────

@app.get("/api/attachment-overviews")
def list_attachment_overviews(limit: int = 200, offset: int = 0):
    params = {"limit": limit, "offset": offset}
    return gov_get("/attachment-overviews", params=params)


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


# ── Project Collaborators ─────────────────────────────────────────

@app.get("/api/projects/{project_id}/collaborators")
def list_project_collaborators(project_id: str):
    return v4_get(f"/projects/{project_id}/collaborators")


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


# ── Static files & SPA ────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def serve_index():
    return FileResponse("static/index.html")
