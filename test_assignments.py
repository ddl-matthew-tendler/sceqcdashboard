"""
Automated tests for assignment functionality (single + bulk).

Covers:
  - Single stage reassignment (assign, reassign, unassign)
  - Read-back verification (verified flag)
  - Bulk assignment (multiple bundles, partial failures, all fail)
  - Verification mismatch detection
  - Collaborator listing
  - Auth / host resolution edge cases
  - Request body validation

Run:  pytest test_assignments.py -v
"""

import os
import pytest
from unittest.mock import patch, MagicMock, call
from fastapi.testclient import TestClient
from fastapi import HTTPException

# Set env vars BEFORE importing app so the module picks them up
os.environ.setdefault("DOMINO_API_HOST", "https://mock-domino.example.com")
os.environ.setdefault("API_KEY_OVERRIDE", "test-api-key-123")

from app import app, _gov_host_cache  # noqa: E402

client = TestClient(app)


# ── Fixtures ──────────────────────────────────────────────────────

BUNDLE_A = "bundle-aaa-111"
BUNDLE_B = "bundle-bbb-222"
BUNDLE_C = "bundle-ccc-333"
STAGE_1 = "stage-self-qc"
STAGE_2 = "stage-double-prog"
STAGE_3 = "stage-review"
USER_ALICE = {"id": "user-alice-001", "name": "alice_domino", "firstName": "Alice", "lastName": "Smith"}
USER_BOB = {"id": "user-bob-002", "name": "bob_domino", "firstName": "Bob", "lastName": "Jones"}
PROJECT_ID = "proj-cdisc-001"


def _make_stage_response(stage_id, assignee=None):
    """Helper: build a stage response as Domino governance would return from PATCH."""
    return {
        "stageId": stage_id,
        "stage": {"id": stage_id, "name": stage_id.replace("-", " ").title()},
        "assignee": assignee,
        "assignedAt": "2026-03-28T10:30:00Z" if assignee else None,
    }


def _make_bundle_with_stages(bundle_id, stages_with_assignees):
    """Helper: build a bundle response for the read-back GET.

    stages_with_assignees: list of (stage_id, assignee_or_None)
    """
    return {
        "id": bundle_id,
        "name": f"Bundle {bundle_id}",
        "stages": [
            {
                "stageId": sid,
                "stage": {"id": sid, "name": sid.replace("-", " ").title()},
                "assignee": assignee,
            }
            for sid, assignee in stages_with_assignees
        ],
    }


@pytest.fixture(autouse=True)
def _reset_caches():
    """Reset module-level caches between tests."""
    _gov_host_cache["host"] = "https://mock-domino.example.com"
    _gov_host_cache["probed"] = True
    yield
    _gov_host_cache["host"] = None
    _gov_host_cache["probed"] = False


# ══════════════════════════════════════════════════════════════════
#  SINGLE ASSIGNMENT TESTS
# ══════════════════════════════════════════════════════════════════

