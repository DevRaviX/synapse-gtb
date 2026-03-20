"""
Vercel Serverless API — Self-contained FastAPI app.

This file does NOT import from backend/app/ because Vercel's Python runtime
cannot install heavy dependencies like opencv-python-headless or web3.
Instead, it talks directly to Supabase for all data operations.
"""

import os
import json
import traceback
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── Supabase Client (inline, no dependency on backend/) ──
_supabase = None
BUCKET_NAME = "sessions"

def get_supabase():
    global _supabase
    if _supabase is not None:
        return _supabase
    try:
        from supabase import create_client
        url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY")
        if url and key:
            _supabase = create_client(url, key)
            return _supabase
    except Exception as e:
        print(f"[SUPABASE] Init failed: {e}")
    return None


# ── FastAPI App ──
app = FastAPI(title="Synapse GTB API (Vercel)", version="2.0.0")

# Global error handler — returns traceback in response for debugging
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": str(exc),
            "traceback": traceback.format_exc(),
            "path": request.url.path,
        },
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ──
@app.get("/api/health")
async def health():
    sb = get_supabase()
    return {
        "ok": True,
        "deployment": "vercel",
        "supabase_connected": sb is not None,
    }


# ── Status ──
@app.get("/api/status")
async def status():
    """Return pipeline status. On Vercel there is no live pipeline."""
    return {
        "session_id": None,
        "seq": 0,
        "latest_hash": "",
        "prev_hash": "",
        "batches": 0,
        "running": False,
        "camera_mode": "serverless",
        "deployment": "vercel",
        "message": "Live pipeline is not available on serverless. Use Demo Mode to explore.",
    }


# ── Recordings ──
@app.get("/api/recordings")
async def list_recordings():
    """List sessions from Supabase Storage bucket."""
    sb = get_supabase()
    if not sb:
        return []

    try:
        objs = sb.storage.from_(BUCKET_NAME).list("")
        recordings = []
        for item in objs:
            name = item.get("name", "")
            if not name or name.startswith("."):
                continue
            # Try to download manifest
            try:
                data = sb.storage.from_(BUCKET_NAME).download(f"{name}/manifest.json")
                manifest = json.loads(data)
                recordings.append({
                    "session_id": name,
                    "records": len(manifest.get("records", [])),
                    "batches": len(manifest.get("merkle_batches", [])),
                    "genesis_hash": manifest.get("genesis_hash", ""),
                })
            except Exception:
                continue
        return recordings
    except Exception as e:
        print(f"[RECORDINGS] Error: {e}")
        return []


# ── Start / Stop (serverless stubs) ──
@app.post("/api/start")
async def start_session(duration: int = Query(default=0)):
    """Cannot start real recording on serverless. Return helpful message."""
    return {
        "status": "unavailable",
        "message": "Live recording requires the local backend (python -m app.main --with-api). "
                   "On Vercel, use Demo Mode to explore pre-recorded sessions.",
    }


@app.post("/api/stop")
async def stop_session():
    return {"status": "not_running", "message": "No pipeline running on serverless."}


# ── Verify ──
@app.post("/api/verify/{session_id}")
async def verify_recording(session_id: str):
    """Verify session integrity from Supabase manifest."""
    sb = get_supabase()
    if not sb:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    try:
        data = sb.storage.from_(BUCKET_NAME).download(f"{session_id}/manifest.json")
        manifest = json.loads(data)
        records = manifest.get("records", [])

        # Basic chain verification
        is_valid = True
        broken_at = None
        for i, rec in enumerate(records):
            if i > 0:
                if rec.get("prev_hash", "") != records[i - 1].get("chain_hash", ""):
                    is_valid = False
                    broken_at = i
                    break

        return {
            "valid": is_valid,
            "records_checked": len(records),
            "broken_at": broken_at,
            "genesis_hash": manifest.get("genesis_hash", ""),
        }
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found: {e}")


# ── Tamper (serverless stub) ──
@app.post("/api/tamper/{session_id}/{seq}")
async def tamper_record(session_id: str, seq: int, mode: str = Query(default="modify_vitals")):
    return {
        "status": "unavailable",
        "message": "Tamper simulation requires the local backend.",
    }


# ── Static file stubs ──
@app.get("/telemetry.json")
async def telemetry():
    return {"metrics": [], "message": "No telemetry on serverless deployment"}

@app.get("/audit_trail.json")
async def audit_trail():
    return {"entries": [], "message": "Audit trail is generated locally during recording"}


# Vercel handler
handler = app
