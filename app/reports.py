"""Printable report bodies for AssetIQ.

Each function returns an HTML fragment (not a full document) that the frontend
drops into its report overlay and prints. Photos and QR codes are embedded
inline so a printed page is self-contained.
"""
import base64
import html
import io
from datetime import date, datetime

from . import database


def _e(v):
    return html.escape(str(v)) if v not in (None, "") else ""


def _biz():
    return database.get_settings().get("business_name", "AssetIQ") or "AssetIQ"


def _head(title, subtitle=""):
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    return (
        f'<div class="rpt-head"><div><div class="rpt-biz">{_e(_biz())}</div>'
        f'<div class="rpt-title">{_e(title)}</div>'
        f'{f"<div class=\'rpt-sub\'>{_e(subtitle)}</div>" if subtitle else ""}</div>'
        f'<div class="rpt-stamp">Generated<br>{stamp}</div></div>'
    )


def _label(prefix, no):
    return f"{prefix or ''}{str(no).zfill(3)}"


def _qr_svg(payload):
    try:
        import segno
        buf = io.BytesIO()
        segno.make(payload, error="m").save(buf, kind="svg", scale=3, border=1, dark="#000")
        return buf.getvalue().decode()
    except Exception:
        return ""


# ------------------------------------------------------------- assets -------
def asset_report(asset_id: int) -> str:
    with database.db() as conn:
        a = conn.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
        if not a:
            return "<p>Asset not found.</p>"
        a = dict(a)
        photo = conn.execute("SELECT data FROM asset_photos WHERE asset_id=?", (asset_id,)).fetchone()
        grp = conn.execute("SELECT name FROM asset_groups WHERE prefix=?", (a["prefix"],)).fetchone()
    label = _label(a["prefix"], a["asset_no"])
    group_name = grp["name"] if grp else a["prefix"]

    img = ""
    if photo and photo["data"] and photo["data"].startswith("data:"):
        img = f'<img class="rpt-photo" src="{photo["data"]}" alt="">'
    qr = _qr_svg(f"ASSETIQ:{label}")

    rows = [
        ("Group", group_name), ("Category", a.get("category")),
        ("Location", a.get("location")), ("Assigned to", a.get("assigned_to")),
        ("Serial number", a.get("serial_number")), ("Supplier", a.get("supplier")),
        ("Cost", a.get("cost")), ("Purchase date", a.get("purchase_date")),
        ("Warranty expiry", a.get("warranty_expiry")), ("Date added", a.get("date_added")),
    ]
    body = "".join(
        f'<tr><th>{_e(k)}</th><td>{_e(v)}</td></tr>' for k, v in rows if v)
    desc = f'<div class="rpt-block"><h3>Description</h3><p>{_e(a["description"])}</p></div>' if a.get("description") else ""
    notes = f'<div class="rpt-block"><h3>Notes</h3><p>{_e(a["notes"])}</p></div>' if a.get("notes") else ""

    return f"""
    {_head("Asset Report", f"{label} · {a['name']}")}
    <div class="rpt-asset">
      <div class="rpt-asset-main">
        <div class="rpt-bignum">{_e(label)}</div>
        <div class="rpt-name">{_e(a['name'])}</div>
        <table class="rpt-table">{body}</table>
        {desc}{notes}
      </div>
      <div class="rpt-side">
        {img}
        <div class="rpt-qr">{qr}</div>
        <div class="rpt-qrlabel">{_e(label)}</div>
      </div>
    </div>
    """


def assets_report() -> str:
    with database.db() as conn:
        groups = conn.execute("SELECT * FROM asset_groups ORDER BY sort, name").fetchall()
        assets = conn.execute("SELECT * FROM assets ORDER BY prefix, asset_no").fetchall()
    by_prefix = {}
    for a in assets:
        by_prefix.setdefault(a["prefix"], []).append(dict(a))
    order = [g["prefix"] for g in groups]
    name_for = {g["prefix"]: g["name"] for g in groups}
    prefixes = [p for p in order if p in by_prefix] + [p for p in by_prefix if p not in order]

    sections = []
    for p in prefixes:
        items = by_prefix[p]
        rows = "".join(
            f'<tr><td class="mono">{_e(_label(a["prefix"], a["asset_no"]))}</td>'
            f'<td>{_e(a["name"])}</td><td>{_e(a.get("category"))}</td>'
            f'<td>{_e(a.get("location"))}</td><td>{_e(a.get("assigned_to"))}</td>'
            f'<td>{_e(a.get("serial_number"))}</td></tr>'
            for a in items)
        sections.append(
            f'<h3 class="rpt-group">{_e(name_for.get(p, p))} ({_e(p)}) · {len(items)}</h3>'
            f'<table class="rpt-list"><thead><tr><th>Label</th><th>Name</th>'
            f'<th>Category</th><th>Location</th><th>Assigned</th><th>Serial</th>'
            f'</tr></thead><tbody>{rows}</tbody></table>')
    return _head("Asset Register", f"{len(assets)} assets") + "".join(sections)


