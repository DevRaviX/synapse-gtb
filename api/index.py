import sys
import os

# Add backend directory to path so we can import from app
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.api import app

# Vercel needs "app" to be defined
# We use the app from our FastAPI submodule
handler = app
