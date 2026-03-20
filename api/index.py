import sys
import os
from fastapi import FastAPI

# Root directory is the parent of api/
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# Ensure backend directory is also in path
BACKEND_DIR = os.path.join(ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

app = FastAPI()

@app.get("/api/py_health")
def py_health():
    return {
        "status": "online",
        "deployment": "vercel",
        "root": ROOT
    }

try:
    # We import from the package structure
    from backend.app.api import app as real_app
    app.mount("/api", real_app)
except Exception as e:
    @app.get("/api/error")
    def error():
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

handler = app
