"""GitHub-based self-update for AssetIQ.

Flow (matches the AR deploy pattern):
  1. You upload new files to the GitHub repo via the web UI and bump VERSION.
  2. In-app "Update" checks the raw VERSION on the default branch.
  3. If newer, it downloads the branch zipball, copies files over the running
     code (preserving data/ and .git), bumps VERSION, then exits so Docker's
     restart policy brings the container back on the new code.

Requires the project root to be bind-mounted into the container (see
docker-compose.yml) so applied changes persist across the restart.
"""
import io
import os
import shutil
import signal
import threading
import time
import zipfile

import requests

REPO = os.environ.get("ASSETIQ_REPO", "marsh4200/assetiq")
BRANCH = os.environ.get("ASSETIQ_BRANCH", "main")
ROOT = os.path.dirname(os.path.dirname(__file__))
VERSION_FILE = os.path.join(ROOT, "VERSION")

RAW_VERSION_URL = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/VERSION"
ZIP_URL = f"https://codeload.github.com/{REPO}/zip/refs/heads/{BRANCH}"

# Never overwrite these when applying an update.
PRESERVE = {"data", ".git", ".env", "__pycache__"}
TIMEOUT = 20


def local_version() -> str:
    try:
        with open(VERSION_FILE) as f:
            return f.read().strip()
    except FileNotFoundError:
        return "0.0.0"


def _semver(v: str):
    parts = []
    for chunk in v.strip().lstrip("v").split("."):
        digits = "".join(c for c in chunk if c.isdigit())
        parts.append(int(digits) if digits else 0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def check():
    """Return dict with current/latest version and whether an update exists."""
    current = local_version()
    try:
        r = requests.get(RAW_VERSION_URL, timeout=TIMEOUT)
        r.raise_for_status()
        latest = r.text.strip()
    except Exception as e:
        return {
            "current": current,
            "latest": None,
            "update_available": False,
            "error": str(e),
        }
    return {
        "current": current,
        "latest": latest,
        "update_available": _semver(latest) > _semver(current),
        "error": None,
    }


def _apply(zip_bytes: bytes):
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        if not names:
            raise RuntimeError("Downloaded archive was empty")
        top = names[0].split("/")[0] + "/"
        for member in names:
            if member.endswith("/"):
                continue
            rel = member[len(top):] if member.startswith(top) else member
            if not rel:
                continue
            top_seg = rel.split("/")[0]
            if top_seg in PRESERVE:
                continue
            dest = os.path.join(ROOT, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with zf.open(member) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)


def _restart_soon():
    time.sleep(1.5)
    os.kill(os.getpid(), signal.SIGTERM)


def update():
    """Download the latest branch zip, apply it, then schedule a restart."""
    info = check()
    if info.get("error"):
        return {"ok": False, "message": f"Version check failed: {info['error']}", **info}
    if not info["update_available"]:
        return {"ok": False, "message": "Already on the latest version.", **info}

    try:
        r = requests.get(ZIP_URL, timeout=120)
        r.raise_for_status()
        _apply(r.content)
    except Exception as e:
        return {"ok": False, "message": f"Update failed: {e}", **info}

    threading.Thread(target=_restart_soon, daemon=True).start()
    return {
        "ok": True,
        "message": f"Updated to {info['latest']}. Restarting…",
        **info,
    }
