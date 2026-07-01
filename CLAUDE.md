# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Monitor Tool** — a self-hosted network and server monitoring dashboard (simplified SolarWinds-style). It monitors devices via ICMP ping, supports private-network agents that push results to a central server, and is deployed to **Azure Static Web Apps** with **Azure SQL Database** as the backend.

- GitHub: `github.com/jclaudeem/monitor-tool`
- Azure account: `irondss.com` tenant (`917f3df2-d42e-4157-8e3e-73948d596e69`)
- Resource group: `monitor-tool-rg` (East US 2)
- Deployment: push to `master` → Azure SWA auto-deploys via GitHub Actions

## Architecture

```
monitor-tool/
├── frontend/          Static HTML/CSS/JS dashboard (no build step)
├── api/               Azure Functions v4 (Node.js) — served at /api/*
│   └── src/
│       ├── db.js      Azure SQL connection pool + schema auto-init on cold start
│       └── functions/ One file per resource group (devices, agents, status, cleanup)
├── agent/             Standalone Node.js process deployed inside private networks
└── staticwebapp.config.json
```

### How it fits together

- **Frontend** calls `/api/*` endpoints. In Azure SWA, these are automatically routed to the Azure Functions in `api/`. Locally there is no dev server — the app requires a running backend.
- **`api/src/db.js`** manages a module-level `mssql` connection pool. Schema is created automatically (`IF OBJECT_ID ... IS NULL`) on the first cold start — no migration tool needed.
- **Agents** run `npm start` inside `agent/` on any machine in a private network. Each cycle they: (1) `GET /api/agents/devices` to fetch their assigned devices, (2) ICMP-ping them locally, (3) `POST /api/agents/report` with results. Auth is a 64-char hex bearer token stored in `agent/config.json`.
- **The Azure Functions poller does not ping devices** — Azure cannot reach private IPs. All polling is agent-driven. The only timer trigger (`cleanup.js`) prunes `poll_results` older than 24 hours at 03:00 UTC.

### Data flow

```
Agent (private net) → ICMP ping → POST /api/agents/report → Azure SQL poll_results
Dashboard           → GET /api/devices + /api/status/summary → Azure SQL
```

## Database Schema

Three tables in Azure SQL (T-SQL, auto-created):

| Table | Key columns |
|---|---|
| `agents` | `id`, `name`, `api_key` (unique, 64-char hex), `last_seen` |
| `devices` | `id`, `ip_address` (unique), `agent_id` FK → agents (NULL = no agent) |
| `poll_results` | `device_id` FK → devices (CASCADE DELETE), `status` ('up'/'down'), `response_time` FLOAT ms, `polled_at` |

## Azure Functions

All functions use `authLevel: 'anonymous'`. Agent-facing endpoints (`GET /api/agents/devices`, `POST /api/agents/report`) authenticate via `Authorization: Bearer <api_key>` resolved in `resolveAgent()` in `agents.js`.

SQL queries use named parameters (`@param`) and `OUTPUT INSERTED.id` for inserts. Check `result.rowsAffected[0] === 0` for not-found on UPDATE/DELETE. Unique constraint violations are SQL error numbers `2627` or `2601`.

## Deployment

**Azure Static Web Apps** — push to `master` triggers auto-deploy. Required environment variable set in Azure Portal → SWA → Configuration:

```
AZURE_SQL_CONNECTION_STRING=Server=tcp:<server>.database.windows.net,1433;Database=monitor-tool;User ID=monitoradmin;Password=...;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

When connecting the GitHub repo to Azure SWA, use these build settings:
- `app_location`: `/`
- `api_location`: `api`
- `output_location`: `frontend`

## Agent Setup

```bash
cd agent
cp config.example.json config.json   # fill in serverUrl + apiKey
npm install
node agent.js                         # or install as a Windows/Linux service
```

The agent's `serverUrl` must point to the live Azure SWA URL (e.g. `https://yourapp.azurestaticapps.net`). Devices are assigned to agents via the dashboard — the agent fetches its list dynamically on each cycle.

## Frontend

- No build step — raw HTML files served directly from `frontend/`
- All CSS is in `frontend/assets/style.css` (CSS variables: `--primary`, `--up`, `--down`, `--unknown`)
- Shared JS utilities in `frontend/assets/app.js`: `api.*` fetch wrappers, `timeAgo()`, `formatResponseTime()`, `statusBadgeHtml()`, `showToast()`
- Dashboard auto-refreshes every 30 seconds via `setInterval`
- ES pages: not applicable (English only)