class TestSingleAssignment:
    """Tests for PATCH /api/bundles/{bundle_id}/stages/{stage_id}"""

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_assign_user_to_stage(self, mock_patch, mock_get):
        """Assign Alice to a stage — verified via read-back."""
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_1, USER_ALICE),
        ])

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["assignee"]["id"] == USER_ALICE["id"]
        assert data["verified"] is True

        # Verify upstream calls
        mock_patch.assert_called_once_with(
            f"/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json_body={"assignee": {"id": USER_ALICE["id"]}},
        )
        mock_get.assert_called_once_with(f"/bundles/{BUNDLE_A}")

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_reassign_stage_to_different_user(self, mock_patch, mock_get):
        """Reassign a stage from Alice to Bob."""
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_BOB)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_1, USER_BOB),
        ])

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_BOB["id"]}},
        )
        assert resp.status_code == 200
        assert resp.json()["assignee"]["id"] == USER_BOB["id"]
        assert resp.json()["verified"] is True

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_unassign_stage(self, mock_patch, mock_get):
        """Unassign a stage by sending assignee: null."""
        mock_patch.return_value = _make_stage_response(STAGE_1, None)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_1, None),
        ])

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": None},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["assignee"] is None
        assert data["verified"] is True

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_unassign_domino_returns_empty_string_id(self, mock_patch, mock_get):
        """Regression: Domino returns assignee.id='' (not null) after unassign.

        Before fix: verification compared '' == None → False → showed error.
        After fix:  both falsy → verified: True.
        """
        patch_resp = {
            "bundleId": BUNDLE_A, "stageId": STAGE_1,
            "stage": {"id": STAGE_1}, "assignee": {"id": ""}, "assignedAt": None,
        }
        mock_patch.return_value = patch_resp
        # Domino read-back returns assignee.id="" — the actual observed behaviour
        bundle_with_empty_string = {
            "id": BUNDLE_A,
            "stages": [{"stageId": STAGE_1, "stage": {"id": STAGE_1}, "assignee": {"id": ""}}],
        }
        mock_get.return_value = bundle_with_empty_string

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": None},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["verified"] is True, (
            "Empty-string assignee id from Domino should be treated as unassigned"
        )

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_unassign_uses_empty_body_first(self, mock_patch, mock_get):
        """Empty-body payload {} (what Domino's own UI sends) is tried first."""
        patch_resp = {
            "bundleId": BUNDLE_A, "stageId": STAGE_1,
            "stage": {"id": STAGE_1}, "assignee": {"id": ""}, "assignedAt": None,
        }
        mock_patch.return_value = patch_resp
        mock_get.return_value = {
            "id": BUNDLE_A,
            "stages": [{"stageId": STAGE_1, "stage": {"id": STAGE_1}, "assignee": {"id": ""}}],
        }

        client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": None},
        )

        first_call_kwargs = mock_patch.call_args_list[0]
        assert first_call_kwargs == call(
            f"/bundles/{BUNDLE_A}/stages/{STAGE_1}", json_body={}
        ), "First unassign attempt must use the empty-body payload {}"

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_unassign_stops_after_first_working_format(self, mock_patch, mock_get):
        """Once a format's quick-check confirms the stage is unassigned, no further formats are tried."""
        patch_resp = {
            "bundleId": BUNDLE_A, "stageId": STAGE_1,
            "stage": {"id": STAGE_1}, "assignee": {"id": ""}, "assignedAt": None,
        }
        mock_patch.return_value = patch_resp
        mock_get.return_value = {
            "id": BUNDLE_A,
            "stages": [{"stageId": STAGE_1, "stage": {"id": STAGE_1}, "assignee": {"id": ""}}],
        }

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": None},
        )
        assert resp.status_code == 200
        assert resp.json()["verified"] is True
        # Empty-body {} worked on first try — only one PATCH should have been sent
        assert mock_patch.call_count == 1, (
            f"Expected 1 PATCH (empty-body worked), got {mock_patch.call_count}"
        )

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_assign_different_stages_same_bundle(self, mock_patch, mock_get):
        """Assign different users to different stages of the same bundle."""
        # First call: assign Alice to STAGE_1
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_1, USER_ALICE), (STAGE_2, None),
        ])
        resp1 = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )

        # Second call: assign Bob to STAGE_2
        mock_patch.return_value = _make_stage_response(STAGE_2, USER_BOB)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_1, USER_ALICE), (STAGE_2, USER_BOB),
        ])
        resp2 = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_2}",
            json={"assignee": {"id": USER_BOB["id"]}},
        )

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp1.json()["verified"] is True
        assert resp2.json()["verified"] is True

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_assign_same_user_to_multiple_bundles(self, mock_patch, mock_get):
        """Same user assigned to the same stage type across different bundles."""
        for bundle_id in [BUNDLE_A, BUNDLE_B, BUNDLE_C]:
            mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
            mock_get.return_value = _make_bundle_with_stages(bundle_id, [
                (STAGE_1, USER_ALICE),
            ])
            resp = client.patch(
                f"/api/bundles/{bundle_id}/stages/{STAGE_1}",
                json={"assignee": {"id": USER_ALICE["id"]}},
            )
            assert resp.status_code == 200
            assert resp.json()["verified"] is True
        assert mock_patch.call_count == 3

    @patch("app.gov_patch", side_effect=HTTPException(status_code=404, detail="Bundle not found"))
    def test_assign_nonexistent_bundle(self, mock_patch):
        """Assignment to a non-existent bundle returns 404."""
        resp = client.patch(
            "/api/bundles/nonexistent-bundle/stages/some-stage",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        assert resp.status_code == 404

    @patch("app.gov_patch", side_effect=HTTPException(status_code=404, detail="Stage not found"))
    def test_assign_nonexistent_stage(self, mock_patch):
        """Assignment to a non-existent stage returns 404."""
        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/nonexistent-stage",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        assert resp.status_code == 404

    @patch("app.gov_patch", side_effect=HTTPException(status_code=400, detail="Invalid user ID"))
    def test_assign_invalid_user_id(self, mock_patch):
        """Assignment with a bad user ID returns 400."""
        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": ""}},
        )
        assert resp.status_code == 400

    @patch("app.gov_patch", side_effect=HTTPException(status_code=500, detail="Internal server error"))
    def test_assign_upstream_500(self, mock_patch):
        """Upstream 500 is propagated correctly."""
        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        assert resp.status_code == 500

    @patch("app.gov_patch", side_effect=HTTPException(status_code=403, detail="Forbidden"))
    def test_assign_forbidden(self, mock_patch):
        """User without permission gets 403."""
        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        assert resp.status_code == 403

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_request_body_forwarded_correctly(self, mock_patch, mock_get):
        """Verify the exact JSON body is forwarded to gov_patch."""
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [(STAGE_1, USER_ALICE)])

        body = {"assignee": {"id": USER_ALICE["id"]}}
        client.patch(f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}", json=body)
        mock_patch.assert_called_once_with(
            f"/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json_body=body,
        )

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_empty_body(self, mock_patch, mock_get):
        """Sending an empty body still reaches the upstream."""
        mock_patch.return_value = _make_stage_response(STAGE_1, None)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [(STAGE_1, None)])

        resp = client.patch(f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}", json={})
        assert resp.status_code == 200

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_response_includes_stage_metadata_and_verified(self, mock_patch, mock_get):
        """Verify response includes stageId, stage, assignee, assignedAt, verified."""
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [(STAGE_1, USER_ALICE)])

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        data = resp.json()
        assert "stageId" in data
        assert "stage" in data
        assert "assignee" in data
        assert "assignedAt" in data
        assert "verified" in data


