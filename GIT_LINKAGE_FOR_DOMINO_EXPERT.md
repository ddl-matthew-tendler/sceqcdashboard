# Handoff brief: linking the SCE QC Tracker to Git/programming in Domino

**Audience:** a Domino domain expert (platform APIs, MCP servers, Flows, governance, Git integration).
**From:** the team building the SCE QC Tracker app.
**What I need back:** validation or correction of the API approach below, the *correct* endpoint set for resolving a deliverable's code branch/commits (Git-based **and** DFS projects), and a feasibility read on the Phase 3 automation options. Sharp questions are in **§5 — please answer those directly.**

---

## 1. What the app is (context)

The **SCE QC Tracker** is a Domino-hosted web app (FastAPI proxy + CDN React/AntD, no build step) used by clinical-programming Study Leads to track QC of statistical deliverables (ADaM datasets, TFLs, etc.) across studies.

- Each **deliverable = a Domino governance bundle**. Its QC workflow is the bundle's **policy stages** (e.g. Self QC → Double Programming → Study Lead Verification), and its lifecycle is the bundle `state` (`Active` / `Complete` / `Archived`).
- The app is a **read-mostly dashboard**: it lists bundles, enriches them with approvals/findings/attachments, and provides deep-links into Domino. It has **no database** (localStorage only for prefs/mappings) and deliberately **stays in the governance-metadata space — it does not provision infrastructure**.
- Backend is a thin FastAPI proxy to Domino's governance v1 API and platform v4 API. Auth re-acquires a token per call: `API_KEY_OVERRIDE` env → else sidecar `http://localhost:8899/access-token`. Governance prefers `X-Domino-Api-Key`; v4 accepts Bearer.

## 2. The customer ask (verbatim, from a UCB call)

> "How is this tracker linked to the programming in Domino? For example, if someone makes a branch to work on ADAE dataset, can this automatically track its status in terms of if it is active, validated etc?"

They also confirmed bulk import of objectives works (CSV/JSON — already shipped). This brief is **only** about the Git-linkage question.

## 3. Our proposed approach (for you to critique)

We think the question conflates **two distinct statuses** and the right design keeps them separate:

| Dimension | Owner | Values | Source |
|---|---|---|---|
| **QC / validation status** | Domino governance (authoritative) | Active → In QC → Validated/Complete | bundle `state` + `stage` (already have it) |
| **Development status** | Git | Not started → In development → Code complete (merged) | branch existence + commits |

…bridged by a **drift check**: compare the commit a deliverable was *validated against* vs the branch **HEAD**. "Validated @ `d0c4b36`, branch is N commits ahead ⇒ validation may be stale." Git **never** sets "Validated" — governance does; Git only informs dev status and flags drift. (We already do this exact staleness pattern for dataset/volume snapshots.)

**Phasing:** (1) provenance + drift badge [read-time enrichment, ~1d]; (2) dev-status from branches [~1–2d]; (3) event-driven auto-run of QC checks on merge/commit [heavier — see §5].

## 4. What we've already confirmed in this codebase

**The deliverable↔code link already exists in the data.** Report-type governance attachments carry the branch + commit the evidence came from ([static/app.js:1895](static/app.js)):

```js
// attachment.identifier for type === 'Report':
{ branch: "CSR", commit: "d0c4b36153de74c47832b01461707eaf2aa7955d",
  source: "DFS" | "GBP", filename: "prod/tfl/t_pop.sas" }
```

**Repo resolution has a known landmine** (learned building the RTF viewer, [app.py:1103-1134](app.py)):
> The project's OWN repo is `mainRepository` on the project detail (`GET /v4/projects/{id}`); `/v4/projects/{id}/gitRepositories` only returns **IMPORTED** repos (often empty). Also `proj.importedGitRepositories[]`. We resolve by trying main first, then imported, deduped by id.

**Endpoints we believe are relevant** (from swagger; not all tested for this use case):

