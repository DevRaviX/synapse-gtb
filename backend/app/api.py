"""FastAPI endpoints for the surgical black box backend.

Endpoints:
  GET  /api/health              — health check
  GET  /api/status              — live session chain state
  GET  /api/recordings          — list all stored sessions
  GET  /api/stream              — MJPEG live video stream
  WS   /ws/live                 — real-time chain hash + vitals
  POST /api/start               — start recording session
  POST /api/stop                — stop recording session
  POST /api/verify/{session_id} — re-verify a session's chain integrity
  POST /api/tamper/{session_id}/{seq} — simulate tampering
"""

import asyncio
import os
import json
import time
from enum import Enum
from typing import cast, Dict, Any, Optional, List
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from .config import BASE_DATA_DIR
from .storage import load_manifest, save_manifest, load_json, save_json
from .verifier import verify_session
from .capture import start_pipeline as camera_start, get_jpeg, get_mode, is_running as camera_is_running

app = FastAPI(title="Surgical Black Box API", version="2.0.0")

# ── Deployment: Serve Frontend Static Files ──
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRONTEND_DIST = os.path.join(ROOT_DIR, "frontend", "dist")

# Allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Shared state (set by main.py when pipeline starts) ──
_live_state = {
    "session_id": None,
    "seq": 0,
    "latest_hash": "",
    "prev_hash": "",
    "batches": 0,
    "running": False,
    "camera_mode": "none",
}


def set_live_state(session_id, seq, latest_hash, prev_hash, batches, running=True):
    _live_state.update({
        "session_id": session_id,
        "seq": seq,
        "latest_hash": latest_hash,
        "prev_hash": prev_hash,
        "batches": batches,
        "running": running,
        "camera_mode": get_mode(),
    })


# ── Endpoints ──

@app.get("/api/health")
async def health():
    return {"ok": True, "camera_mode": get_mode()}


@app.get("/api/status")
async def status():
    from .main import get_pipeline_running, get_current_session_id
    _live_state["running"] = get_pipeline_running()
    _live_state["camera_mode"] = get_mode()
    if not _live_state["session_id"]:
        _live_state["session_id"] = get_current_session_id()
    return _live_state


@app.get("/api/recordings")
async def list_recordings():
    """List all stored sessions with summary info."""
    sessions_dir = os.path.abspath(BASE_DATA_DIR)
    if not os.path.exists(sessions_dir):
        return []

    recordings = []
    for sid in sorted(os.listdir(str(sessions_dir))):
        manifest_path = os.path.join(str(sessions_dir), str(sid), "manifest.json")
        if os.path.exists(manifest_path):
            manifest = cast(Dict[str, Any], load_manifest(manifest_path))
            recordings.append({
                "session_id": sid,
                "records": len(manifest.get("records", [])),
                "batches": len(manifest.get("merkle_batches", [])),
                "genesis_hash": manifest.get("genesis_hash", ""),
            })

    return recordings


# ── MJPEG Live Stream ──

async def mjpeg_generator():
    """Yield JPEG frames as multipart stream."""
    while True:
        jpeg_bytes = get_jpeg()
        if jpeg_bytes:
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + jpeg_bytes
                + b"\r\n"
            )
        await asyncio.sleep(1.0 / 15)  # ~15 FPS for streaming


@app.get("/api/stream")
async def video_stream():
    """MJPEG live video stream endpoint."""
    # Ensure camera is started for streaming even outside a recording session
    if not camera_is_running():
        camera_start()
    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/api/frame/{session_id}/{seq}")
async def get_session_frame(session_id: str, seq: int):
    """Retrieve a specific frame from a recorded session."""
    session_dir = os.path.join(os.path.abspath(BASE_DATA_DIR), session_id)
    manifest_path = os.path.join(session_dir, "manifest.json")

    if not os.path.exists(manifest_path):
        raise HTTPException(status_code=404, detail="Session not found")

    manifest = load_manifest(manifest_path)
    records = manifest.get("records", [])

    # Find record by seq
    rec = next((r for r in records if r["seq"] == seq), None)
    if not rec:
        raise HTTPException(status_code=404, detail="Frame not found")

    frame_path = os.path.join(session_dir, rec["frame"])
    if not os.path.exists(frame_path):
        raise HTTPException(status_code=404, detail="Frame file missing")

    return FileResponse(frame_path, media_type="image/jpeg")

# ── WebSocket for real-time chain data ──

