"""
Automated tests for Data Explorer URL discovery and deep-linking.

Covers:
  - Beta Apps API response parsing ("items", "data", "apps" keys, bare list)
  - App name matching (case-insensitive, underscores, no spaces)
  - Vanity URL preference over internal URL / app ID fallback
  - DATA_EXPLORER_URL env var override
  - Cache behavior (probed flag)
  - No host configured
  - API failure / non-200 responses
  - No matching app in list

Run:  pytest test_data_explorer_discovery.py -v
"""

import os
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

os.environ.setdefault("DOMINO_API_HOST", "https://mock-domino.example.com")
os.environ.setdefault("API_KEY_OVERRIDE", "test-api-key-123")

from app import app, _data_explorer_cache, _external_host_cache  # noqa: E402

client = TestClient(app)

HOST = "https://mock-domino.example.com"


# ── Helpers ───────────────────────────────────────────────────────

def _reset_cache():
    """Reset the discovery cache before each test."""
    _data_explorer_cache["url"] = None
    _data_explorer_cache["probed"] = False


def _make_app(name, vanity_url=None, url=None, app_id=None, status="Running"):
    """Build a fake Beta Apps API app entry."""
    entry = {"name": name}
    if vanity_url:
        entry["vanityUrl"] = vanity_url
    if url:
        entry["url"] = url
    if app_id:
        entry["id"] = app_id
    entry["currentVersion"] = {"currentInstance": {"status": status}}
    return entry