# ══════════════════════════════════════════════════════════════════
#  READ-BACK VERIFICATION TESTS
# ══════════════════════════════════════════════════════════════════

class TestVerification:
    """Tests for the post-PATCH read-back verification logic."""

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_verified_true_when_domino_matches(self, mock_patch, mock_get):
        """verified=True when read-back assignee matches what we sent."""
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_1, USER_ALICE),
        ])

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        assert resp.json()["verified"] is True

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_verified_false_when_domino_has_different_user(self, mock_patch, mock_get):
        """verified=False when Domino still shows a different assignee."""
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        # Read-back shows Bob instead of Alice
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_1, USER_BOB),
        ])

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        data = resp.json()
        assert data["verified"] is False
        assert data["actualAssignee"]["id"] == USER_BOB["id"]

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_verified_false_when_unassign_didnt_stick(self, mock_patch, mock_get):
        """verified=False when we tried to unassign but Domino still shows someone."""
        mock_patch.return_value = _make_stage_response(STAGE_1, None)
        # Read-back still shows Alice
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_1, USER_ALICE),
        ])

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": None},
        )
        data = resp.json()
        assert data["verified"] is False
        assert data["actualAssignee"]["id"] == USER_ALICE["id"]

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_verified_false_when_assign_shows_unassigned(self, mock_patch, mock_get):
        """verified=False when we assigned Alice but Domino shows unassigned."""
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        # Read-back shows no assignee
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_1, None),
        ])

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        data = resp.json()
        assert data["verified"] is False

    @patch("app.gov_get", side_effect=Exception("Read-back network error"))
    @patch("app.gov_patch")
    def test_verified_null_when_readback_fails(self, mock_patch, mock_get):
        """verified=None (indeterminate) when the read-back GET fails."""
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        data = resp.json()
        assert data["verified"] is None  # PATCH OK, but couldn't verify

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_verified_false_when_stage_not_in_bundle(self, mock_patch, mock_get):
        """verified=False when the read-back bundle doesn't contain the stage."""
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        # Bundle has different stages — STAGE_1 is missing
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_2, USER_BOB),
            (STAGE_3, None),
        ])

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        assert resp.json()["verified"] is False

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_verified_true_unassign_confirmed(self, mock_patch, mock_get):
        """verified=True when unassign is confirmed by read-back."""
        mock_patch.return_value = _make_stage_response(STAGE_1, None)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [
            (STAGE_1, None),
        ])

        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": None},
        )
        assert resp.json()["verified"] is True

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_readback_uses_correct_bundle_id(self, mock_patch, mock_get):
        """Read-back GET is called with the correct bundle ID."""
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_B, [(STAGE_1, USER_ALICE)])

        client.patch(
            f"/api/bundles/{BUNDLE_B}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        mock_get.assert_called_once_with(f"/bundles/{BUNDLE_B}")


# ══════════════════════════════════════════════════════════════════
#  BULK ASSIGNMENT TESTS (sequential PATCH calls, one per stage)
# ══════════════════════════════════════════════════════════════════

class TestBulkAssignment:
    """
    Bulk assignments are done client-side by issuing one PATCH per stage.
    These tests simulate the same pattern at the API level to verify
    behavior when multiple sequential calls are made.
    """

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_bulk_assign_all_succeed_and_verified(self, mock_patch, mock_get):
        """Assign Alice to 3 stages — all succeed and all verified."""
        targets = [
            (BUNDLE_A, STAGE_1),
            (BUNDLE_B, STAGE_2),
            (BUNDLE_C, STAGE_3),
        ]
        results = []
        for bundle_id, stage_id in targets:
            mock_patch.return_value = _make_stage_response(stage_id, USER_ALICE)
            mock_get.return_value = _make_bundle_with_stages(bundle_id, [
                (stage_id, USER_ALICE),
            ])
            resp = client.patch(
                f"/api/bundles/{bundle_id}/stages/{stage_id}",
                json={"assignee": {"id": USER_ALICE["id"]}},
            )
            results.append(resp)

        assert all(r.status_code == 200 for r in results)
        assert all(r.json()["verified"] is True for r in results)

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_bulk_assign_some_verified_some_not(self, mock_patch, mock_get):
        """3 assignments: 2 verified, 1 mismatch detected."""
        # Stage 1: Alice assigned and verified
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [(STAGE_1, USER_ALICE)])
        r1 = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )

        # Stage 2: Alice assigned but Domino shows Bob (mismatch!)
        mock_patch.return_value = _make_stage_response(STAGE_2, USER_ALICE)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_B, [(STAGE_2, USER_BOB)])
        r2 = client.patch(
            f"/api/bundles/{BUNDLE_B}/stages/{STAGE_2}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )

        # Stage 3: Alice assigned and verified
        mock_patch.return_value = _make_stage_response(STAGE_3, USER_ALICE)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_C, [(STAGE_3, USER_ALICE)])
        r3 = client.patch(
            f"/api/bundles/{BUNDLE_C}/stages/{STAGE_3}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )

        assert r1.json()["verified"] is True
        assert r2.json()["verified"] is False
        assert r2.json()["actualAssignee"]["id"] == USER_BOB["id"]
        assert r3.json()["verified"] is True

    def test_bulk_assign_partial_failure(self):
        """2 of 3 stages succeed, 1 fails at the PATCH level."""
        results = []

        # Stage 1: succeeds
        with patch("app.gov_patch") as mp, patch("app.gov_get") as mg:
            mp.return_value = _make_stage_response(STAGE_1, USER_ALICE)
            mg.return_value = _make_bundle_with_stages(BUNDLE_A, [(STAGE_1, USER_ALICE)])
            r = client.patch(
                f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
                json={"assignee": {"id": USER_ALICE["id"]}},
            )
            results.append((STAGE_1, r))

        # Stage 2: PATCH fails 500
        with patch("app.gov_patch", side_effect=HTTPException(status_code=500, detail="fail")):
            r = client.patch(
                f"/api/bundles/{BUNDLE_A}/stages/{STAGE_2}",
                json={"assignee": {"id": USER_ALICE["id"]}},
            )
            results.append((STAGE_2, r))

        # Stage 3: succeeds
        with patch("app.gov_patch") as mp, patch("app.gov_get") as mg:
            mp.return_value = _make_stage_response(STAGE_3, USER_ALICE)
            mg.return_value = _make_bundle_with_stages(BUNDLE_A, [(STAGE_3, USER_ALICE)])
            r = client.patch(
                f"/api/bundles/{BUNDLE_A}/stages/{STAGE_3}",
                json={"assignee": {"id": USER_ALICE["id"]}},
            )
            results.append((STAGE_3, r))

        succeeded = [(sid, r) for sid, r in results if r.status_code == 200]
        failed = [(sid, r) for sid, r in results if r.status_code != 200]
        assert len(succeeded) == 2
        assert len(failed) == 1
        assert failed[0][0] == STAGE_2

    @patch("app.gov_patch", side_effect=HTTPException(status_code=500, detail="Server down"))
    def test_bulk_assign_all_fail(self, mock_patch):
        """All 3 assignments fail — each returns 500."""
        results = []
        for bundle_id in [BUNDLE_A, BUNDLE_B, BUNDLE_C]:
            resp = client.patch(
                f"/api/bundles/{bundle_id}/stages/{STAGE_1}",
                json={"assignee": {"id": USER_ALICE["id"]}},
            )
            results.append(resp)
        assert all(r.status_code == 500 for r in results)

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_bulk_unassign_all(self, mock_patch, mock_get):
        """Bulk unassign: set assignee to null for multiple stages."""
        targets = [(BUNDLE_A, STAGE_1), (BUNDLE_B, STAGE_2), (BUNDLE_C, STAGE_3)]
        results = []
        for bundle_id, stage_id in targets:
            mock_patch.return_value = _make_stage_response(stage_id, None)
            mock_get.return_value = _make_bundle_with_stages(bundle_id, [(stage_id, None)])
            resp = client.patch(
                f"/api/bundles/{bundle_id}/stages/{stage_id}",
                json={"assignee": None},
            )
            results.append(resp)

        assert all(r.status_code == 200 for r in results)
        assert all(r.json()["assignee"] is None for r in results)
        assert all(r.json()["verified"] is True for r in results)

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_bulk_assign_then_reassign(self, mock_patch, mock_get):
        """Assign Alice, then reassign all to Bob — verifies no stale state."""
        targets = [(BUNDLE_A, STAGE_1), (BUNDLE_B, STAGE_1)]

        # Round 1: assign Alice
        for bundle_id, stage_id in targets:
            mock_patch.return_value = _make_stage_response(stage_id, USER_ALICE)
            mock_get.return_value = _make_bundle_with_stages(bundle_id, [(stage_id, USER_ALICE)])
            resp = client.patch(
                f"/api/bundles/{bundle_id}/stages/{stage_id}",
                json={"assignee": {"id": USER_ALICE["id"]}},
            )
            assert resp.json()["verified"] is True

        # Round 2: reassign to Bob
        for bundle_id, stage_id in targets:
            mock_patch.return_value = _make_stage_response(stage_id, USER_BOB)
            mock_get.return_value = _make_bundle_with_stages(bundle_id, [(stage_id, USER_BOB)])
            resp = client.patch(
                f"/api/bundles/{bundle_id}/stages/{stage_id}",
                json={"assignee": {"id": USER_BOB["id"]}},
            )
            assert resp.json()["verified"] is True

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_bulk_assign_large_batch(self, mock_patch, mock_get):
        """Simulate a larger bulk operation (20 stages)."""
        results = []
        for i in range(20):
            bid = f"bundle-{i:03d}"
            sid = f"stage-{i:03d}"
            mock_patch.return_value = _make_stage_response(sid, USER_ALICE)
            mock_get.return_value = _make_bundle_with_stages(bid, [(sid, USER_ALICE)])
            resp = client.patch(
                f"/api/bundles/{bid}/stages/{sid}",
                json={"assignee": {"id": USER_ALICE["id"]}},
            )
            results.append(resp)

        assert all(r.status_code == 200 for r in results)
        assert all(r.json()["verified"] is True for r in results)
        assert mock_patch.call_count == 20


# ══════════════════════════════════════════════════════════════════
#  COLLABORATOR / MEMBER LISTING TESTS
# ══════════════════════════════════════════════════════════════════

class TestCollaborators:
    """Tests for GET /api/projects/{project_id}/collaborators"""

    @patch("app.requests.get")
    def test_list_collaborators(self, mock_get):
        """Fetch collaborators for a project."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = [USER_ALICE, USER_BOB]
        mock_get.return_value = mock_resp

        resp = client.get(f"/api/projects/{PROJECT_ID}/collaborators")
        assert resp.status_code == 200
        members = resp.json()
        assert len(members) == 2
        assert members[0]["id"] == USER_ALICE["id"]
        assert members[1]["id"] == USER_BOB["id"]

    @patch("app.requests.get")
    def test_list_collaborators_empty_project(self, mock_get):
        """Project with no collaborators returns empty list."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = []
        mock_get.return_value = mock_resp

        resp = client.get(f"/api/projects/{PROJECT_ID}/collaborators")
        assert resp.status_code == 200
        assert resp.json() == []

    @patch("app.requests.get")
    def test_list_collaborators_nonexistent_project(self, mock_get):
        """Non-existent project returns 404."""
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_resp.text = "Project not found"
        mock_get.return_value = mock_resp

        resp = client.get("/api/projects/nonexistent/collaborators")
        assert resp.status_code == 404


# ══════════════════════════════════════════════════════════════════
#  AUTH / HOST RESOLUTION TESTS
# ══════════════════════════════════════════════════════════════════

class TestAuthAndHost:
    """Tests for auth header selection and host resolution."""

    @patch("app.requests.get")
    @patch("app.requests.patch", side_effect=lambda url, **kw: MagicMock(
        status_code=200,
        json=MagicMock(return_value=_make_stage_response(STAGE_1, USER_ALICE)),
    ))
    def test_api_key_used_when_set(self, mock_patch, mock_get):
        """When API_KEY_OVERRIDE is set, X-Domino-Api-Key header is used for PATCH."""
        # Mock the read-back GET too
        mock_get.return_value = MagicMock(
            status_code=200,
            json=MagicMock(return_value=_make_bundle_with_stages(BUNDLE_A, [(STAGE_1, USER_ALICE)])),
        )
        client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        call_kwargs = mock_patch.call_args[1]
        headers = call_kwargs.get("headers", {})
        assert "X-Domino-Api-Key" in headers
        assert headers["X-Domino-Api-Key"] == "test-api-key-123"

    def test_no_host_returns_503(self):
        """If DOMINO_API_HOST is empty and no gov host cached, return 503."""
        _gov_host_cache["host"] = None
        _gov_host_cache["probed"] = True
        with patch.dict(os.environ, {"DOMINO_API_HOST": "", "API_KEY_OVERRIDE": "key"}):
            with patch("app.get_domino_host", return_value=""):
                with patch("app._get_gov_host", return_value=None):
                    resp = client.patch(
                        f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
                        json={"assignee": {"id": USER_ALICE["id"]}},
                    )
                    assert resp.status_code == 503

    @patch("app.requests.get")
    @patch("app.requests.patch")
    def test_governance_url_constructed_correctly(self, mock_patch, mock_get):
        """Verify the full governance URL is built properly for PATCH."""
        mock_patch.return_value = MagicMock(
            status_code=200,
            json=MagicMock(return_value=_make_stage_response(STAGE_1, USER_ALICE)),
        )
        mock_get.return_value = MagicMock(
            status_code=200,
            json=MagicMock(return_value=_make_bundle_with_stages(BUNDLE_A, [(STAGE_1, USER_ALICE)])),
        )
        client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        called_url = mock_patch.call_args[0][0]
        expected = f"https://mock-domino.example.com/api/governance/v1/bundles/{BUNDLE_A}/stages/{STAGE_1}"
        assert called_url == expected


# ══════════════════════════════════════════════════════════════════
#  CONCURRENT / ORDERING TESTS
# ══════════════════════════════════════════════════════════════════

class TestAssignmentOrdering:
    """Verify that sequential assignments produce consistent results."""

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_assign_unassign_assign_cycle(self, mock_patch, mock_get):
        """Assign → unassign → reassign: verify each response is correct and verified."""
        # Assign Alice
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_ALICE)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [(STAGE_1, USER_ALICE)])
        r1 = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        assert r1.json()["assignee"]["id"] == USER_ALICE["id"]
        assert r1.json()["verified"] is True

        # Unassign
        mock_patch.return_value = _make_stage_response(STAGE_1, None)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [(STAGE_1, None)])
        r2 = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": None},
        )
        assert r2.json()["assignee"] is None
        assert r2.json()["verified"] is True

        # Assign Bob
        mock_patch.return_value = _make_stage_response(STAGE_1, USER_BOB)
        mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [(STAGE_1, USER_BOB)])
        r3 = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_BOB["id"]}},
        )
        assert r3.json()["assignee"]["id"] == USER_BOB["id"]
        assert r3.json()["verified"] is True

    @patch("app.gov_get")
    @patch("app.gov_patch")
    def test_rapid_reassignments_same_stage(self, mock_patch, mock_get):
        """Rapidly reassign the same stage 10 times — all should succeed and verify."""
        users = [USER_ALICE, USER_BOB] * 5
        for user in users:
            mock_patch.return_value = _make_stage_response(STAGE_1, user)
            mock_get.return_value = _make_bundle_with_stages(BUNDLE_A, [(STAGE_1, user)])
            resp = client.patch(
                f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
                json={"assignee": {"id": user["id"]}},
            )
            assert resp.status_code == 200
            assert resp.json()["assignee"]["id"] == user["id"]
            assert resp.json()["verified"] is True
        assert mock_patch.call_count == 10


