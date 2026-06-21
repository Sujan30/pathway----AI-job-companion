# Internship Application Agent — Setup Guide

A Claude Code agent that finds, tracks, and auto-applies to internships. Claude Code sessions do all the reasoning and browser automation. A FastAPI server relays events to a live CRM dashboard so you can watch applications progress in real time.

## Architecture

```
Claude Code session (any terminal)
  └─ PostToolUse hook (fires on every internship MCP tool call)
       └─ hooks/post_tool_use.py
            └─ POST http://localhost:8000/api/events
                 └─ FastAPI server (server/)
                      ├─ SSE stream → CRM UI (crm/) at localhost:8080
                      └─ data.json  (persistent job + application state)
```

**Flow:** Claude calls `jobs_prefilter` → hook fires → server stores jobs → CRM board updates live. Same for every subsequent step (`job_get`, `packet_build`, `resume_compile`, `application_record`).

## Prerequisites

- Python 3.11+
- Node.js 18+ and Bun (`npm install -g bun`)
- uvicorn (`pip install uvicorn fastapi sse-starlette`)
- An Internship Matcher API key — get one at [internship-app-production.up.railway.app](https://internship-app-production.up.railway.app)
- A HydraDB account (optional, for session memory) — [hydradb.io](https://hydradb.io)

## First-time setup

### 1. Clone and configure

```bash
git clone <this-repo> agents-hack
cd agents-hack
```

Create `.env` with your keys:

```bash
HYDRA_DB_API_KEY=sk_live_...
HYDRADB_TENANT_ID=your-tenant-id
INTERNSHIP_MATCHER_API_KEY=im_live_...
```

### 2. Configure MCP servers

`.mcp.json` is already present. It wires the `internship` and `playwright` MCP servers into Claude Code. Make sure your API key matches:

```json
{
  "mcpServers": {
    "internship": {
      "command": "uvx",
      "args": ["internship-mcp"],
      "env": { "INTERNSHIP_API_KEY": "im_live_..." }
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

### 3. Install CRM dependencies

```bash
cd crm && bun install && cd ..
```

### 4. Start everything

```bash
./start.sh
```

This starts:
- FastAPI server at `http://localhost:8000`
- CRM dashboard at `http://localhost:8080`

Open `http://localhost:8080` in your browser. The board starts empty and populates as Claude works.

## Using the agent

Open a Claude Code session **from this directory** (so it picks up `.claude/settings.local.json` and the MCP config):

```bash
claude
```

Then give it a prompt like:

```
Parse my resume at /path/to/resume.pdf, find internships that fit me,
rank the best US engineering roles, and apply to the top one.
Stop before submitting anything — I'll review first.
```

As Claude works, cards appear on the CRM board and advance through stages automatically:

| Stage | Triggered by |
|---|---|
| Shortlisted | `jobs_prefilter` |
| Researched | `job_get` |
| Packet Built | `packet_build` |
| Resume Compiled | `resume_compile` |
| Ready to Submit | `autosubmit_plan` |
| Applied | `application_record` |

## How the hook works

`.claude/settings.local.json` registers a `PostToolUse` hook that fires after every `mcp__internship__*` tool call:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "mcp__internship__.*",
      "hooks": [{ "type": "command", "command": "python3 /path/to/hooks/post_tool_use.py" }]
    }]
  }
}
```

`hooks/post_tool_use.py` receives the tool name and response via stdin as JSON, parses the real API envelope (`{"result": {...}}`), and POSTs a normalized event to the server. If the server is down it silently skips — Claude is never blocked.

Debug log: `/tmp/crm_hook_debug.log` — check this first if the CRM isn't updating.

## CRM server API

| Endpoint | Description |
|---|---|
| `GET /api/jobs` | All jobs |
| `GET /api/applications` | All application records |
| `GET /api/stream` | SSE stream — CRM subscribes here |
| `POST /api/events` | Hook posts here (tool name + output) |
| `POST /api/jobs` | Create a job manually from the UI |
| `PATCH /api/jobs/:id` | Update stage, company, title, notes, deadline |
| `DELETE /api/jobs/:id` | Remove a job |
| `GET /api/health` | Health check |

## Troubleshooting

**CRM board not updating**
1. Check the server is running: `curl http://localhost:8000/api/health`
2. Check the debug log: `cat /tmp/crm_hook_debug.log`
3. Confirm the session was opened from this directory (so hooks are loaded)

**Hook fires but `updated_count: 0`**
The job response came back with unexpected field names. The hook logs the full payload — look for `payload_type` and `payload_snippet` in the debug log to see the raw structure.

**"server_error=timed out" in debug log**
The server was restarting (e.g. after a file edit with `--reload`). Restart without `--reload`:
```bash
kill $(lsof -ti:8000); cd server && uvicorn main:app --host 0.0.0.0 --port 8000
```

**Duplicate jobs in the CRM**
Test runs create fake IDs (`abc123` etc). Delete them via the UI or:
```bash
curl -X DELETE http://localhost:8000/api/jobs/<id>
```

**Garbled company names**
The internship MCP scrapes raw HTML — some company names come through mangled. Fix via:
```bash
curl -X PATCH http://localhost:8000/api/jobs/<id> \
  -H "Content-Type: application/json" \
  -d '{"company":"Correct Name"}'
```

## Project layout

```
agents-hack/
  .mcp.json                  # MCP server config (internship + playwright)
  .env                       # API keys (never commit this)
  .claude/
    settings.local.json      # Hook registration + MCP enablement
  hooks/
    post_tool_use.py         # Intercepts MCP tool results → server
  server/
    main.py                  # FastAPI app (events, SSE, CRUD)
    storage.py               # JSON file persistence
    data.json                # Live job + application state (auto-created)
  crm/                       # Vite + React dashboard (internshipfinder UI)
  start.sh                   # Starts server + CRM together
```
