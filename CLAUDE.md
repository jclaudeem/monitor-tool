# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Monitor Tool** — a SolarWinds-style network monitoring dashboard. Agents run inside private networks, poll devices via ICMP ping and SNMP v2c, and report to a central Azure-hosted backend.

- **Live URL:** `https://proud-mud-06d03420f.7.azurestaticapps.net`
- **Repo:** `github.com/jclaudeem/monitor-tool` (branch: `master`)
- **Azure account:** `irondss.com` tenant, subscription `9389a990-c7c7-44fb-8d69-866ce7fcc3cc`, resource group `monitor-tool-rg`

## Deployment

Push to `master` triggers auto-deploy via GitHub Actions (~1–2 min). SWA build settings: `app_location: "frontend"`, `api_location: "api"`, `output_location: ""` (empty — Oryx can't detect a build platform for plain HTML; pointing directly at `frontend/` is the fix).

## Build — Agent Executable

```powershell
cd agent
npm install
npm run build   # → agent/dist/MonitorAgent.exe (~44 MB, standalone, no Node.js needed)
```

Uses `@yao-pkg/pkg` targeting `node20-win-x64`. The exe must not be running when rebuilding (file lock). The deployed agent lives at `C:\Users\server\Desktop\dist\MonitorAgent.exe` on `192.168.168.50`.

## Architecture

```
frontend/            Static HTML dashboard (no build step, inline CSS per page)
  assets/
    style.css        Shared layout + CSS variables (--primary #2980b9, --up #00b894, --down #d63031)
    app.js           Shared fetch helpers (api.get/post/put/del), timeAgo(), showToast()
  index.html         Dashboard — stat cards + device status table + agent list
  devices.html       Device CRUD, SNMP detail modal, history charts (Chart.js 4 + date-fns adapter)
  agents.html        Agent management

api/src/
  db.js              mssql connection pool singleton; schema auto-creates on cold start
  functions/
    agents.js        Agent CRUD (dashboard) + agent-facing poll endpoints
    devices.js       Device CRUD
    snmp.js          Agent posts SNMP results; dashboard reads latest SNMP data
    history.js       GET devicehistory/{id}?hours=N — ping + SNMP time-series for charts
    status.js        GET status/summary — stat card counts; GET status/history/{deviceId}
    cleanup.js       Scheduled pruning

agent/
  agent.js           Main loop: fetchDevices → ping all → report → SNMP poll → report (60s)
  snmp.js            SNMP v2c via net-snmp: subtree walks for ifTable, hrProcessorTable, hrStorageTable
  dist/              MonitorAgent.exe lives here
```

## Critical SWA Gotchas

**1. Authorization header is intercepted.** SWA replaces any `Authorization: Bearer` header with its own JWT before functions see it. The agent authenticates via `X-Agent-Key` header instead. `resolveAgent()` in `agents.js` reads `x-agent-key`.

**2. Nested API routes conflict.** A route like `agents/devices` matches the `agents/{id}` parameter route at the SWA edge layer before the function handler runs. Use flat single-segment routes: `agentdevices`, `agentreport`, `agentsnmp`, `devicehistory/{id}`.

**3. Stale pool after timeout.** If the DB is auto-paused and a function times out mid-connect, `pool` is set but `pool.connected` is false. `db.js` checks `pool.connected` before reusing — if falsy, closes and recreates it cleanly.

**4. Free tier function timeout (~30s) vs. Azure SQL cold-start (~35–40s).** The first request after auto-pause always fails. The second agent cycle (60s later) succeeds because the DB finished resuming. This is expected behavior.

## Azure SQL

**Server:** `mt-sql-scus.database.windows.net` (South Central US)  
**Database:** `monitor-tool` — free Serverless Gen5, auto-pauses after 60 min idle

Connection string stored in SWA app settings as `AZURE_SQL_CONNECTION_STRING` (Connection Timeout=60).

**Free tier limit:** 100,000 vCore-seconds/month (~55 hours at 0.5 vCore min). The agent polling every 60s keeps the DB permanently awake and exhausts credits in ~2.3 days of 24/7 operation. When exhausted, `freeLimitExhaustionBehavior` = `AutoPause` and the DB cannot auto-resume until credits reset or the tier is changed. Check status: `az sql db show --resource-group monitor-tool-rg --server mt-sql-scus --name monitor-tool --query "{status:status,exhausted:freeLimitExhaustionBehavior}"`.

## Agent

On first run the agent prompts for **Server URL** (base URL only, no trailing slash or path) and **API Key** (from dashboard → Agents). Config saved as `config.json` next to the exe. Delete `config.json` to re-run setup. Log: `MonitorAgent.log` next to the exe, rotates at 2000 lines.

`MonitorAgent.exe --install` registers a Windows Task Scheduler startup task (requires Administrator).  
`MonitorAgent.exe --uninstall` removes it.

## Database Schema

Auto-created by `db.js → initSchema()` using `IF OBJECT_ID ... IS NULL` guards:

| Table | Purpose | Pruning |
|---|---|---|
| `agents` | Registered agents; `api_key` is a 64-char hex unique key | — |
| `devices` | Monitored devices; has `snmp_enabled`, `snmp_community`, `snmp_port` columns | — |
| `poll_results` | Ping history: `status`, `response_time`, `polled_at` | 7 days, pruned on each `agentreport` cycle |
| `snmp_results` | SNMP JSON blob per poll: `{system, interfaces, cpu[], memory[], errors[]}` | Last 100 per device |

## SNMP

`agent/snmp.js` uses `session.subtree()` (not `tableColumns()`) for broad device compatibility. Results for each device: `system` (sysDescr/Uptime/Contact/Location), `interfaces[]` (ifTable), `cpu[]` (hrProcessorTable — servers only), `memory[]` (hrStorageTable — servers only). Network devices (routers, firewalls) return empty `cpu` and `memory` arrays — this is expected.