# ══════════════════════════════════════════════════════════════════
#  TIMEOUT / NETWORK ERROR TESTS
# ══════════════════════════════════════════════════════════════════

class TestNetworkErrors:
    """Verify behavior when the upstream is unreachable or slow."""

    @patch("app.gov_patch", side_effect=HTTPException(status_code=503, detail="Connection refused"))
    def test_upstream_connection_refused(self, mock_patch):
        """Network error is surfaced as a server error."""
        resp = client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        assert resp.status_code == 503

    @patch("app.requests.get")
    @patch("app.requests.patch")
    def test_timeout_value_passed(self, mock_patch, mock_get):
        """Verify that requests.patch is called with a timeout."""
        mock_patch.return_value = MagicMock(
            status_code=200,
            json=MagicMock(return_value=_make_stage_response(STAGE_1, USER_ALICE)),
        )
        mock_get.return_value = MagicMock(
            status_code=200,
            json=MagicMock(return_value=_make_bundle_with_stages(BUNDLE_A, [(STAGE_1, USER_ALICE)])),
        )
        client.patch(
            f"/api/bundles/{BUNDLE_A}/stages/{STAGE_1}",
            json={"assignee": {"id": USER_ALICE["id"]}},
        )
        call_kwargs = mock_patch.call_args[1]
        assert "timeout" in call_kwargs
        assert call_kwargs["timeout"] == 30
