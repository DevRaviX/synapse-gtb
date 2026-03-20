"""
Synapse GTB — Vercel Serverless API
Zero heavy dependencies. Only fastapi.
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os, json, traceback

app = FastAPI()

@app.exception_handler(Exception)
async def catch_all(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={
        "error": str(exc),
        "trace": traceback.format_exc(),
    })

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.get("/api/health")
def health():
    return {"ok": True, "env": "vercel"}

@app.get("/api/status")
def status():
    return {
        "session_id": None, "seq": 0, "latest_hash": "",
        "prev_hash": "", "batches": 0, "running": False,
        "camera_mode": "serverless",
        "message": "Live pipeline unavailable on serverless. Use Demo Mode."
    }

@app.get("/api/recordings")
def recordings():
    # Try Supabase if available, otherwise return empty
    try:
        url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY")
        if url and key:
            from supabase import create_client
            sb = create_client(url, key)
            objs = sb.storage.from_("sessions").list("")
            recs = []
            for item in objs:
                name = item.get("name", "")
                if not name or name.startswith("."): continue
                try:
                    data = sb.storage.from_("sessions").download(f"{name}/manifest.json")
                    m = json.loads(data)
                    recs.append({
                        "session_id": name,
                        "records": len(m.get("records", [])),
                        "batches": len(m.get("merkle_batches", [])),
                        "genesis_hash": m.get("genesis_hash", ""),
                    })
                except: continue
            return recs
    except: pass
    return []

@app.post("/api/start")
def start():
    return {"status": "unavailable", "message": "Recording requires local backend. Use Demo Mode on Vercel."}

@app.post("/api/stop")
def stop():
    return {"status": "not_running"}

@app.post("/api/verify/{session_id}")
def verify(session_id: str):
    try:
        url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY")
        if url and key:
            from supabase import create_client
            sb = create_client(url, key)
            data = sb.storage.from_("sessions").download(f"{session_id}/manifest.json")
            m = json.loads(data)
            records = m.get("records", [])
            valid = True
            broken = None
            for i, r in enumerate(records):
                if i > 0 and r.get("prev_hash") != records[i-1].get("chain_hash"):
                    valid = False
                    broken = i
                    break
            return {"valid": valid, "records_checked": len(records), "broken_at": broken}
    except Exception as e:
        return {"error": str(e)}
    return {"error": "Supabase not configured"}

@app.post("/api/tamper/{session_id}/{seq}")
def tamper(session_id: str, seq: int):
    return {"status": "unavailable", "message": "Tamper simulation requires local backend."}

@app.get("/telemetry.json")
def telemetry():
    return {"metrics": []}

@app.get("/audit_trail.json")
def audit_trail():
    return {"entries": []}

handler = app
