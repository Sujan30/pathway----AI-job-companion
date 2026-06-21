# Pathway

An agentic internship application pipeline powered by Claude Code. Pathway finds roles that match your profile, tailors your resume, fills out applications, and tracks everything on a live CRM board — while you watch it happen in real time.

## What it does

- **Discovers** internships from a curated pool of thousands of roles
- **Filters** them against your skills, location, and preferences
- **Tailors** your resume for each role automatically
- **Prefills** applications via browser automation (Playwright)
- **Tracks** every step on a Kanban-style CRM dashboard that updates live as Claude works
- **Remembers** everything across sessions via HydraDB — no re-interviewing, no re-uploading your resume

## How it works

```
Claude Code session
  └─ internship MCP (finds jobs, builds packets, compiles resumes)
  └─ Playwright MCP (fills application forms in the browser)
  └─ PostToolUse hook
       └─ hooks/post_tool_use.py
            └─ POST → FastAPI server (port 8000)
                 ├─ SSE stream → CRM dashboard (port 8080)
                 └─ data.json (live job + application state)
```

Every time Claude calls an internship tool, the hook fires automatically and pushes the result to the server. The CRM board updates within milliseconds — no polling, no manual refresh.

## CRM pipeline stages

| Stage | What happened |
|---|---|
| Shortlisted | Claude ran `jobs_prefilter` and this role passed |
| Researched | Claude fetched full job details via `job_get` |
| Packet Built | Cover letter + application packet generated |
| Resume Compiled | Resume tailored and compiled to PDF |
| Ready to Submit | Application prefilled and awaiting your review |
| Applied | Submitted — `application_record` confirmed |
| Interview | You moved this card manually |
| Offer / Rejected | Final outcome |

## HydraDB — persistent memory across sessions

Pathway uses [HydraDB](https://hydradb.io) as a long-term memory store for the Claude Code session. This means:

- Your **profile** (skills, work auth, EEO preferences, logistics) is encrypted and stored once — never asked again
- Your **resume data** is parsed once and reused for every tailored compile
- The **shortlist and ranking decisions** from past runs carry over — Claude doesn't re-evaluate jobs it already processed
- **Application history** is available in future sessions so Claude knows what you've already applied to

HydraDB stores all of this as structured observations tied to your tenant ID. The internship MCP reads and writes to it automatically via the `HYDRADB_API_KEY` and `HYDRADB_TENANT_ID` environment variables.

## Stack

| Layer | Tech |
|---|---|
| Agent runtime | Claude Code (claude-sonnet-4-6) |
| Job search & apply | internship-mcp |
| Browser automation | @playwright/mcp |
| Session memory | HydraDB |
| Backend | FastAPI + sse-starlette |
| CRM frontend | Vite + React + shadcn/ui + TanStack Router |
| Package manager | Bun |

## Quick start

See [CLAUDE.md](CLAUDE.md) for the full setup walkthrough — prerequisites, environment variables, MCP config, and first-run instructions.

```bash
# 1. Add your keys to .env
# 2. Install CRM deps
cd crm && bun install && cd ..
# 3. Start everything
./start.sh
# 4. Open a Claude Code session from this directory
claude
```

Then tell Claude:

```
Parse my resume at ~/resume.pdf, find engineering internships in the US,
rank the best matches, and apply to the top one.
Stop before submitting — I'll review first.
```

## Live debug

If cards aren't appearing on the board:

```bash
# Check the server
curl http://localhost:8000/api/health

# Watch the hook log in real time
tail -f /tmp/crm_hook_debug.log
```