@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    """WebSocket endpoint for real-time chain hash + vitals updates."""
    from .main import register_ws, unregister_ws
    await ws.accept()
    register_ws(ws)
    try:
        while True:
            # Keep connection alive, client doesn't send data
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        unregister_ws(ws)


# ── Start / Stop Pipeline ──

@app.post("/api/start")
async def start_session(duration: int = Query(default=0)):
    """Start a new recording session."""
    from .main import get_pipeline_running, start_pipeline_async
    if get_pipeline_running():
        return {"status": "already_running", "session_id": _live_state.get("session_id")}

    task = await start_pipeline_async(duration)
    # Give it a moment to initialize
    await asyncio.sleep(0.5)
    from .main import get_current_session_id
    return {
        "status": "started",
        "session_id": get_current_session_id(),
        "camera_mode": get_mode(),
    }


@app.post("/api/stop")
async def stop_session():
    """Stop the current recording session."""
    from .main import get_pipeline_running, stop_pipeline, get_current_session_id
    if not get_pipeline_running():
        return {"status": "not_running"}

    sid = get_current_session_id()
    stop_pipeline()
    # Wait for pipeline to cleanly finish
    await asyncio.sleep(1.0)
    return {
        "status": "stopped",
        "session_id": sid,
    }


# ── Verify + Tamper ──

@app.post("/api/verify/{session_id}")
async def verify_recording(session_id: str):
    """Re-verify a session's hash chain integrity."""
    session_dir = os.path.join(os.path.abspath(BASE_DATA_DIR), session_id)
    manifest_path = os.path.join(session_dir, "manifest.json")

    if not os.path.exists(manifest_path):
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    manifest = load_manifest(manifest_path)
    result = verify_session(session_dir, manifest)
    return result


class TamperMode(str, Enum):
    modify_vitals = "modify_vitals"
    modify_frame = "modify_frame"
    delete_frame = "delete_frame"
    reorder = "reorder"


@app.post("/api/tamper/{session_id}/{seq}")
async def tamper_record(
    session_id: str,
    seq: int,
    mode: TamperMode = Query(default=TamperMode.modify_vitals),
):
    """Simulate tampering on a stored record for demo purposes."""
    session_dir = os.path.join(os.path.abspath(BASE_DATA_DIR), session_id)
    manifest_path = os.path.join(session_dir, "manifest.json")

    if not os.path.exists(manifest_path):
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    manifest = load_manifest(manifest_path)
    records = manifest.get("records", [])

    # Find record by seq
    rec = None
    rec_idx = None
    for i, r in enumerate(records):
        if r["seq"] == seq:
            rec = r
            rec_idx = i
            break

    if rec_idx is None:
        raise HTTPException(status_code=404, detail=f"Record seq={seq} not found")
    
    # Cast for Pyre linter to ensure it knows rec_idx is int
    rec_idx = cast(int, rec_idx)

    # Narrow type for Pyre
    r_ptr = cast(Dict[str, Any], records[rec_idx])

    if mode == TamperMode.modify_vitals:
        vitals_path = os.path.join(session_dir, str(r_ptr["vitals"]))
        vitals = cast(Dict[str, Any], load_json(vitals_path))
        vitals["hr"] = int(vitals.get("hr", 80)) + 20
        save_json(vitals, vitals_path)

    elif mode == TamperMode.modify_frame:
        frame_path = os.path.join(session_dir, str(r_ptr["frame"]))
        with open(frame_path, "r+b") as f:
            data = bytearray(f.read())
            end = min(len(data), 200)
            start = min(100, end)
            for i in range(start, end):
                data[i] = 0xFF
            f.seek(0)
            f.write(data)
            f.truncate()

    elif mode == TamperMode.delete_frame:
        frame_path = os.path.join(session_dir, str(r_ptr["frame"]))
        if os.path.exists(frame_path):
            os.remove(frame_path)

    elif mode == TamperMode.reorder:
        if rec_idx + 1 < len(records):
            next_rec = cast(Dict[str, Any], records[rec_idx + 1])
            v_path_a = os.path.join(session_dir, str(r_ptr["vitals"]))
            v_path_b = os.path.join(session_dir, str(next_rec["vitals"]))
            v_a = load_json(v_path_a)
            v_b = load_json(v_path_b)
            save_json(v_b, v_path_a)
            save_json(v_a, v_path_b)
        else:
            raise HTTPException(status_code=400, detail="Cannot reorder last record")

    return {"status": "tampered", "mode": mode.value, "seq": seq}

# ── Static File Overlay (Deployment) ──
if os.path.exists(FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="static")
