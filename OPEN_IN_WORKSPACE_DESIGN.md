# "Open in Workspace" from a Governance Attachment — Design Brief

**Audience:** Domino platform engineering / CTO review
**Author:** SCE QC app team
**Status:** Pre-implementation; soliciting confirmation and gap-fill

## Goal

From the SCE QC app's attachment view, give a user a single button — "Open in workspace" — that lands them inside a running Domino workspace pointed at the same project, code revision, and (ideally) file the attachment references. Most users will open VS Code; some will use Jupyter, RStudio, or SAS Studio.

## Constraints we're designing within

- Domino workspaces are **project-scoped** and **caller-owned**. We use the viewing user's token via `localhost:8899/access-token`; no impersonation.
- The app is a FastAPI + CDN-React app deployed inside Domino. It already proxies the Domino REST APIs.
- Governance attachments reference an artifact in a source project; the viewing user may or may not be a collaborator on that project.

## Assumptions (please validate)

1. The governance attachment payload carries enough metadata to resolve **(`projectId`, `ownerId`, `repoPath`, `gitRefOrCommitId`, `projectType: git|DFS`)**. If any are missing, deep-linking degrades to "land in project" rather than "land at file."
2. The viewer must be a project collaborator for workspace creation/start to succeed; non-collaborators will 403, which we'll handle with a graceful "request access" path.
3. The `POST /v4/...` workspace endpoints accept the same passthrough auth pattern we already use for `POST /v4/jobs/start` from inside an app container.
4. When a user re-enters a stopped workspace, they get back the same IDE/env/tier they last used — we don't have to pick.

## Proposed architecture

```
[Attachment view]
    │  click "Open in workspace"
    ▼
[FastAPI: GET /api/workspace/launch?attachmentId=…]
    │  resolve → {projectId, repoPath, gitRef, projectType}
    │
    ├─ GET /v4/workspace/project/{projectId}/workspace
    │     classify viewer's workspaces in this project: Running | Stopped | None
    │
    ├─ Route:
    │   A. Running        → return session URL (warm; ~instant)
    │   B. Stopped        → POST …/workspace/{wsId}/sessions, poll, return URL (30s–min)
    │   C. None           → V1: redirect browser to project's workspace launcher UI
    │                        V2: POST …/project/{projectId}/workspace using last-used config
    │
    └─ Response: { url, mode: 'running'|'starting'|'picker', repoPath }

[Browser]
    │  navigate to URL
    ▼
[Domino-rendered IDE session]
    │  (best-effort) IDE-specific deep-link to repoPath
    ▼
   User editing code
```

## Endpoints we plan to use (verified against full swagger)

| Purpose | Method + Path |
|---|---|
| List user's workspaces in project | `GET /workspace/project/{projectId}/workspace` |
| List running workspaces in project | `GET /workspace/project/{projectId}/runningClassicWorkspaces` |
| List user's workspaces across projects | `GET /workspace` |
| Create + start new workspace | `POST /workspace/project/{projectId}/workspace` |
| **Start a stopped workspace (new session)** | `POST /workspace/project/{projectId}/workspace/{workspaceId}/sessions` |
| Stop workspace | `POST /workspace/project/{projectId}/workspace/{workspaceId}/stop` |

`CreateWorkspaceRequest` accepts `overrideMainGitRepoRef` (git projects) and `workspaceReproductionDetails` (DFS) — both relevant for pinning to the attachment's commit.

## Open questions for the Domino CTO agent

These are the load-bearing unknowns. Where the answer is "no, that doesn't exist," we'd like guidance on the supported workaround and/or whether it's roadmapped.

1. **Canonical session URL.** Given a `WorkspaceDto` (or the response from `POST .../sessions`), what is the canonical, version-stable way to construct the proxied URL the user's browser should navigate to? Is it derivable from `mostRecentSession` fields alone, or must we call something else? Does it differ across data planes?

2. **"Open file" deep-link.** Is there any param on `createAndStartWorkspace` or the session-start call that opens a specific file in the IDE on launch? If not, what is Domino's recommended pattern per IDE for post-launch file deep-linking — specifically:
   - VS Code Server: does Domino's proxy preserve `?folder=` / `?payload=` query params, or are they stripped/rewritten?
   - JupyterLab: is `/lab/tree/<path>` the supported pattern, and does it survive the proxy?
   - SAS Studio, RStudio: any deep-link support at all?

3. **"Last-used / default" workspace config.** For the "no existing workspace" case, is there an API (documented or not) returning the user's last-used or the project's default `(environmentId, hardwareTierId, tools[])` so we can create a workspace without forcing a picker? Without this we're forced to either redirect to the launcher UI or guess and risk 403/entitlement errors.

4. **Starting a stopped workspace — sync vs async.** Does `POST .../workspace/{id}/sessions` return enough information synchronously to redirect the user, or must we poll `GET /workspace/project/{p}/workspace/{w}` until `state == Running`? Recommended polling cadence and timeout?

5. **Git vs DFS disambiguation.** Does the governance attachment payload already disambiguate the source project as git-backed vs DFS-backed, or do we need a separate `GET /v4/projects/{id}` lookup before choosing between `overrideMainGitRepoRef` and `workspaceReproductionDetails`?

6. **Auth passthrough scope.** We confirmed `POST /v4/jobs/start` works through `localhost:8899` from inside a Domino app. Is the same passthrough valid for the full `/workspace/...` surface (create, start session, stop), or are there workspace-specific auth requirements?

7. **Cross-project access.** When the viewer is **not** a collaborator on the source project, what's the recommended UX — call a "request access" endpoint, deep-link to a project-request page, or just show a dead-end message? Is there a programmatic way to detect collaborator status before attempting the create/start call?

8. **Lifecycle / cost concerns.** Is there a Domino-side guardrail against users accumulating workspaces by clicking this button across many attachments (idle timeout, max-per-user)? If not, do you recommend our app implement one?

9. **Roadmap.** Is any of items 1–3 already roadmapped? If so, we'd rather wait than build a workaround we'll throw away.

## What we plan to ship vs defer (pending your answers)

- **V1 (no platform changes needed):** cases A and B fully functional; case C redirects to Domino's launcher UI. File deep-link is best-effort for Jupyter only.
- **V2 (depends on Q3):** programmatic create using last-used config — turns case C into one click.
- **V3 (depends on Q2):** cross-IDE file deep-link.

## Testability

- Unit/integration: mock `/workspace/...` and exercise the Running/Stopped/None routing plus the 403 (non-collaborator) path.
- E2E smoke: three matrix cases — (running, stopped, none) × (git project, DFS project) × (collaborator, non-collaborator).
- Cold-start latency is the primary unknown for case B/C; we will instrument and report.
