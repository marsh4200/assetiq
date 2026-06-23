"""AssetIQ — asset register + licence/compliance expiry tracker.
FastAPI + SQLite, serves the vanilla-JS frontend from /static.
"""
import os
from datetime import date, datetime

from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import database, updater, auth, backup

ROOT = os.path.dirname(os.path.dirname(__file__))
STATIC_DIR = os.path.join(ROOT, "static")

app = FastAPI(title="AssetIQ")


@app.on_event("startup")
def _startup():
    database.init_db()
    auth.ensure_default_admin()
    backup.start_scheduler()


# ---------------------------------------------------------------- models -----
class Asset(BaseModel):
    name: str
    asset_no: int | None = None
    description: str = ""
    category: str = ""
    location: str = ""
    serial_number: str = ""
    assigned_to: str = ""
    notes: str = ""


class Compliance(BaseModel):
    name: str
    category: str = "other"
    reference: str = ""
    responsible_person: str = ""
    expiry_date: str = ""
    last_service_date: str = ""
    next_service_date: str = ""
    notes: str = ""


class SettingsIn(BaseModel):
    business_name: str | None = None
    notify_lead_days: int | None = None
    theme: str | None = None


class LoginIn(BaseModel):
    username: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class UserIn(BaseModel):
    username: str
    password: str
    role: str = "user"


class UserUpdateIn(BaseModel):
    role: str | None = None
    new_password: str | None = None


class BackupConfigIn(BaseModel):
    host: str | None = None
    share: str | None = None
    path: str | None = None
    user: str | None = None
    password: str | None = None
    keep: int | None = None
    daily: bool | None = None


class RestoreSambaIn(BaseModel):
    filename: str


# ---------------------------------------------------------------- auth ------
@app.post("/api/auth/login")
def login(body: LoginIn):
    user = auth.authenticate(body.username.strip(), body.password)
    if not user:
        raise HTTPException(401, "Wrong username or password")
    token = auth.create_session(user["id"])
    return {"token": token, "user": user}


@app.post("/api/auth/logout")
def logout(authorization: str = Header(default="")):
    if authorization.lower().startswith("bearer "):
        auth.delete_session(authorization[7:].strip())
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: dict = Depends(auth.current_user)):
    return user


@app.post("/api/auth/change-password")
def change_password(body: ChangePasswordIn, user: dict = Depends(auth.current_user)):
    fresh = auth.authenticate(user["username"], body.current_password)
    if not fresh:
        raise HTTPException(400, "Current password is incorrect")
    if len(body.new_password) < 4:
        raise HTTPException(400, "New password is too short")
    auth.change_password(user["id"], body.new_password)
    return {"ok": True}


# --------------------------------------------------------------- users ------
@app.get("/api/users")
def get_users(user: dict = Depends(auth.require_admin)):
    return auth.list_users()


@app.post("/api/users")
def add_user(body: UserIn, user: dict = Depends(auth.require_admin)):
    if not body.username.strip() or len(body.password) < 4:
        raise HTTPException(400, "Username and a password of 4+ characters are required")
    return auth.create_user(body.username.strip(), body.password, body.role)


@app.put("/api/users/{user_id}")
def edit_user(user_id: int, body: UserUpdateIn, user: dict = Depends(auth.require_admin)):
    return auth.update_user(user_id, body.role, body.new_password)


@app.delete("/api/users/{user_id}")
def remove_user(user_id: int, user: dict = Depends(auth.require_admin)):
    return auth.delete_user(user_id, user["id"])


