"""AssetIQ — asset register + licence/compliance expiry tracker.
FastAPI + SQLite, serves the vanilla-JS frontend from /static.
"""
import json
import os
from datetime import date, datetime

from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import database, updater, auth, backup, reports

ROOT = os.path.dirname(os.path.dirname(__file__))
STATIC_DIR = os.path.join(ROOT, "static")

app = FastAPI(title="AssetIQ")


@app.on_event("startup")
def _startup():
    database.init_db()
    auth.ensure_default_admin()
    database.ensure_default_checklist()
    database.ensure_default_groups()
    backup.start_scheduler()


# ---------------------------------------------------------------- models -----
class Asset(BaseModel):
    name: str
    prefix: str = "OF"
    asset_no: int | None = None
    description: str = ""
    category: str = ""
    location: str = ""
    serial_number: str = ""
    assigned_to: str = ""
    notes: str = ""
    purchase_date: str = ""
    cost: str = ""
    supplier: str = ""
    warranty_expiry: str = ""
    photo: str | None = None        # base64 data URL; None = leave unchanged


class Compliance(BaseModel):
    name: str
    category: str = "other"
    reference: str = ""
    responsible_person: str = ""
    issue_date: str = ""
    expiry_date: str = ""
    last_service_date: str = ""
    next_service_date: str = ""
    notes: str = ""


class RenewIn(BaseModel):
    new_due: str                # new expiry date, or next service due (required)
    issue_date: str = ""        # date newly issued (optional)
    service_date: str = ""      # for machines: when the service was done
    note: str = ""


class AssetGroupIn(BaseModel):
    name: str
    prefix: str


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


class ChecklistTemplateIn(BaseModel):
    name: str
    description: str = ""
    items: list = []
    ask_odometer: bool = False
    active: bool = True


class ChecklistRunIn(BaseModel):
    template_id: int | None = None
    driver_name: str
    odometer: str = ""
    results: dict = {}
    notes: str = ""


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
def next_asset_number(prefix: str = "OF", user: dict = Depends(auth.current_user)):
    return {"next": database.next_free_asset_no(prefix)}


