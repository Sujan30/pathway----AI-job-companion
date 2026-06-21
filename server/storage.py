import json, threading
from pathlib import Path
from datetime import datetime, timezone

DATA_FILE = Path(__file__).parent / "data.json"
_lock = threading.Lock()

_default = {"jobs": {}, "applications": {}, "events": []}


def _read() -> dict:
    if not DATA_FILE.exists():
        return {k: v.copy() if isinstance(v, dict) else list(v) for k, v in _default.items()}
    with open(DATA_FILE) as f:
        return json.load(f)


def _write(data: dict):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)


def upsert_job(job_id: str, job_data: dict):
    with _lock:
        data = _read()
        existing = data["jobs"].get(job_id, {})
        data["jobs"][job_id] = {**existing, **job_data, "id": job_id, "updated_at": _now()}
        _write(data)
    return data["jobs"][job_id]


def upsert_application(app_id: str, app_data: dict):
    with _lock:
        data = _read()
        existing = data["applications"].get(app_id, {})
        data["applications"][app_id] = {**existing, **app_data, "id": app_id, "updated_at": _now()}
        _write(data)
    return data["applications"][app_id]


def append_event(event: dict):
    with _lock:
        data = _read()
        event["timestamp"] = _now()
        data["events"].append(event)
        data["events"] = data["events"][-500:]  # keep last 500
        _write(data)


def get_all() -> dict:
    with _lock:
        return _read()


def delete_job(job_id: str):
    with _lock:
        data = _read()
        data["jobs"].pop(job_id, None)
        _write(data)


def get_jobs() -> list:
    return list(get_all()["jobs"].values())


def get_applications() -> list:
    return list(get_all()["applications"].values())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
