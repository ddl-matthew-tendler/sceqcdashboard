# Feature Release: Bundle Detail Drawer + Evidence Workflow

Commit range: `060c7b1` → `6aa73e7`.

---

## Major Improvements

### 1. Live Evidence view inside the drawer
Click any bundle row (or any stage circle in the Progress column) and the right-hand drawer opens with a new **Evidence** tab. Renders the bundle's full policy structure as a stepper plus per-stage collapsible sections, with every artifact's submitted value, submitter, and timestamp pulled live from Domino's governance API. Replaces the "have to leave the app to see what was actually answered" workflow.

### 2. Edit & save evidence without leaving the app
Every text, textarea, radio, checkbox, and select field is editable inline. A per-evidence-set Save button POSTs to `/rpc/submit-result-to-policy`, the value persists in Domino, and the next refresh confirms it. Active stage is editable; complete stages are read-only; pending stages are gated until they become active.

### 3. Agentic flow: "Assign to Agent" + live results
A prominent **✨ Assign to Agent** banner appears at the top of any stage that contains a `policyScriptedCheck` artifact. One click runs the first scripted check with its default parameters, kicks off a Domino job via `/v4/jobs/start`, polls job status every 3s, tails stdout/stderr into a collapsible Result panel, and auto-refreshes the agent-populated evidence fields the moment the job succeeds. Agent-written values are marked with a `✨ AGENT` pill and subtle purple gradient.

### 4. Stage transition with pre-validation
A header button (and click-on-pending-stepper-dot) transitions the bundle to the next stage. Before firing, the client walks every required artifact in the current stage and only enables the action when all are filled, replacing the prior round-trip-to-Domino-and-fail UX. Disabled state hovers a tooltip listing exactly which required fields are still empty.

### 5. Taxonomy-aware Tags filter
The Tags dropdown now groups options by Domino taxonomy `namespaceLabel` (Analysis, Data Type, Indication, Therapeutic_Modality, etc.) instead of showing a flat list of leaf names. Tag descriptions surface on hover. Identically-named tags in different namespaces no longer collide.

---

## Minor Improvements

### Drawer mechanics
- **Drag-to-resize** the drawer width (6px handle on the left edge, hover-highlighted, clamps to `[360, viewport-40]`, persists per-user to localStorage). Replaced the unusual Narrow/Wider/Widest cycle button. Double-click resets to 560px.
- **Tabs reordered** to Stage Timeline → Evidence → Attachments → Deliverable Overview → Findings → Approvals → Gates. Default tab is now Stage Timeline.
- **Stepper visual fixes**: dots now align horizontally regardless of label wrap (`flex-start` instead of `center`), columns are forced equal width with `flex: 1 1 0 / minWidth: 0`, connector lines geometry tightened.
- **Auto-collapse other stages after transition**: only the new active stage's section is expanded; previously-open stages collapse so attention follows the work.
- **Pending stages muted**: gray text + medium weight + dimmed chevron so the active stage stands out.

### Required-field UX
- Red `*` after every required field's label (matches Domino's native UI).
- "Advance to next stage" button stays plain, disabled with the standard Antd gray when required fields aren't done, no lock icon or scary "🔒 N required" text. Tooltip carries the missing-field list.
- Clicking a blocked stepper dot is silent — no confirm popup fires.

### Save feedback
- Top-right Antd notification: `✓ Saved to Domino — N fields updated`.
- Per-evidence-set "Saved a few seconds ago" footer next to the Save button.
- Each saved input flashes green for ~1.7s after persistence.
- Refresh no longer wipes the drawer to a loading spinner; prior content stays in place so confirmations land where the user is looking.

### Agent-run UX
- **Stable "Agent is running" banner** with spinner, live status, and ticking elapsed-time counter, replacing the flickering "Fetching logs…" ↔ "(no logs yet)" loop that came from silent polling triggering the loading state.
- **Run button** renamed "Run Script" to match Domino's native UI.
- **Result panel** collapsed by default (the agent-populated evidence below is where attention belongs); auto-expands while a job is running.
- **"Open job ↗"** link to the Domino jobs page deep-linked to the user's project (`/u/{owner}/{project}/jobs/{jobId}`).

### Guidance content
- Policy `guidance` artifacts (the banners with `details.type: banner`) now render inline as collapsible purple info banners.
- Lightweight markdown renderer for the banners: bold, inline code, blank-line paragraphs, bullet lists, horizontal rules.
- Banners default collapsed with a one-line teaser; click to expand.

### Typography
- Cross-platform monospace stack: prefers JetBrains Mono → SF Mono → Fira Code → Cascadia Mono with fallbacks (was just `Menlo, Monaco, monospace` which fell to system default on Linux/Windows).
- Log box: 10.5 → 12.5 px, line-height 1.4 → 1.6, brighter foreground on Tokyo-Night background, slight letter-spacing.
- Script command, parameter labels, debug JSON, and inline `code` all bumped to 12 px.

### Stage stepper
- Hover pending dots: scale 1.15 + Domino-purple glow ring.
- Tooltip on each dot says "Open Evidence for {stage}" (or "Complete N required fields before advancing" when blocked).
- Connector lines use `done`/`active`/`pending` colors driven from the live bundle data.

### Debug panel
- Collapsible 🛠 Debug panel at the bottom of the Evidence tab. Shows the raw `GET /api/bundles/{id}/detail` response, last save request/response, last run request/response, last error, each with a Copy-to-clipboard button. Lets you diagnose silent failures without F12.

### Backend endpoints (FastAPI)
- `GET  /api/bundles/{id}/detail` — merges bundle metadata, policy structure, and submitted evidence values into one payload (reads from `results[].artifactContent`, not `value`).
- `POST /api/bundles/{id}/evidence` — submits evidence values via `/rpc/submit-result-to-policy`.
- `POST /api/bundles/{id}/scripted-check/{artId}` — resolves the artifact's command + env + hardware tier, calls `/v4/jobs/start`, persists `{jobId, jobStatus, parameters}` back as draft evidence.
- `POST /api/bundles/{id}/transition` — patches the bundle's primary policy stage.
- `GET  /api/jobs/{id}/logs` — proxies `/v4/jobs/{id}/logsWithProblemSuggestions`, joins log lines from the correct `logset.logContent` nested path.

### Notable bug fixes
- **Save did nothing** — onClick referenced `artIds` after an earlier rename to `savableIds`; minified React swallowed the `ReferenceError`. POSTs are now firing.
- **Result panel said "(no output produced)" for successful jobs** — backend was reading `logs_resp["logContent"]` directly; the actual schema is `logset.logContent`. Fixed and lines now flow.
- **Couldn't transition after filling required fields** — downstream of the save bug; once save persists, validation sees the populated values.
- **DetailDrawer blank-screened the whole app** — early-return ran above the new useState/useEffect for Evidence, causing a hooks-count change on the second render and a React #310 error. Hooks moved above the guard.
- **Cache busters** bumped (`?v=5` → `?v=24`) so users don't keep getting stale builds.

### Quality / process
- Em dashes scrubbed from all new strings and comments in the Evidence feature code per user preference.
- 41 existing pre-push assignment tests passed on every commit.
