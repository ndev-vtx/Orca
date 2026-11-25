# Vercel entrypoint — mounts the Orca FastAPI app as a serverless function.
# Serverless quirks handled here:
#   - no persistent disk: SQLite + audio cache live under /tmp for the
#     invocation's instance lifetime (set ORCA_DATA_DIR from the dashboard to
#     point at a managed store later),
#   - the frontend is served as static assets by the platform, so the
#     backend's static mount never activates (no frontend/dist inside the
#     function bundle layout).
import os
import sys

os.environ.setdefault("ORCA_DATA_DIR", "/tmp/orca-data")

_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from orca.server import app  # noqa: E402

handler = app