@app.get("/api/asset-groups")
def list_groups(user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        rows = conn.execute("SELECT * FROM asset_groups ORDER BY sort, name").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/asset-groups")
def create_group(g: AssetGroupIn, user: dict = Depends(auth.require_admin)):
    name = g.name.strip()
    prefix = g.prefix.strip().upper()
    if not name or not prefix:
        raise HTTPException(400, "Name and prefix are required")
    if not prefix.isalnum():
        raise HTTPException(400, "Prefix must be letters/numbers only")
    with database.db() as conn:
        if conn.execute("SELECT id FROM asset_groups WHERE prefix=?", (prefix,)).fetchone():
            raise HTTPException(409, f"Prefix {prefix} already exists")
        nxt = conn.execute("SELECT COALESCE(MAX(sort),0)+1 s FROM asset_groups").fetchone()["s"]
        cur = conn.execute("INSERT INTO asset_groups (name, prefix, sort) VALUES (?,?,?)",
                           (name, prefix, nxt))
        row = conn.execute("SELECT * FROM asset_groups WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)


@app.put("/api/asset-groups/{group_id}")
def update_group(group_id: int, g: AssetGroupIn, user: dict = Depends(auth.require_admin)):
    name = g.name.strip()
    prefix = g.prefix.strip().upper()
    with database.db() as conn:
        row = conn.execute("SELECT * FROM asset_groups WHERE id=?", (group_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Group not found")
        clash = conn.execute("SELECT id FROM asset_groups WHERE prefix=? AND id!=?",
                             (prefix, group_id)).fetchone()
        if clash:
            raise HTTPException(409, f"Prefix {prefix} already exists")
        old_prefix = row["prefix"]
        conn.execute("UPDATE asset_groups SET name=?, prefix=? WHERE id=?",
                     (name, prefix, group_id))
        # Keep existing assets attached to the renamed prefix.
        if old_prefix != prefix:
            conn.execute("UPDATE assets SET prefix=? WHERE prefix=?", (prefix, old_prefix))
        out = conn.execute("SELECT * FROM asset_groups WHERE id=?", (group_id,)).fetchone()
    return dict(out)


@app.delete("/api/asset-groups/{group_id}")
def delete_group(group_id: int, user: dict = Depends(auth.require_admin)):
    with database.db() as conn:
        row = conn.execute("SELECT * FROM asset_groups WHERE id=?", (group_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Group not found")
        in_use = conn.execute("SELECT COUNT(*) c FROM assets WHERE prefix=?",
                              (row["prefix"],)).fetchone()["c"]
        if in_use:
            raise HTTPException(400, f"{in_use} asset(s) still use {row['prefix']} — move them first")
        conn.execute("DELETE FROM asset_groups WHERE id=?", (group_id,))
    return {"ok": True}


def _label(prefix, no):
    return f"{prefix or ''}{str(no).zfill(3)}" if no is not None else ""


@app.get("/api/assets")
def list_assets(q: str = "", user: dict = Depends(auth.current_user)):
    q = q.strip()
    with database.db() as conn:
        if q:
            like = f"%{q}%"
            # also match against the full label like "OF001"
            params = [like] * 10
            sql = ("SELECT * FROM assets WHERE name LIKE ? OR description LIKE ? "
                   "OR category LIKE ? OR location LIKE ? OR serial_number LIKE ? "
                   "OR assigned_to LIKE ? OR supplier LIKE ? OR CAST(asset_no AS TEXT) LIKE ? "
                   "OR (prefix || printf('%03d', asset_no)) LIKE ? "
                   "OR (prefix || CAST(asset_no AS TEXT)) LIKE ?")
            if q.isdigit():
                sql += " OR asset_no = ?"
                params.append(int(q))
            sql += " ORDER BY prefix, asset_no"
            rows = conn.execute(sql, params).fetchall()
        else:
            rows = conn.execute("SELECT * FROM assets ORDER BY prefix, asset_no").fetchall()
        with_photos = {r["asset_id"] for r in conn.execute(
            "SELECT asset_id FROM asset_photos").fetchall()}
    out = []
    for r in rows:
        d = dict(r)
        d["has_photo"] = d["id"] in with_photos
        d["label"] = _label(d.get("prefix"), d.get("asset_no"))
        out.append(d)
    return out


def _resolve_asset_no(conn, prefix, requested, exclude_id=None):
    """Validate a requested label number within a prefix, or assign next free."""
    if requested is None:
        return database.next_free_asset_no(prefix)
    if requested < 1:
        raise HTTPException(400, "Label number must be 1 or higher")
    clash = conn.execute(
        "SELECT id FROM assets WHERE prefix=? AND asset_no=? AND id IS NOT ?",
        (prefix, requested, exclude_id),
    ).fetchone()
    if clash:
        raise HTTPException(409, f"{_label(prefix, requested)} is already used")
    return requested


def _save_photo(conn, asset_id, photo):
    """photo: None = leave as-is; '' = remove; data URL = set."""
    if photo is None:
        return
    if photo == "":
        conn.execute("DELETE FROM asset_photos WHERE asset_id=?", (asset_id,))
    else:
        conn.execute(
            "INSERT INTO asset_photos (asset_id, data) VALUES (?,?) "
            "ON CONFLICT(asset_id) DO UPDATE SET data=excluded.data",
            (asset_id, photo),
        )


@app.post("/api/assets")
def create_asset(a: Asset, user: dict = Depends(auth.current_user)):
    prefix = (a.prefix or "OF").strip().upper()
    with database.db() as conn:
        asset_no = _resolve_asset_no(conn, prefix, a.asset_no)
        cur = conn.execute(
            "INSERT INTO assets (prefix, asset_no, name, description, category, location, "
            "serial_number, assigned_to, notes, purchase_date, cost, supplier, "
            "warranty_expiry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (prefix, asset_no, a.name, a.description, a.category, a.location,
             a.serial_number, a.assigned_to, a.notes, a.purchase_date, a.cost,
             a.supplier, a.warranty_expiry),
        )
        _save_photo(conn, cur.lastrowid, a.photo)
        row = conn.execute("SELECT * FROM assets WHERE id=?", (cur.lastrowid,)).fetchone()
    d = dict(row); d["label"] = _label(d["prefix"], d["asset_no"])
    return d


@app.put("/api/assets/{asset_id}")
def update_asset(asset_id: int, a: Asset, user: dict = Depends(auth.current_user)):
    prefix = (a.prefix or "OF").strip().upper()
    with database.db() as conn:
        exists = conn.execute("SELECT id FROM assets WHERE id=?", (asset_id,)).fetchone()
        if not exists:
            raise HTTPException(404, "Asset not found")
        asset_no = _resolve_asset_no(conn, prefix, a.asset_no, exclude_id=asset_id)
        conn.execute(
            "UPDATE assets SET prefix=?, asset_no=?, name=?, description=?, category=?, location=?, "
            "serial_number=?, assigned_to=?, notes=?, purchase_date=?, cost=?, "
            "supplier=?, warranty_expiry=? WHERE id=?",
            (prefix, asset_no, a.name, a.description, a.category, a.location,
             a.serial_number, a.assigned_to, a.notes, a.purchase_date, a.cost,
             a.supplier, a.warranty_expiry, asset_id),
        )
        _save_photo(conn, asset_id, a.photo)
        row = conn.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
    d = dict(row); d["label"] = _label(d["prefix"], d["asset_no"])
    return d


@app.delete("/api/assets/{asset_id}")
def delete_asset(asset_id: int, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        conn.execute("DELETE FROM asset_photos WHERE asset_id=?", (asset_id,))
        conn.execute("DELETE FROM assets WHERE id=?", (asset_id,))
    return {"ok": True}


@app.get("/api/assets/{asset_id}/photo")
def get_asset_photo(asset_id: int, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        row = conn.execute("SELECT data FROM asset_photos WHERE asset_id=?", (asset_id,)).fetchone()
    if not row or not row["data"]:
        raise HTTPException(404, "No photo")
    data = row["data"]
    if data.startswith("data:"):
        try:
            header, b64 = data.split(",", 1)
            media = header.split(";")[0].replace("data:", "") or "image/jpeg"
        except ValueError:
            raise HTTPException(500, "Corrupt photo")
        import base64
        return Response(content=base64.b64decode(b64), media_type=media,
                        headers={"Cache-Control": "no-cache"})
    raise HTTPException(500, "Unsupported photo format")


@app.get("/api/assets/{asset_id}/qr.svg")
def get_asset_qr(asset_id: int, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        row = conn.execute("SELECT prefix, asset_no, name FROM assets WHERE id=?", (asset_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Asset not found")
    import io
    import segno
    payload = f"ASSETIQ:{_label(row['prefix'], row['asset_no'])}"
    qr = segno.make(payload, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=1, border=2, dark="#111111", light=None)
    return Response(content=buf.getvalue(), media_type="image/svg+xml",
                    headers={"Cache-Control": "max-age=86400"})


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
            "issue_date, expiry_date, last_service_date, next_service_date, notes) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (c.name, c.category, c.reference, c.responsible_person, c.issue_date,
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
            "issue_date=?, expiry_date=?, last_service_date=?, next_service_date=?, notes=? WHERE id=?",
            (c.name, c.category, c.reference, c.responsible_person, c.issue_date,
             c.expiry_date, c.last_service_date, c.next_service_date, c.notes, item_id),
        )
        row = conn.execute("SELECT * FROM compliance WHERE id=?", (item_id,)).fetchone()
    return _decorate_compliance(row, _lead_days())


@app.delete("/api/compliance/{item_id}")
def delete_compliance(item_id: int, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        conn.execute("DELETE FROM compliance_history WHERE compliance_id=?", (item_id,))
        conn.execute("DELETE FROM compliance WHERE id=?", (item_id,))
    return {"ok": True}


@app.post("/api/compliance/{item_id}/renew")
def renew_compliance(item_id: int, r: RenewIn, user: dict = Depends(auth.current_user)):
    if not r.new_due.strip():
        raise HTTPException(400, "A new date is required to renew")
    with database.db() as conn:
        row = conn.execute("SELECT * FROM compliance WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Item not found")
        item = dict(row)
        is_machine = item["category"] == "machine"
        if is_machine:
            prev_due = item.get("next_service_date", "")
            prev_issue = item.get("last_service_date", "")
            new_issue = r.service_date or date.today().isoformat()
            conn.execute(
                "UPDATE compliance SET last_service_date=?, next_service_date=? WHERE id=?",
                (new_issue, r.new_due, item_id),
            )
        else:
            prev_due = item.get("expiry_date", "")
            prev_issue = item.get("issue_date", "")
            new_issue = r.issue_date or ""
            conn.execute(
                "UPDATE compliance SET expiry_date=?, issue_date=? WHERE id=?",
                (r.new_due, new_issue, item_id),
            )
        conn.execute(
            "INSERT INTO compliance_history (compliance_id, kind, prev_issue, prev_due, "
            "new_issue, new_due, renewed_by, note) VALUES (?,?,?,?,?,?,?,?)",
            (item_id, "service" if is_machine else "expiry", prev_issue, prev_due,
             new_issue, r.new_due, user.get("username", ""), r.note),
        )
        out = conn.execute("SELECT * FROM compliance WHERE id=?", (item_id,)).fetchone()
    return _decorate_compliance(out, _lead_days())


@app.get("/api/compliance/{item_id}/history")
def compliance_history(item_id: int, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        rows = conn.execute(
            "SELECT * FROM compliance_history WHERE compliance_id=? ORDER BY id DESC",
            (item_id,)).fetchall()
    return [dict(r) for r in rows]


# ------------------------------------------------------- notifications ------
@app.get("/api/notifications")
def notifications(user: dict = Depends(auth.current_user)):
    lead = _lead_days()
    alerts = []
    with database.db() as conn:
        for r in conn.execute("SELECT * FROM compliance").fetchall():
            d = _decorate_compliance(r, lead)
            if d["status"] in ("expiring", "expired"):
                alerts.append(d)
        # warranties from the asset register feed the same dashboard
        for r in conn.execute(
            "SELECT id, asset_no, name, warranty_expiry FROM assets "
            "WHERE warranty_expiry != ''").fetchall():
            days = _days_until(r["warranty_expiry"])
            status = _status(days, lead)
            if status in ("expiring", "expired"):
                alerts.append({
                    "id": f"asset-{r['id']}",
                    "name": f"Warranty · {r['name']}",
                    "category": "warranty",
                    "expiry_date": r["warranty_expiry"],
                    "days_remaining": days,
                    "days_until_expiry": days,
                    "status": status,
                    "reference": f"#{str(r['asset_no']).zfill(3)}",
                })
        # recent failed checklists (last 14 days) flag up red on the dashboard
        for r in conn.execute(
            "SELECT id, template_name, driver_name, fail_count, created_at "
            "FROM checklist_runs WHERE fail_count > 0 "
            "AND created_at >= datetime('now','-14 days') ORDER BY id DESC").fetchall():
            alerts.append({
                "id": f"check-{r['id']}",
                "run_id": r["id"],
                "name": f"{r['template_name'] or 'Checklist'} — {r['fail_count']} issue"
                        f"{'s' if r['fail_count'] != 1 else ''}",
                "category": "checklist",
                "status": "expired",     # red styling
                "days_remaining": None,
                "reference": f"{r['driver_name']} · {r['created_at'][:10]}",
            })
    alerts.sort(key=lambda i: i["days_remaining"] if i["days_remaining"] is not None else 0)
    return {
        "lead_days": lead,
        "count": len(alerts),
        "expired": sum(1 for a in alerts if a["status"] == "expired"),
        "expiring": sum(1 for a in alerts if a["status"] == "expiring"),
        "items": alerts,
    }


# --------------------------------------------------------------- export -----
def _csv_response(rows, fields, filename):
    import csv
    import io
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/export/assets.csv")
def export_assets(user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        rows = []
        for r in conn.execute("SELECT * FROM assets ORDER BY prefix, asset_no").fetchall():
            d = dict(r)
            d["label"] = _label(d.get("prefix"), d.get("asset_no"))
            rows.append(d)
    fields = ["label", "prefix", "asset_no", "name", "category", "location", "assigned_to",
              "serial_number", "supplier", "cost", "purchase_date",
              "warranty_expiry", "description", "notes", "date_added"]
    return _csv_response(rows, fields, "assetiq-assets.csv")


@app.get("/api/export/compliance.csv")
def export_compliance(user: dict = Depends(auth.current_user)):
    lead = _lead_days()
    with database.db() as conn:
        rows = [_decorate_compliance(r, lead)
                for r in conn.execute("SELECT * FROM compliance").fetchall()]
    fields = ["name", "category", "reference", "responsible_person",
              "expiry_date", "last_service_date", "next_service_date",
              "status", "days_remaining", "notes"]
    return _csv_response(rows, fields, "assetiq-compliance.csv")


# -------------------------------------------------------------- reports -----
@app.get("/api/reports/asset/{asset_id}")
def report_asset(asset_id: int, user: dict = Depends(auth.current_user)):
    return {"html": reports.asset_report(asset_id)}


@app.get("/api/reports/assets")
def report_assets(user: dict = Depends(auth.current_user)):
    return {"html": reports.assets_report()}


@app.get("/api/reports/compliance/{item_id}")
def report_compliance_item(item_id: int, user: dict = Depends(auth.current_user)):
    return {"html": reports.compliance_item_report(item_id)}


@app.get("/api/reports/compliance")
def report_compliance(user: dict = Depends(auth.current_user)):
    return {"html": reports.compliance_report()}


# ------------------------------------------------------------ checklists ----
def _template_out(row):
    d = dict(row)
    try:
        d["items"] = json.loads(d.get("items") or "[]")
    except json.JSONDecodeError:
        d["items"] = []
    d["ask_odometer"] = bool(d.get("ask_odometer"))
    d["active"] = bool(d.get("active"))
    return d


@app.get("/api/checklists/templates")
def list_templates(all: bool = False, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        if all and user["role"] == "admin":
            rows = conn.execute("SELECT * FROM checklist_templates ORDER BY name").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM checklist_templates WHERE active=1 ORDER BY name").fetchall()
    return [_template_out(r) for r in rows]


def _normalise_items(items):
    out = []
    for i, it in enumerate(items):
        if isinstance(it, str):
            label = it.strip()
            iid = f"i{i+1}"
        else:
            label = str(it.get("label", "")).strip()
            iid = str(it.get("id") or f"i{i+1}")
        if label:
            out.append({"id": iid, "label": label})
    return out


@app.post("/api/checklists/templates")
def create_template(t: ChecklistTemplateIn, user: dict = Depends(auth.require_admin)):
    items = _normalise_items(t.items)
    if not t.name.strip():
        raise HTTPException(400, "Template needs a name")
    with database.db() as conn:
        cur = conn.execute(
            "INSERT INTO checklist_templates (name, description, items, ask_odometer, active) "
            "VALUES (?,?,?,?,?)",
            (t.name.strip(), t.description, json.dumps(items),
             1 if t.ask_odometer else 0, 1 if t.active else 0),
        )
        row = conn.execute("SELECT * FROM checklist_templates WHERE id=?", (cur.lastrowid,)).fetchone()
    return _template_out(row)


@app.put("/api/checklists/templates/{tpl_id}")
def update_template(tpl_id: int, t: ChecklistTemplateIn, user: dict = Depends(auth.require_admin)):
    items = _normalise_items(t.items)
    with database.db() as conn:
        if not conn.execute("SELECT id FROM checklist_templates WHERE id=?", (tpl_id,)).fetchone():
            raise HTTPException(404, "Template not found")
        conn.execute(
            "UPDATE checklist_templates SET name=?, description=?, items=?, ask_odometer=?, active=? WHERE id=?",
            (t.name.strip(), t.description, json.dumps(items),
             1 if t.ask_odometer else 0, 1 if t.active else 0, tpl_id),
        )
        row = conn.execute("SELECT * FROM checklist_templates WHERE id=?", (tpl_id,)).fetchone()
    return _template_out(row)


@app.delete("/api/checklists/templates/{tpl_id}")
def delete_template(tpl_id: int, user: dict = Depends(auth.require_admin)):
    with database.db() as conn:
        conn.execute("DELETE FROM checklist_templates WHERE id=?", (tpl_id,))
    return {"ok": True}


def _run_out(row):
    d = dict(row)
    try:
        d["results"] = json.loads(d.get("results") or "{}")
    except json.JSONDecodeError:
        d["results"] = {}
    return d


@app.get("/api/checklists/runs")
def list_runs(template_id: int | None = None, limit: int = 50, user: dict = Depends(auth.current_user)):
    limit = max(1, min(200, limit))
    with database.db() as conn:
        if template_id:
            rows = conn.execute(
                "SELECT * FROM checklist_runs WHERE template_id=? ORDER BY id DESC LIMIT ?",
                (template_id, limit)).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM checklist_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_run_out(r) for r in rows]


@app.get("/api/checklists/runs/{run_id}")
def get_run(run_id: int, user: dict = Depends(auth.current_user)):
    with database.db() as conn:
        row = conn.execute("SELECT * FROM checklist_runs WHERE id=?", (run_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Run not found")
    return _run_out(row)


@app.post("/api/checklists/runs")
def submit_run(r: ChecklistRunIn, user: dict = Depends(auth.current_user)):
    if not r.driver_name.strip():
        raise HTTPException(400, "Driver name is required")
    tpl_name = ""
    if r.template_id:
        with database.db() as conn:
            t = conn.execute("SELECT name FROM checklist_templates WHERE id=?", (r.template_id,)).fetchone()
            tpl_name = t["name"] if t else ""
    fails = sum(1 for v in r.results.values()
                if isinstance(v, dict) and v.get("status") == "fail")
    with database.db() as conn:
        cur = conn.execute(
            "INSERT INTO checklist_runs (template_id, template_name, driver_name, odometer, results, notes, fail_count) "
            "VALUES (?,?,?,?,?,?,?)",
            (r.template_id, tpl_name, r.driver_name.strip(), r.odometer,
             json.dumps(r.results), r.notes, fails),
        )
        row = conn.execute("SELECT * FROM checklist_runs WHERE id=?", (cur.lastrowid,)).fetchone()
    return _run_out(row)


@app.delete("/api/checklists/runs/{run_id}")
def delete_run(run_id: int, user: dict = Depends(auth.require_admin)):
    with database.db() as conn:
        conn.execute("DELETE FROM checklist_runs WHERE id=?", (run_id,))
    return {"ok": True}


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
    with open(os.path.join(STATIC_DIR, "index.html")) as f:
        html = f.read().replace("__VERSION__", updater.local_version())
    # Never cache the shell, so a freshly versioned app.js/styles.css is fetched.
    return Response(
        content=html,
        media_type="text/html",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@app.get("/health")
def health():
    return JSONResponse({"ok": True})