def _mock_beta_apps_response(apps_list, wrapper_key="items"):
    """Build a mock requests.Response for the Beta Apps API."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    if wrapper_key:
        mock_resp.json.return_value = {wrapper_key: apps_list}
    else:
        mock_resp.json.return_value = apps_list
    return mock_resp


# ── Tests: API response parsing ───────────────────────────────────

class TestResponseParsing:
    """The Beta Apps API may wrap the app list under different keys."""

    def test_items_key(self):
        """Real-world format: apps under 'items' key."""
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Clinical Data Explorer", vanity_url="abc-123"),
        ], wrapper_key="items")
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] == f"{HOST}/apps/abc-123/"

    def test_data_key(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Data Explorer", vanity_url="def-456"),
        ], wrapper_key="data")
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] == f"{HOST}/apps/def-456/"

    def test_apps_key(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Data Explorer", vanity_url="ghi-789"),
        ], wrapper_key="apps")
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] == f"{HOST}/apps/ghi-789/"

    def test_bare_list(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Data Explorer App", vanity_url="bare-list"),
        ], wrapper_key=None)
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] == f"{HOST}/apps/bare-list/"


# ── Tests: Name matching ──────────────────────────────────────────

class TestNameMatching:

    def test_clinical_data_explorer(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Clinical Data Explorer", vanity_url="v1"),
        ])
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] is not None

    def test_data_explorer_uppercase(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("DATA EXPLORER", vanity_url="v2"),
        ])
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] is not None

    def test_data_underscore_explorer(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("data_explorer_v2", vanity_url="v3"),
        ])
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] is not None

    def test_dataexplorer_no_space(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("MyDataExplorer", vanity_url="v4"),
        ])
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] is not None

    def test_no_match(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("RWE Cohort Analysis", vanity_url="rwe"),
            _make_app("YAML Flow Builder", vanity_url="flow"),
            _make_app("Usage Trends", vanity_url="usage"),
        ])
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] is None

    def test_picks_first_match(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("RWE Cohort Analysis", vanity_url="rwe"),
            _make_app("Clinical Data Explorer", vanity_url="first-match"),
            _make_app("Old Data Explorer", vanity_url="second-match"),
        ])
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] == f"{HOST}/apps/first-match/"


# ── Tests: URL construction ───────────────────────────────────────

class TestUrlConstruction:

    def test_vanity_url_preferred(self):
        """Vanity URL should be used to build the public /apps/ path."""
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Data Explorer",
                       vanity_url="7e397c77-2004-4f22-9001-64789bc1defc",
                       url="https://domino.example.com/apps-internal/abc123/",
                       app_id="abc123"),
        ])
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        url = r.json()["url"]
        assert "/apps/7e397c77-2004-4f22-9001-64789bc1defc/" in url
        assert "apps-internal" not in url

    def test_fallback_to_url_field(self):
        """When no vanityUrl, fall back to the url field."""
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Data Explorer",
                       url="https://domino.example.com/apps-internal/abc123/"),
        ])
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] == "https://domino.example.com/apps-internal/abc123/"

    def test_fallback_to_app_id(self):
        """When no vanityUrl or url, construct from app ID."""
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Data Explorer", app_id="abc123"),
        ])
        with patch("app.requests.get", return_value=resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] == f"{HOST}/apps/abc123/"

    def test_external_host_used_for_vanity(self):
        """When external host is captured, use it instead of DOMINO_API_HOST."""
        _reset_cache()
        old_host = _external_host_cache.get("host")
        _external_host_cache["host"] = "https://life-sciences-demo.domino-eval.com"
        try:
            resp = _mock_beta_apps_response([
                _make_app("Data Explorer", vanity_url="my-vanity"),
            ])
            with patch("app.requests.get", return_value=resp):
                r = client.get("/api/data-explorer-url")
            assert r.json()["url"] == "https://life-sciences-demo.domino-eval.com/apps/my-vanity/"
        finally:
            _external_host_cache["host"] = old_host


# ── Tests: Env var override ───────────────────────────────────────

class TestEnvVarOverride:

    def test_env_var_takes_priority(self):
        _reset_cache()
        with patch.dict(os.environ, {"DATA_EXPLORER_URL": "https://custom.example.com/data-explorer"}):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] == "https://custom.example.com/data-explorer"

    def test_empty_env_var_ignored(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Data Explorer", vanity_url="from-api"),
        ])
        with patch.dict(os.environ, {"DATA_EXPLORER_URL": "  "}):
            with patch("app.requests.get", return_value=resp):
                r = client.get("/api/data-explorer-url")
        assert r.json()["url"] == f"{HOST}/apps/from-api/"


# ── Tests: Cache behavior ─────────────────────────────────────────

class TestCacheBehavior:

    def test_second_call_uses_cache(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Data Explorer", vanity_url="cached"),
        ])
        with patch("app.requests.get", return_value=resp) as mock_get:
            client.get("/api/data-explorer-url")
            # Second call should use cache, not call API again
            with patch.dict(os.environ, {}, clear=False):
                r2 = client.get("/api/data-explorer-url")
        assert r2.json()["url"] == f"{HOST}/apps/cached/"
        # requests.get should have been called only once
        assert mock_get.call_count == 1

    def test_cache_stores_null_on_no_match(self):
        _reset_cache()
        resp = _mock_beta_apps_response([
            _make_app("Unrelated App", vanity_url="nope"),
        ])
        with patch("app.requests.get", return_value=resp) as mock_get:
            r1 = client.get("/api/data-explorer-url")
            r2 = client.get("/api/data-explorer-url")
        assert r1.json()["url"] is None
        assert r2.json()["url"] is None
        assert mock_get.call_count == 1


# ── Tests: Error handling ─────────────────────────────────────────

class TestErrorHandling:

    def test_api_returns_500(self):
        _reset_cache()
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        with patch("app.requests.get", return_value=mock_resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] is None

    def test_api_throws_exception(self):
        _reset_cache()
        with patch("app.requests.get", side_effect=Exception("Connection refused")):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] is None

    def test_no_host_configured(self):
        _reset_cache()
        with patch.dict(os.environ, {"DOMINO_API_HOST": "", "DOMINO_API_PROXY": ""}):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] is None


# ── Tests: Real-world payload (from life-sciences-demo) ───────────

class TestRealWorldPayload:
    """Test against a payload shaped like the actual Beta Apps API response."""

    REAL_APPS = [
        {"id": "696513f1", "name": "Veeva CDB Study Import", "vanityUrl": "f8eee1ce", "url": "https://domino.example.com/apps-internal/696513f1/"},
        {"id": "6965199c", "name": "RWE Cohort Analysis", "vanityUrl": "47286009", "url": "https://domino.example.com/apps-internal/6965199c/"},
        {"id": "6972b5ac", "name": "Clinical Data Explorer", "vanityUrl": "7e397c77-2004-4f22-9001-64789bc1defc", "url": "https://domino.example.com/apps-internal/6972b5ac/"},
        {"id": "697cffe4", "name": "YAML Flow Builder App", "vanityUrl": "b0c747a2", "url": "https://domino.example.com/apps-internal/697cffe4/"},
        {"id": "698cef33", "name": "Usage Trends", "vanityUrl": "usagepatterns", "url": "https://domino.example.com/apps-internal/698cef33/"},
    ]

    def test_finds_clinical_data_explorer(self):
        _reset_cache()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"items": self.REAL_APPS, "metadata": {"totalCount": 5}}
        with patch("app.requests.get", return_value=mock_resp):
            r = client.get("/api/data-explorer-url")
        assert "7e397c77-2004-4f22-9001-64789bc1defc" in r.json()["url"]
        assert "apps-internal" not in r.json()["url"]

    def test_skips_non_explorer_apps(self):
        _reset_cache()
        non_explorer = [a for a in self.REAL_APPS if "explorer" not in a["name"].lower()]
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"items": non_explorer}
        with patch("app.requests.get", return_value=mock_resp):
            r = client.get("/api/data-explorer-url")
        assert r.json()["url"] is None