# ------------------------------------------------------------- helpers ------
def _parse(d: str):
    if not d:
        return None
    try:
        return datetime.strptime(d.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def _days_until(d: str):
    parsed = _parse(d)
    if parsed is None:
        return None
    return (parsed - date.today()).days


def _status(days, lead):
    """traffic-light status for a number of days remaining."""
    if days is None:
        return "none"
    if days < 0:
        return "expired"
    if days <= lead:
        return "expiring"
    return "valid"


def _lead_days():
    try:
        return int(database.get_settings().get("notify_lead_days", 60))
    except (TypeError, ValueError):
        return 60


# -------------------------------------------------------------- assets ------
@app.get("/api/assets/next-number")
def next_asset_number(user: dict = Depends(auth.current_user)):
    return {"next": database.next_free_asset_no()}


@app.get("/api/assets")
def list_assets(q: str = "", user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        if q:
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT * FROM assets WHERE name LIKE ? OR description LIKE ? "
                "OR category LIKE ? OR location LIKE ? OR serial_number LIKE ? "
                "OR assigned_to LIKE ? ORDER BY asset_no",
                (like, like, like, like, like, like),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM assets ORDER BY asset_no").fetchall()
    return [dict(r) for r in rows]


def _resolve_asset_no(conn, requested, exclude_id=None):
    """Validate a requested label number, or assign the next free one."""
    if requested is None:
        return database.next_free_asset_no()
    if requested < 1:
        raise HTTPException(400, "Label number must be 1 or higher")
    clash = conn.execute(
        "SELECT id FROM assets WHERE asset_no=? AND id IS NOT ?",
        (requested, exclude_id),
    ).fetchone()
    if clash:
        raise HTTPException(409, f"Label number {requested} is already used")
    return requested


@app.post("/api/assets")
def create_asset(a: Asset, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        asset_no = _resolve_asset_no(conn, a.asset_no)
        cur = conn.execute(
            "INSERT INTO assets (asset_no, name, description, category, location, "
            "serial_number, assigned_to, notes) VALUES (?,?,?,?,?,?,?,?)",
            (asset_no, a.name, a.description, a.category, a.location,
             a.serial_number, a.assigned_to, a.notes),
        )
        row = conn.execute("SELECT * FROM assets WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)


@app.put("/api/assets/{asset_id}")
def update_asset(asset_id: int, a: Asset, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        exists = conn.execute("SELECT id FROM assets WHERE id=?", (asset_id,)).fetchone()
        if not exists:
            raise HTTPException(404, "Asset not found")
        asset_no = _resolve_asset_no(conn, a.asset_no, exclude_id=asset_id)
        conn.execute(
            "UPDATE assets SET asset_no=?, name=?, description=?, category=?, location=?, "
            "serial_number=?, assigned_to=?, notes=? WHERE id=?",
            (asset_no, a.name, a.description, a.category, a.location,
             a.serial_number, a.assigned_to, a.notes, asset_id),
        )
        row = conn.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
    return dict(row)


@app.delete("/api/assets/{asset_id}")
def delete_asset(asset_id: int, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        conn.execute("DELETE FROM assets WHERE id=?", (asset_id,))
    return {"ok": True}


# ---------------------------------------------------------- compliance ------
def _decorate_compliance(row, lead):
    d = dict(row)
    exp = _days_until(d.get("expiry_date", ""))
    svc = _days_until(d.get("next_service_date", ""))
    # Pick the soonest meaningful date to drive the status.
    candidates = [x for x in (exp, svc) if x is not None]
    soonest = min(candidates) if candidates else None
    d["days_until_expiry"] = exp
    d["days_until_service"] = svc
    d["days_remaining"] = soonest
    d["status"] = _status(soonest, lead)
    return d


@app.get("/api/compliance")
def list_compliance(category: str = "", q: str = "", user: dict = Depends(auth.current_user)):
    lead = _lead_days()
    with database.db() as conn:
        rows = conn.execute("SELECT * FROM compliance").fetchall()
    items = [_decorate_compliance(r, lead) for r in rows]
    if category:
        items = [i for i in items if i["category"] == category]
    if q:
        ql = q.lower()
        items = [
            i for i in items
            if ql in (i["name"] or "").lower()
            or ql in (i["reference"] or "").lower()
            or ql in (i["responsible_person"] or "").lower()
        ]
    # Sort: soonest-expiring / expired first, undated last.
    items.sort(key=lambda i: (i["days_remaining"] is None, i["days_remaining"] if i["days_remaining"] is not None else 0))
    return items


@app.post("/api/compliance")
def create_compliance(c: Compliance, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        cur = conn.execute(
            "INSERT INTO compliance (name, category, reference, responsible_person, "
            "expiry_date, last_service_date, next_service_date, notes) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (c.name, c.category, c.reference, c.responsible_person,
             c.expiry_date, c.last_service_date, c.next_service_date, c.notes),
        )
        row = conn.execute("SELECT * FROM compliance WHERE id=?", (cur.lastrowid,)).fetchone()
    return _decorate_compliance(row, _lead_days())


@app.put("/api/compliance/{item_id}")
def update_compliance(item_id: int, c: Compliance, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        exists = conn.execute("SELECT id FROM compliance WHERE id=?", (item_id,)).fetchone()
        if not exists:
            raise HTTPException(404, "Item not found")
        conn.execute(
            "UPDATE compliance SET name=?, category=?, reference=?, responsible_person=?, "
            "expiry_date=?, last_service_date=?, next_service_date=?, notes=? WHERE id=?",
            (c.name, c.category, c.reference, c.responsible_person,
             c.expiry_date, c.last_service_date, c.next_service_date, c.notes, item_id),
        )
        row = conn.execute("SELECT * FROM compliance WHERE id=?", (item_id,)).fetchone()
    return _decorate_compliance(row, _lead_days())


@app.delete("/api/compliance/{item_id}")
def delete_compliance(item_id: int, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        conn.execute("DELETE FROM compliance WHERE id=?", (item_id,))
    return {"ok": True}


# ------------------------------------------------------- notifications ------
@app.get("/api/notifications")
def notifications(user: dict = Depends(auth.current_user)):
    lead = _lead_days()
    with database.db() as conn:
        rows = conn.execute("SELECT * FROM compliance").fetchall()
    alerts = []
    for r in rows:
        d = _decorate_compliance(r, lead)
        if d["status"] in ("expiring", "expired"):
            alerts.append(d)
    alerts.sort(key=lambda i: i["days_remaining"] if i["days_remaining"] is not None else 0)
    return {
        "lead_days": lead,
        "count": len(alerts),
        "expired": sum(1 for a in alerts if a["status"] == "expired"),
        "expiring": sum(1 for a in alerts if a["status"] == "expiring"),
        "items": alerts,
    }


# ------------------------------------------------------------ settings ------
@app.get("/api/settings")
def get_settings(user: dict = Depends(auth.current_user)):
    return database.get_settings()


@app.put("/api/settings")
def put_settings(s: SettingsIn, user: dict = Depends(auth.current_user)):
    payload = {k: v for k, v in s.model_dump().items() if v is not None}
    return database.update_settings(payload)


# -------------------------------------------------------------- update ------
@app.get("/api/version")
def version(user: dict = Depends(auth.current_user)):
    return {"version": updater.local_version(), "repo": updater.REPO}


@app.get("/api/update/check")
def update_check(user: dict = Depends(auth.require_admin)):
    return updater.check()


@app.post("/api/update")
def update_now(user: dict = Depends(auth.require_admin)):
    return updater.update()


# -------------------------------------------------------------- backup ------
@app.get("/api/backup/config")
def backup_config(user: dict = Depends(auth.require_admin)):
    return backup.public_config()


@app.put("/api/backup/config")
def backup_config_save(cfg: BackupConfigIn, user: dict = Depends(auth.require_admin)):
    return backup.save_config({k: v for k, v in cfg.model_dump().items() if v is not None})


@app.post("/api/backup/test")
def backup_test(user: dict = Depends(auth.require_admin)):
    try:
        backup.test_connection()
        return {"ok": True, "message": "Connected to the share."}
    except Exception as e:
        return {"ok": False, "message": str(e)}


@app.post("/api/backup/now")
def backup_run(user: dict = Depends(auth.require_admin)):
    return backup.backup_now(push=True)


@app.get("/api/backup/download")
def backup_download(user: dict = Depends(auth.require_admin)):
    data = backup.make_backup_bytes()
    name = backup.backup_filename()
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.get("/api/backup/list")
def backup_list(user: dict = Depends(auth.require_admin)):
    try:
        return {"ok": True, "backups": backup.list_samba_backups()}
    except Exception as e:
        return {"ok": False, "backups": [], "message": str(e)}


@app.post("/api/backup/restore")
async def backup_restore(file: UploadFile = File(...), user: dict = Depends(auth.require_admin)):
    data = await file.read()
    try:
        backup.restore_from_bytes(data)
        return {"ok": True, "message": "Restored. Reloading…"}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/backup/restore-samba")
def backup_restore_samba(body: RestoreSambaIn, user: dict = Depends(auth.require_admin)):
    try:
        backup.restore_from_samba(body.filename)
        return {"ok": True, "message": "Restored from the share. Reloading…"}
    except Exception as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------- static SPA ------
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/health")
def health():
    return JSONResponse({"ok": True})
