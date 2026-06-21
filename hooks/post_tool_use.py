#!/usr/bin/env python3
"""
PostToolUse hook — fires after every internship MCP tool call.
Forwards results to the local CRM server at localhost:8000.

Real MCP response envelope (from API docs):
  All endpoints return {"result": <actual_payload>}
  job_hash is the stable job ID (not "id" or "job_id")
  apply_link is the URL field (not "url" or "apply_url")
"""
import json, sys, urllib.request, urllib.error, pathlib

CRM_URL = "http://localhost:8000/api/events"
DEBUG_LOG = pathlib.Path("/tmp/crm_hook_debug.log")

TRACKED_TOOLS = {
    "mcp__internship__jobs_list",
    "mcp__internship__jobs_prefilter",
    "mcp__internship__job_get",
    "mcp__internship__packet_build",
    "mcp__internship__resume_compile",
    "mcp__internship__autosubmit_plan",
    "mcp__internship__application_record",
    "mcp__internship__answer_save",
    "mcp__internship__answer_match",
}


def log(msg: str):
    try:
        with open(DEBUG_LOG, "a") as f:
            f.write(msg + "\n")
    except Exception:
        pass


def parse_content_blocks(tool_response):
    """
    MCP tools return content as [{"type": "text", "text": "...json..."}].
    Parse and return the decoded Python object.
    """
    # Already a plain value (pre-parsed by Claude Code)
    if not isinstance(tool_response, dict) or "content" not in tool_response:
        if isinstance(tool_response, str):
            try:
                return json.loads(tool_response)
            except Exception:
                return tool_response
        return tool_response

    content = tool_response["content"]
    if isinstance(content, list):
        texts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        combined = "\n".join(texts).strip()
        try:
            return json.loads(combined)
        except Exception:
            return combined
    elif isinstance(content, str):
        try:
            return json.loads(content)
        except Exception:
            return content
    return content


def unwrap_result(obj):
    """
    Every API response is {"result": <payload>}. Unwrap one level.
    Also handles double-wrapping just in case.
    """
    if isinstance(obj, dict) and "result" in obj:
        inner = obj["result"]
        # unwrap again if still wrapped
        if isinstance(inner, dict) and "result" in inner:
            return inner["result"]
        return inner
    return obj


def extract_job_id(data: dict) -> str:
    """Return the best available job identifier from a job object or input dict."""
    return str(
        data.get("job_hash") or data.get("id") or data.get("job_id") or
        data.get("slug") or data.get("uid") or ""
    )


def job_to_fields(j: dict) -> dict:
    """Normalize a job object from the API into CRM fields."""
    return {
        "company":  j.get("company") or j.get("company_name") or "",
        "title":    j.get("title") or j.get("role") or j.get("job_title") or "",
        "location": j.get("location") or j.get("city") or "",
        "url":      j.get("apply_link") or j.get("url") or j.get("apply_url") or j.get("link") or "",
        "raw":      j,
    }


def normalize_jobs_list(payload, tool_name: str):
    """
    Return a flat list of job dicts from any known response shape.
    prefilter  → {"candidates": [...]}
    jobs_list  → {"jobs": [...]}  or  {"result": {"jobs": [...]}}
    job_get    → single job dict
    """
    if payload is None:
        return []

    if tool_name in ("jobs_prefilter",):
        for key in ("candidates", "jobs", "results", "items"):
            if isinstance(payload, dict) and key in payload and isinstance(payload[key], list):
                return payload[key]

    if tool_name == "jobs_list":
        for key in ("jobs", "candidates", "results", "items"):
            if isinstance(payload, dict) and key in payload and isinstance(payload[key], list):
                return payload[key]

    if tool_name == "job_get":
        if isinstance(payload, dict) and (payload.get("job_hash") or payload.get("title")):
            return [payload]

    if isinstance(payload, list):
        return payload

    return []


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        return

    try:
        hook_data = json.loads(raw)
    except Exception as e:
        log(f"[hook] JSON parse error: {e} | raw[:200]: {raw[:200]}")
        return

    tool_name = hook_data.get("tool_name", "")
    if tool_name not in TRACKED_TOOLS:
        return

    short = tool_name.replace("mcp__internship__", "")
    tool_input  = hook_data.get("tool_input") or {}
    raw_response = hook_data.get("tool_response")

    log(f"\n[hook] tool={short}")
    log(f"  raw_type={type(raw_response).__name__} snippet={str(raw_response)[:200]}")

    # Step 1: parse content blocks → Python object
    parsed = parse_content_blocks(raw_response)
    log(f"  parsed_type={type(parsed).__name__} snippet={str(parsed)[:200]}")

    # Step 2: unwrap {"result": ...} envelope (present on all real API responses)
    payload = unwrap_result(parsed)
    log(f"  payload_type={type(payload).__name__} snippet={str(payload)[:200]}")

    # Step 3: build the event body for the server
    if short in ("jobs_prefilter", "jobs_list"):
        jobs = normalize_jobs_list(payload, short)
        log(f"  jobs_count={len(jobs)}")
        output = jobs
    elif short == "job_get":
        # Send as a single dict, not a list — server handles it as one job
        jobs = normalize_jobs_list(payload, short)
        output = jobs[0] if jobs else payload
        log(f"  job_get_id={output.get('job_hash') if isinstance(output, dict) else '?'}")
    else:
        output = payload

    # Resolve job_hash from input for stage-advancing tools
    # (packet_build, resume_compile, autosubmit_plan get job_hash from their input)
    job_hash_from_input = extract_job_id(tool_input) if isinstance(tool_input, dict) else ""
    if job_hash_from_input:
        log(f"  job_hash_from_input={job_hash_from_input}")

    event = {
        "tool":   short,
        "input":  {**tool_input, "_job_hash": job_hash_from_input} if job_hash_from_input else tool_input,
        "output": output,
        "meta":   {"raw_tool": tool_name},
    }

    payload_bytes = json.dumps(event).encode()

    try:
        req = urllib.request.Request(
            CRM_URL,
            data=payload_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read())
            log(f"  server_response={result}")
    except urllib.error.URLError as e:
        log(f"  server_error={e}")
    except Exception as e:
        log(f"  unexpected_error={e}")


if __name__ == "__main__":
    main()
