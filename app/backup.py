"""Backup / restore for AssetIQ.

A backup is a zip of the SQLite database (which holds everything: assets,
tracker items, users, settings) plus a small manifest. Backups can be:
  - downloaded straight to the browser,
  - pushed to a Samba/CIFS share on a schedule (once a day) with rotation,
  - restored from an uploaded zip or from a share copy.

Samba is spoken over SMB2/3 with the pure-python `smbprotocol` client, so no
privileged CIFS mount is needed inside the container.
"""
import io
import json
import os
import sqlite3
import threading
import time
import zipfile
from datetime import date, datetime

from .database import DB_PATH, get_settings, update_settings

PREFIX = "assetiq-backup-"


# --------------------------------------------------------------- config -----
def get_config():
    s = get_settings()
    return {
        "host": s.get("smb_host", ""),
        "share": s.get("smb_share", ""),
        "path": s.get("smb_path", ""),
        "user": s.get("smb_user", ""),
        "password": s.get("smb_password", ""),
        "keep": int(s.get("backup_keep", "3") or 3),
        "daily": s.get("backup_daily", "0") == "1",
        "last_backup_at": s.get("last_backup_at", ""),
        "last_backup_status": s.get("last_backup_status", ""),
    }


def public_config():
    c = get_config()
    return {
        "host": c["host"], "share": c["share"], "path": c["path"],
        "user": c["user"], "keep": c["keep"], "daily": c["daily"],
        "has_password": bool(c["password"]),
        "last_backup_at": c["last_backup_at"],
        "last_backup_status": c["last_backup_status"],
    }


def save_config(data: dict):
    out = {}
    if "host" in data:  out["smb_host"] = (data["host"] or "").strip()
    if "share" in data: out["smb_share"] = (data["share"] or "").strip()
    if "path" in data:  out["smb_path"] = (data["path"] or "").strip()
    if "user" in data:  out["smb_user"] = (data["user"] or "").strip()
    if "keep" in data:  out["backup_keep"] = str(max(1, int(data["keep"])))
    if "daily" in data: out["backup_daily"] = "1" if data["daily"] else "0"
    if data.get("password"):
        out["smb_password"] = data["password"]
    update_settings(out)
    return public_config()


# --------------------------------------------------------------- zip --------
def make_backup_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        if os.path.exists(DB_PATH):
            z.write(DB_PATH, "assetiq.db")
        z.writestr("manifest.json", json.dumps({
            "app": "assetiq",
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }))
    return buf.getvalue()


def backup_filename():
    return f"{PREFIX}{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"


def _validate_db_bytes(db_bytes: bytes):
    tmp = DB_PATH + ".verify"
    with open(tmp, "wb") as f:
        f.write(db_bytes)
    try:
        conn = sqlite3.connect(tmp)
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        conn.close()
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    if not {"assets", "compliance", "users"} <= tables:
        raise ValueError("That zip isn't a valid AssetIQ backup.")


def restore_from_bytes(data: bytes):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if "assetiq.db" not in z.namelist():
            raise ValueError("That zip isn't a valid AssetIQ backup.")
        db_bytes = z.read("assetiq.db")
    _validate_db_bytes(db_bytes)
    tmp = DB_PATH + ".restore"
    with open(tmp, "wb") as f:
        f.write(db_bytes)
    os.replace(tmp, DB_PATH)   # atomic swap; connections are per-request
    return True


# --------------------------------------------------------------- samba ------
def _smb(cfg):
    import smbclient
    if not cfg["host"] or not cfg["share"]:
        raise ValueError("Samba host and share are not configured.")
    smbclient.reset_connection_cache()
    smbclient.register_session(
        cfg["host"], username=cfg["user"], password=cfg["password"])
    base = rf"\\{cfg['host']}\{cfg['share']}"
    sub = cfg["path"].strip("\\/").replace("/", "\\")
    if sub:
        base = base + "\\" + sub
    return smbclient, base


def test_connection():
    cfg = get_config()
    smb, base = _smb(cfg)
    smb.makedirs(base, exist_ok=True)
    smb.listdir(base)
    return True


def _rotate(smb, base, keep):
    try:
        names = [n for n in smb.listdir(base) if n.startswith(PREFIX) and n.endswith(".zip")]
    except Exception:
        return
    names.sort()
    drop = names[:-keep] if keep > 0 else []
    for old in drop:
        try:
            smb.remove(base + "\\" + old)
        except Exception:
            pass


def list_samba_backups():
    cfg = get_config()
    smb, base = _smb(cfg)
    try:
        names = [n for n in smb.listdir(base) if n.startswith(PREFIX) and n.endswith(".zip")]
    except Exception:
        names = []
    names.sort(reverse=True)
    return names


def restore_from_samba(filename: str):
    cfg = get_config()
    smb, base = _smb(cfg)
    with smb.open_file(base + "\\" + filename, mode="rb") as f:
        data = f.read()
    return restore_from_bytes(data)


def _record(status: str):
    update_settings({
        "last_backup_at": datetime.now().isoformat(timespec="seconds"),
        "last_backup_status": status,
        "last_backup_date": date.today().isoformat(),
    })


def backup_now(push: bool = True):
    data = make_backup_bytes()
    name = backup_filename()
    cfg = get_config()
    if push and cfg["host"] and cfg["share"]:
        try:
            smb, base = _smb(cfg)
            smb.makedirs(base, exist_ok=True)
            with smb.open_file(base + "\\" + name, mode="wb") as f:
                f.write(data)
            _rotate(smb, base, cfg["keep"])
            _record(f"Pushed {name}")
            return {"ok": True, "filename": name, "pushed": True,
                    "message": f"Backed up to the share as {name}."}
        except Exception as e:
            _record(f"Failed: {e}")
            return {"ok": False, "pushed": False, "message": f"Samba backup failed: {e}"}
    _record(f"Local snapshot {name}")
    return {"ok": True, "filename": name, "pushed": False,
            "message": "Backup created (no share configured to push to)."}


# ----------------------------------------------------------- scheduler ------
def _due_today():
    s = get_settings()
    return s.get("last_backup_date", "") != date.today().isoformat()


def _loop():
    while True:
        try:
            cfg = get_config()
            if cfg["daily"] and cfg["host"] and cfg["share"] and _due_today():
                backup_now(push=True)
        except Exception:
            pass
        time.sleep(3600)


def start_scheduler():
    threading.Thread(target=_loop, daemon=True).start()
