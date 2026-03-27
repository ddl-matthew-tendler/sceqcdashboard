# SCE QC Dashboard

A Domino App for portfolio-level visibility into QC deliverables, findings, approvals, and stage assignments across projects.

## Pages

| Page | Purpose |
|------|---------|
| **QC Tracker** | Main table of all deliverables with inline stage progress dots, expandable detail rows (approvals, findings, gates, attachments), column filters, and CSV import |
| **Portfolio Overview** | Summary charts — deliverables by state, findings by severity, stage distribution |
| **Milestones** | Timeline view of deliverable stage progression for active deliverables |
| **Approvals** | Cross-deliverable approval status tracking with 4 KPI cards (Pending Submission, Pending Review, Conditionally Approved, Approved) |
| **Findings & QC** | Aggregated findings view across all deliverables |
| **Team Metrics** | Quality indicators, cycle times, rework indicators, and workload distribution with interactive chart drill-down |
| **Stage Manager** | View all stages across deliverables — identify unassigned work, reassign owners, and manage workload |
| **Bulk Assignment Rules** | Per-project rules for bulk-assigning team members to stages |
| **Automation** | Define scripts that run automatically when QC stages complete |
| **Risk Optimizer** | Keyword-based risk scoring with configurable tiers, policy tagging, and calibration analysis |

## Architecture

```
Browser  ──►  FastAPI (app.py)  ──►  Domino APIs
              serves static/         /api/governance/v1/*
              proxies /api/*         /v4/*
```

- **Backend**: FastAPI proxy (`app.py`) — handles auth, proxies to Domino governance and v4 APIs
- **Frontend**: Single-page app (`static/app.js`) — React 18 + Ant Design 5, loaded via CDN (no build step)
- **Mock data**: `static/mock_data.js` — realistic fallback data for demos and offline development

### Key files

| File | Role |
|------|------|
| `app.py` | Backend proxy — auth, route definitions, governance host discovery |
| `static/app.js` | Frontend — React components, state, API calls, all UI logic |
| `static/mock_data.js` | Mock data globals for offline/demo mode |
| `static/styles.css` | All custom styles |
| `static/index.html` | Entry point — CDN imports, script loading order |
| `app.sh` | Startup script — `uvicorn app:app --host 0.0.0.0 --port 8888` |

## Running locally

```bash
# 1. Create .env with your Domino credentials
cp .env.example .env
# Edit .env: set DOMINO_API_HOST and API_KEY_OVERRIDE

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the server
uvicorn app:app --host 0.0.0.0 --port 8888 --reload
```

Open `http://localhost:8888`. If `DOMINO_API_HOST` is not set or API calls fail, the app falls back to mock data automatically.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DOMINO_API_HOST` | Yes (auto-set in Domino) | Base URL for Domino instance |
| `API_KEY_OVERRIDE` | No | Static API key or PAT for local development |
| `DOMINO_USER_API_KEY` | No (auto-set in Domino) | API key provided by Domino runtime |

## Deploying on Domino

1. Push code to a Domino-linked Git repo
2. Create a new App in the Domino project
3. Set the startup script to `app.sh`
4. The app auto-discovers auth tokens and API hosts at runtime

### Governance API routing

Inside Domino's Kubernetes cluster, the governance API (`/api/governance/v1/*`) may not be available on the internal `nucleus-frontend` service. The backend automatically probes multiple candidate hosts (including the external ingress hostname captured from browser requests) and caches whichever one works.

Visit `/api/debug/auth` on the running app for auth and routing diagnostics.

## Dummy data toggle

When the app can't connect to Domino APIs, it falls back to mock data and shows a "Dummy Data" toggle in the top nav. When connected to live APIs, the toggle is hidden. This enables:

- Demos without a live Domino connection
- Development of new features before APIs exist
- QA testing between real and mock data

## API gaps

Stage reassignment and bundle creation are live. Remaining write operations (bulk assign, apply rules) have no Domino API yet. These actions show an "API Pending" badge and display a message when attempted. See `DOMINO_API_GAPS.md` for proposed endpoint designs.

## Documentation

| File | Contents |
|------|----------|
| `DECISIONS.md` | Architectural decision log |
| `API_MAP.md` | Complete API endpoint reference and fetch sequence |
| `DOMINO_API_GAPS.md` | Missing write APIs with proposed designs |
| `LIVE_API_STATUS.md` | Audit of live API connectivity |
| `DUMMY_DATA_AUDIT.md` | Mock data reference mapping |
