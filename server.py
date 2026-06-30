"""
Support Triage Desk - FastAPI backend.

  GET  /api/tickets            -> inbox: list of synthetic tickets (preview)
  GET  /api/ticket/{name}      -> full ticket text
  POST /api/process            -> triage one ticket (example or pasted)
  GET  /api/events/{job_id}    -> SSE progress + result
  POST /api/finalize           -> send / escalate decision

Run:  python server.py  (http://127.0.0.1:8050)
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Body, FastAPI, Form, Header
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from agents_pipeline import TicketResult, finalize_ticket, run_pipeline

load_dotenv()

ROOT = Path(__file__).parent
WEB_DIR = ROOT / "web"
TICKETS_DIR = ROOT / "synthetic_data" / "tickets"

app = FastAPI(title="Support Triage Desk")
JOBS: dict[str, asyncio.Queue] = {}


def _ticket_path(name: str) -> Optional[Path]:
    safe = Path(name.strip()).name
    if not safe:
        return None
    if not safe.endswith(".txt"):
        safe += ".txt"
    candidate = (TICKETS_DIR / safe).resolve()
    try:
        if candidate.parent == TICKETS_DIR.resolve() and candidate.exists():
            return candidate
    except OSError:
        return None
    return None


def friendly_error(e: Exception) -> str:
    low = str(e).lower()
    if "api key" in low or "api_key" in low:
        return "OpenAI API key missing or rejected. Check OPENAI_API_KEY in .env."
    if "rate limit" in low or "quota" in low:
        return "OpenAI rate limit or quota reached."
    return f"{type(e).__name__}: {e}"


def serialize(r: TicketResult) -> dict:
    return {
        "triage": r.triage.model_dump(),
        "knowledge": r.knowledge.model_dump(),
        "resolution": r.resolution.model_dump(),
        "audit_log": [asdict(e) for e in r.audit_log],
    }


def _preview(text: str) -> dict:
    lines = [l for l in text.splitlines() if l.strip()]
    subject, frm, body = "", "", []
    for l in lines:
        low = l.lower()
        if low.startswith("subject:"):
            subject = l.split(":", 1)[1].strip()
        elif low.startswith("from:"):
            frm = l.split(":", 1)[1].strip()
        elif not low.startswith(("to:", "order:", "channel:")):
            body.append(l)
    return {"subject": subject, "from": frm, "snippet": " ".join(body)[:120]}


def apply_key(key) -> None:
    if key:
        os.environ["OPENAI_API_KEY"] = key
        try:
            from agents import set_default_openai_key
            set_default_openai_key(key)
        except Exception:
            pass


async def run_job(job_id: str, text: str, key=None) -> None:
    q = JOBS[job_id]
    apply_key(key)

    def emit(etype: str, **kw) -> None:
        q.put_nowait({"type": etype, **kw})

    try:
        if not text.strip():
            emit("error", message="No ticket selected.")
            return

        def on_progress(agent: str, status: str) -> None:
            q.put_nowait({"type": "progress", "agent": agent, "status": status})

        result = await run_pipeline(text, on_progress=on_progress)
        emit("result", data=serialize(result))
    except Exception as e:  # noqa: BLE001
        emit("error", message=friendly_error(e))
    finally:
        q.put_nowait(None)


@app.get("/api/tickets")
async def tickets() -> JSONResponse:
    out = []
    for p in sorted(TICKETS_DIR.glob("*.txt")):
        out.append({"name": p.stem, **_preview(p.read_text(encoding="utf-8"))})
    return JSONResponse(out)


@app.get("/api/ticket/{name}")
async def ticket(name: str) -> JSONResponse:
    p = _ticket_path(name)
    if not p:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse({"name": p.stem, "text": p.read_text(encoding="utf-8")})


@app.post("/api/process")
async def process(text: str = Form(""), ticket: str = Form(""), x_openai_key: str = Header(None)) -> JSONResponse:
    body = text
    if ticket.strip():
        p = _ticket_path(ticket)
        if p:
            body = p.read_text(encoding="utf-8")
    job_id = uuid.uuid4().hex
    JOBS[job_id] = asyncio.Queue()
    asyncio.create_task(run_job(job_id, body, key=x_openai_key))
    return JSONResponse({"job_id": job_id})


@app.get("/api/events/{job_id}")
async def events(job_id: str) -> StreamingResponse:
    async def stream():
        q = JOBS.get(job_id)
        if q is None:
            yield f"data: {json.dumps({'type': 'error', 'message': 'unknown job'})}\n\n"
            return
        try:
            while True:
                item = await q.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
        finally:
            JOBS.pop(job_id, None)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/finalize")
async def finalize(payload: dict = Body(...), x_openai_key: str = Header(None)) -> JSONResponse:
    apply_key(x_openai_key)
    try:
        result = await finalize_ticket(
            payload.get("triage") or {}, payload.get("resolution") or {},
            (payload.get("decision") or "approved").lower(),
            payload.get("reply") or "", payload.get("note") or "",
        )
        return JSONResponse(result.model_dump())
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": friendly_error(e)}, status_code=200)


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"openai_key": bool(os.getenv("OPENAI_API_KEY"))})


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8050"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
