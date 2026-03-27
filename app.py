import os
import logging
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

load_dotenv()

app = FastAPI()
logger = logging.getLogger("app")
logging.basicConfig(level=logging.INFO)


def get_domino_host():
    host = os.environ.get("DOMINO_API_HOST", "")
    return host.rstrip("/")


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
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    url = f"{host}/api/governance/v1{path}"

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
    host = get_domino_host()
    if not host:
        raise HTTPException(status_code=503, detail="DOMINO_API_HOST not set")
    url = f"{host}/api/governance/v1{path}"

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


# ── Attachment Overviews ──────────────────────────────────────────

@app.get("/api/attachment-overviews")
def list_attachment_overviews(limit: int = 200, offset: int = 0):
    params = {"limit": limit, "offset": offset}
    return gov_get("/attachment-overviews", params=params)


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

    # List all DOMINO_* env vars (names only, not values)
    domino_vars = sorted([k for k in os.environ if k.startswith("DOMINO")])

    # Test governance API connectivity
    gov_test = {}
    host = get_domino_host()
    if host and sidecar_token:
        test_url = f"{host}/api/governance/v1/bundles?limit=1"
        token_val = sidecar_token.replace("...", "")  # Don't use truncated token
        # Re-fetch full token for testing
        try:
            full_resp = requests.get("http://localhost:8899/access-token", timeout=3)
            full_token = full_resp.text.strip()
            if full_token.startswith("Bearer "):
                full_token = full_token[len("Bearer "):]

            # Test X-Domino-Api-Key
            r1 = requests.get(test_url, headers={"X-Domino-Api-Key": full_token}, timeout=10)
            gov_test["X-Domino-Api-Key"] = {"status": r1.status_code, "body_preview": r1.text[:200]}

            # Test Bearer
            r2 = requests.get(test_url, headers={"Authorization": f"Bearer {full_token}"}, timeout=10)
            gov_test["Bearer"] = {"status": r2.status_code, "body_preview": r2.text[:200]}

            # Test v4 (should work with Bearer)
            v4_url = f"{host}/v4/users/self"
            r3 = requests.get(v4_url, headers={"Authorization": f"Bearer {full_token}"}, timeout=10)
            gov_test["v4_Bearer"] = {"status": r3.status_code, "body_preview": r3.text[:200]}
        except Exception as e:
            gov_test["error"] = str(e)

    return {
        "has_API_KEY_OVERRIDE": has_override,
        "has_DOMINO_USER_API_KEY": has_user_key,
        "has_DOMINO_API_HOST": has_host,
        "domino_host": get_domino_host() or "(not set)",
        "sidecar_token_preview": sidecar_token,
        "sidecar_raw_preview": sidecar_raw,
        "domino_env_vars": domino_vars,
        "governance_test": gov_test,
    }


# ── Static files & SPA ────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def serve_index():
    return FileResponse("static/index.html")