# ---------------------------------------------------------- compliance ------
def _status(expiry, lead):
    if not expiry:
        return "—", ""
    try:
        d = (datetime.strptime(expiry, "%Y-%m-%d").date() - date.today()).days
    except ValueError:
        return "—", ""
    if d < 0:
        return f"Expired {abs(d)}d ago", "bad"
    if d <= lead:
        return f"{d}d left", "warn"
    return f"{d}d left", "ok"


def compliance_item_report(item_id: int) -> str:
    lead = int(database.get_settings().get("notify_lead_days", 60) or 60)
    with database.db() as conn:
        c = conn.execute("SELECT * FROM compliance WHERE id=?", (item_id,)).fetchone()
        if not c:
            return "<p>Item not found.</p>"
        c = dict(c)
        hist = conn.execute(
            "SELECT * FROM compliance_history WHERE compliance_id=? ORDER BY id DESC",
            (item_id,)).fetchall()
    is_machine = c["category"] == "machine"
    due = c.get("next_service_date") if is_machine else c.get("expiry_date")
    stxt, scls = _status(due, lead)

    rows = [
        ("Category", c.get("category")), ("Responsible", c.get("responsible_person")),
        ("Reference", c.get("reference")), ("Date issued", c.get("issue_date")),
    ]
    if is_machine:
        rows += [("Last service", c.get("last_service_date")), ("Next service", c.get("next_service_date"))]
    else:
        rows += [("Expiry date", c.get("expiry_date"))]
    body = "".join(f'<tr><th>{_e(k)}</th><td>{_e(v)}</td></tr>' for k, v in rows if v)
    notes = f'<div class="rpt-block"><h3>Notes</h3><p>{_e(c["notes"])}</p></div>' if c.get("notes") else ""

    hrows = "".join(
        f'<tr><td>{_e(h["prev_due"])}</td><td>{_e(h["new_due"])}</td>'
        f'<td>{_e((h["renewed_at"] or "")[:16])}</td><td>{_e(h["renewed_by"])}</td>'
        f'<td>{_e(h["note"])}</td></tr>' for h in hist)
    history = (
        f'<div class="rpt-block"><h3>Renewal history</h3><table class="rpt-list">'
        f'<thead><tr><th>Previous</th><th>New</th><th>When</th><th>By</th><th>Note</th></tr></thead>'
        f'<tbody>{hrows}</tbody></table></div>') if hist else ""

    return f"""
    {_head("Compliance Report", _e(c['name']))}
    <div class="rpt-statusline"><span class="rpt-badge {scls}">{_e(stxt)}</span></div>
    <table class="rpt-table">{body}</table>
    {notes}{history}
    """


def compliance_report() -> str:
    lead = int(database.get_settings().get("notify_lead_days", 60) or 60)
    with database.db() as conn:
        items = [dict(r) for r in conn.execute("SELECT * FROM compliance").fetchall()]
    by_cat = {}
    for c in items:
        by_cat.setdefault(c["category"] or "other", []).append(c)
    sections = []
    counts = {"ok": 0, "warn": 0, "bad": 0}
    for cat in sorted(by_cat):
        rows = ""
        for c in by_cat[cat]:
            is_machine = c["category"] == "machine"
            due = c.get("next_service_date") if is_machine else c.get("expiry_date")
            stxt, scls = _status(due, lead)
            if scls in counts:
                counts[scls] += 1
            rows += (
                f'<tr><td>{_e(c["name"])}</td><td>{_e(c.get("responsible_person"))}</td>'
                f'<td>{_e(c.get("reference"))}</td><td>{_e(due)}</td>'
                f'<td><span class="rpt-badge {scls}">{_e(stxt)}</span></td></tr>')
        sections.append(
            f'<h3 class="rpt-group">{_e(cat.replace("_", " ").title())} · {len(by_cat[cat])}</h3>'
            f'<table class="rpt-list"><thead><tr><th>Name</th><th>Responsible</th>'
            f'<th>Reference</th><th>Due</th><th>Status</th></tr></thead><tbody>{rows}</tbody></table>')
    summary = (f'{len(items)} items · {counts["bad"]} expired · '
               f'{counts["warn"]} due soon · {counts["ok"]} valid')
    return _head("Compliance Report", summary) + "".join(sections)