| Endpoint | Purpose |
|---|---|
| `GET /v4/projects/{id}` → `.mainRepository`, `.importedGitRepositories[]` | resolve repoId(s) |
| `GET /v4/projects/{id}/gitRepositories` | imported repos only (caveat above) |
| `GET /v4/projects/{id}/gitRepositories/{repoId}/git/branches` (params: `searchPattern`, `sort`, `count`) | does a branch for ADAE exist? |
| `GET /v4/projects/{id}/gitRepositories/{repoId}/git/commits?branch=…` | commits + HEAD on a branch (recency, drift) |
| `GET /v4/projects/{id}/commits/head` | HEAD commit (DFS/file-based projects) |
| `GET /v4/projects/{id}/projectDefaultBranch` | default branch (for "merged" detection) |
| `GET /v4/projects/{id}/{repoId}/uriForBlobAtBranch/{branch}/{fileName}` | deep-link to file at branch |
| existing app proxies | `GET /api/projects/{id}/git-info` (parses provider/owner/repo), `GET /api/attachment-overviews` (attachments incl. identifier) |

## 5. Questions for you (please answer directly)

**A. Repo & branch resolution**
1. For a deliverable whose code lives in the **project's own repo**, is `mainRepository.id` the right `repoId` to pass to `.../gitRepositories/{repoId}/git/branches`? Or do those `git/*` sub-routes only work for *imported* repos, and the project's own repo needs a different path?
2. **Git-based vs DFS projects** behave differently. For a **DFS** project, what is the correct way to list "branches" and a branch HEAD? Is `/files/{projectId}/branches` + `/files/{projectId}/commits` the DFS analog, and do DFS projects even have user branches in the sense Tim means?
3. Is there a single endpoint that, given a `projectId`, tells us *project type* (git-based vs DFS) and the canonical code repo, so we don't have to probe?

**B. The deliverable↔branch mapping**
4. Is `attachment.identifier.commit` guaranteed to be the commit the evidence was generated from (i.e. trustworthy as the "validated-against" anchor)? Any governance API field that ties a bundle/stage directly to a commit, so we don't depend on attachment identifiers?
5. Best way to detect **"merged to default branch"** via Domino's API — compare branch HEAD to `projectDefaultBranch` HEAD? Is there any PR/merge concept exposed, or is that only in the external provider (GitHub/GitLab)?

**C. Scale & auth**
6. ~218 deliverables spanning many projects/repos. Listing branches+commits per repo at page-load — any **rate limits, pagination gotchas, or a bulk/batch** endpoint we should use instead of N calls? (We have a 16-worker ThreadPool batch pattern today.)
7. The git `raw`/browse reads need repo access. Does the **app's service token** (sidecar `access-token`) inherit the caller's git credentials, or do we need per-user git credential mapping (`/v4/.../credentialMapping`)?

**D. Phase 3 — automation / events (feasibility)**
8. Does Domino expose **events/webhooks** on commit/merge/branch-create that an app or Flow could subscribe to? Or is polling the only option?
9. To auto-run a QC check on merge and write evidence back: is the right primitive a **Domino Flow**, a **scheduled Job**, or a Git webhook → Job? We already start jobs + write evidence via `POST /v4/jobs/start` and governance `submit-result-to-policy`. What's the cleanest, most-supported path?
10. **MCP angle:** is there a Domino MCP server (we see `dominodatalab:domino_server` tools) that exposes git branch/commit/job operations more robustly than raw v4 proxying? Would you route any of this through MCP instead?

**E. Anything we're missing**
11. Is there a more idiomatic, "blessed" way to express *code↔governance linkage* in Domino that we're not seeing (e.g. a native lineage, artifact, or model-card feature) that would make our drift/dev-status layer redundant or better?

## 6. Constraints to respect in any recommendation
- **No custom compute environments.** Extra Python deps go in project-root `requirements.txt`.
- **Stay in governance-metadata scope** — read/enrich is in-bounds; standing infra (a webhook receiver with its own datastore) pushes past the app's current architecture, so flag it explicitly if you recommend it.
- **Proxy-safe, no-DB, read-mostly.** Token re-acquired per call.
- "Validated" must remain governance-owned and human-signed (GxP audit story).
