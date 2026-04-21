import os
import io
import json
import logging
import time
import requests
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
    return {"ai_enabled": bool(api_key)}


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
