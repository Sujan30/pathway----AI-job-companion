import asyncio, json
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel
from typing import Any, Optional
import storage

app = FastAPI(title="Job Application CRM Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# SSE subscriber queues
_subscribers: list[asyncio.Queue] = []


async def _broadcast(event_type: str, data: Any):
    msg = json.dumps({"type": event_type, "data": data})
    dead = []
    for q in _subscribers:
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _subscribers.remove(q)


# ── SSE stream ──────────────────────────────────────────────────────────────

@app.get("/api/stream")
async def stream(request: Request):
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.append(q)

    async def generator():
        # Send current state on connect
        all_data = storage.get_all()
        yield {"event": "snapshot", "data": json.dumps(all_data)}
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    yield {"event": "update", "data": msg}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
        finally:
            if q in _subscribers:
                _subscribers.remove(q)

    return EventSourceResponse(generator())


# ── Event ingestion (from hooks / Claude sessions) ──────────────────────────

class CRMEvent(BaseModel):
    tool: str
    input: Optional[dict] = None
    output: Optional[Any] = None
    meta: Optional[dict] = None


STAGE_MAP = {
    "packet_build":    "packet_built",
    "resume_compile":  "resume_compiled",
    "autosubmit_plan": "ready_to_submit",
}


def _extract_job_id(data: dict) -> str:
    """job_hash is the canonical ID per API docs. Fall back to legacy names."""
    return str(
        data.get("job_hash") or data.get("id") or data.get("job_id") or
        data.get("slug") or data.get("uid") or ""
    )


def _job_fields(j: dict) -> dict:
    """Normalize any job object from the API into our storage schema."""
    return {
        "company":  j.get("company") or j.get("company_name") or "",
        "title":    j.get("title") or j.get("role") or j.get("job_title") or "",
        "location": j.get("location") or j.get("city") or "",
        # apply_link is the canonical URL field per API docs
        "url": j.get("apply_link") or j.get("url") or j.get("apply_url") or j.get("link") or "",
        "description": j.get("description") or j.get("description_preview") or "",
        "required_skills": j.get("required_skills") or j.get("skill_matches") or [],
        "raw": j,
    }


@app.post("/api/events")
async def ingest_event(event: CRMEvent):
    storage.append_event({"tool": event.tool, "meta": event.meta})
    updated = []

    # ── jobs_list / jobs_prefilter — bulk upsert shortlisted jobs ─────────────
    if event.tool in ("jobs_list", "jobs_prefilter") and isinstance(event.output, list):
        for j in event.output:
            if not isinstance(j, dict):
                continue
            job_id = _extract_job_id(j)
            if not job_id:
                continue
            # Only filter out hard-failed jobs from prefilter
            if event.tool == "jobs_prefilter" and j.get("hard_filter_passed") is False:
                continue
            saved = storage.upsert_job(job_id, {**_job_fields(j), "stage": "shortlisted"})
            updated.append(saved)

    # ── job_get — enrich a single job, advance to researched ──────────────────
    elif event.tool == "job_get":
        j = event.output if isinstance(event.output, dict) else {}
        # job_hash may also be in input if output is empty
        job_id = _extract_job_id(j) or _extract_job_id(event.input or {})
        if job_id:
            saved = storage.upsert_job(job_id, {**_job_fields(j), "stage": "researched"})
            updated.append(saved)

    # ── packet_build / resume_compile / autosubmit_plan — advance stage ───────
    elif event.tool in STAGE_MAP:
        inp = event.input or {}
        # Hook injects _job_hash from input; also try direct fields
        job_id = _extract_job_id(inp)
        if job_id:
            saved = storage.upsert_job(job_id, {"stage": STAGE_MAP[event.tool]})
            updated.append(saved)

    # ── application_record — mark applied, store application record ───────────
    elif event.tool == "application_record":
        out = event.output if isinstance(event.output, dict) else {}
        inp = event.input or {}
        job_id = _extract_job_id(out) or _extract_job_id(inp)
        app_id = str(out.get("id") or out.get("record_id") or job_id)
        if job_id:
            storage.upsert_job(job_id, {"stage": "applied"})
        saved = storage.upsert_application(app_id, {
            "job_id": job_id,
            "status": out.get("status") or "applied",
            "submitted_at": out.get("submitted_at") or out.get("applied_at") or "",
            "notes": out.get("notes") or "",
        })
        updated.append(saved)

    # ── answer_save / answer_match — no stage change, just log ────────────────
    # (already appended to events above)

    await _broadcast("update", {"tool": event.tool, "updated": updated})
    return {"ok": True, "updated_count": len(updated)}


# ── Read endpoints ───────────────────────────────────────────────────────────

@app.get("/api/jobs")
def list_jobs():
    return storage.get_jobs()


@app.get("/api/applications")
def list_applications():
    return storage.get_applications()


@app.get("/api/snapshot")
def snapshot():
    return storage.get_all()


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ── Manual override ──────────────────────────────────────────────────────────

class StageUpdate(BaseModel):
    stage: Optional[str] = None
    notes: Optional[str] = None
    deadline: Optional[str] = None
    type: Optional[str] = None
    company: Optional[str] = None
    title: Optional[str] = None


@app.patch("/api/jobs/{job_id}")
async def update_job(job_id: str, body: StageUpdate):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    saved = storage.upsert_job(job_id, patch)
    await _broadcast("update", {"tool": "manual_override", "updated": [saved]})
    return saved


class NewJob(BaseModel):
    id: Optional[str] = None
    company: str
    title: str
    type: Optional[str] = "Internship"
    notes: Optional[str] = ""
    deadline: Optional[str] = ""
    stage: Optional[str] = "shortlisted"
    color: Optional[str] = None
    url: Optional[str] = ""


@app.post("/api/jobs")
async def create_job(body: NewJob):
    import time
    job_id = body.id or f"ui-{int(time.time() * 1000)}"
    data = body.model_dump()
    data.pop("id", None)
    saved = storage.upsert_job(job_id, data)
    await _broadcast("update", {"tool": "ui_create", "updated": [saved]})
    return saved


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    storage.delete_job(job_id)
    await _broadcast("update", {"tool": "ui_delete", "deleted_id": job_id, "updated": []})
    return {"ok": True}
