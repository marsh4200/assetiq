"""SQLite layer for AssetIQ. No ORM — plain sqlite3, ISO date strings."""
import os
import sqlite3
from contextlib import contextmanager

DATA_DIR = os.environ.get("ASSETIQ_DATA", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data"))
DB_PATH = os.path.join(DATA_DIR, "assetiq.db")

DEFAULT_SETTINGS = {
    "business_name": "ARSmartHome",
    "notify_lead_days": "60",      # ~2 months
    "machine_notify_days": "30",   # remind 1 month before a machine service
    "theme": "dark",
    # --- backup / samba ---
    "smb_host": "",
    "smb_share": "",
    "smb_path": "",
    "smb_user": "",
    "smb_password": "",
    "backup_keep": "2",
    "backup_daily": "0",
    "last_backup_at": "",
    "last_backup_status": "",
    "last_backup_date": "",
}


def _connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS assets (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT NOT NULL,
                description   TEXT DEFAULT '',
                category      TEXT DEFAULT '',
                location      TEXT DEFAULT '',
                serial_number TEXT DEFAULT '',
                assigned_to   TEXT DEFAULT '',
                notes         TEXT DEFAULT '',
                date_added    TEXT DEFAULT (date('now'))
            );

            CREATE TABLE IF NOT EXISTS compliance (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                name               TEXT NOT NULL,
                category           TEXT DEFAULT 'other',
                reference          TEXT DEFAULT '',
                responsible_person TEXT DEFAULT '',
                expiry_date        TEXT DEFAULT '',
                last_service_date  TEXT DEFAULT '',
                next_service_date  TEXT DEFAULT '',
                notes              TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS users (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                username             TEXT UNIQUE NOT NULL,
                password_hash        TEXT NOT NULL,
                role                 TEXT DEFAULT 'user',
                must_change_password INTEGER DEFAULT 0,
                created_at           TEXT DEFAULT (datetime('now')),
                last_login           TEXT
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_compliance_expiry  ON compliance(expiry_date);
            CREATE INDEX IF NOT EXISTS idx_compliance_service ON compliance(next_service_date);
            """
        )
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v)
            )

        # --- migration: editable / reusable asset label number --------------
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(assets)").fetchall()}
        if "asset_no" not in cols:
            conn.execute("ALTER TABLE assets ADD COLUMN asset_no INTEGER")
            # Backfill existing rows with their id so nothing renumbers.
            conn.execute("UPDATE assets SET asset_no = id WHERE asset_no IS NULL")

        # --- migration: asset groups / prefixes (OF001, WS001, …) -----------
        if "prefix" not in cols:
            conn.execute("ALTER TABLE assets ADD COLUMN prefix TEXT DEFAULT 'OF'")
            conn.execute("UPDATE assets SET prefix = 'OF' WHERE prefix IS NULL OR prefix = ''")
        # Old single-column index becomes wrong once prefixes repeat numbers.
        conn.execute("DROP INDEX IF EXISTS idx_assets_no")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_prefix_no ON assets(prefix, asset_no)"
        )

        conn.execute(
            """CREATE TABLE IF NOT EXISTS asset_groups (
                   id     INTEGER PRIMARY KEY AUTOINCREMENT,
                   name   TEXT NOT NULL,
                   prefix TEXT NOT NULL UNIQUE,
                   sort   INTEGER DEFAULT 0
               )"""
        )

        # --- migration: purchase / warranty tracking ------------------------
        for col, decl in (
            ("purchase_date", "TEXT DEFAULT ''"),
            ("cost", "TEXT DEFAULT ''"),
            ("supplier", "TEXT DEFAULT ''"),
            ("warranty_expiry", "TEXT DEFAULT ''"),
        ):
            if col not in cols:
                conn.execute(f"ALTER TABLE assets ADD COLUMN {col} {decl}")

        # --- photos in their own table so the asset list stays light --------
        conn.execute(
            """CREATE TABLE IF NOT EXISTS asset_photos (
                   asset_id INTEGER PRIMARY KEY,
                   data     TEXT,
                   FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
               )"""
        )

        # --- compliance: issued date + renewal history ----------------------
        comp_cols = [r["name"] for r in conn.execute("PRAGMA table_info(compliance)").fetchall()]
        if "issue_date" not in comp_cols:
            conn.execute("ALTER TABLE compliance ADD COLUMN issue_date TEXT DEFAULT ''")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS compliance_history (
                   id            INTEGER PRIMARY KEY AUTOINCREMENT,
                   compliance_id INTEGER,
                   kind          TEXT DEFAULT 'expiry',
                   prev_issue    TEXT DEFAULT '',
                   prev_due      TEXT DEFAULT '',
                   new_issue     TEXT DEFAULT '',
                   new_due       TEXT DEFAULT '',
                   renewed_by    TEXT DEFAULT '',
                   renewed_at    TEXT DEFAULT (datetime('now')),
                   note          TEXT DEFAULT '',
                   FOREIGN KEY(compliance_id) REFERENCES compliance(id) ON DELETE CASCADE
               )"""
        )

        # --- checklists -----------------------------------------------------
        conn.execute(
            """CREATE TABLE IF NOT EXISTS checklist_templates (
                   id          INTEGER PRIMARY KEY AUTOINCREMENT,
                   name        TEXT NOT NULL,
                   description TEXT DEFAULT '',
                   items       TEXT NOT NULL DEFAULT '[]',
                   ask_odometer INTEGER DEFAULT 0,
                   active      INTEGER DEFAULT 1,
                   created_at  TEXT DEFAULT (datetime('now'))
               )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS checklist_runs (
                   id            INTEGER PRIMARY KEY AUTOINCREMENT,
                   template_id   INTEGER,
                   template_name TEXT,
                   driver_name   TEXT,
                   odometer      TEXT DEFAULT '',
                   results       TEXT NOT NULL DEFAULT '{}',
                   notes         TEXT DEFAULT '',
                   fail_count    INTEGER DEFAULT 0,
                   created_at    TEXT DEFAULT (datetime('now'))
               )"""
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_runs_created ON checklist_runs(created_at)"
        )

        # --- machine services (trucks, compressors, PCs, …) -----------------
        conn.execute(
            """CREATE TABLE IF NOT EXISTS machines (
                   id                INTEGER PRIMARY KEY AUTOINCREMENT,
                   name              TEXT NOT NULL,
                   kind              TEXT DEFAULT 'machine',
                   location          TEXT DEFAULT '',
                   serial_number     TEXT DEFAULT '',
                   interval_months   INTEGER DEFAULT 6,
                   last_service_date TEXT DEFAULT '',
                   next_service_date TEXT DEFAULT '',
                   notes             TEXT DEFAULT '',
                   created_at        TEXT DEFAULT (date('now'))
               )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS machine_services (
                   id           INTEGER PRIMARY KEY AUTOINCREMENT,
                   machine_id   INTEGER,
                   service_date TEXT DEFAULT '',
                   next_due     TEXT DEFAULT '',
                   service_type TEXT DEFAULT 'Basic service',
                   performed_by TEXT DEFAULT '',
                   cost         TEXT DEFAULT '',
                   notes        TEXT DEFAULT '',
                   logged_by    TEXT DEFAULT '',
                   logged_at    TEXT DEFAULT (datetime('now')),
                   FOREIGN KEY(machine_id) REFERENCES machines(id) ON DELETE CASCADE
               )"""
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_mservices_machine ON machine_services(machine_id)"
        )

        # --- machines: usage-based tracking (km / hours) + asset link --------
        mcols = {r["name"] for r in conn.execute("PRAGMA table_info(machines)").fetchall()}
        for col, decl in (
            ("asset_id",             "INTEGER"),
            ("track_by",             "TEXT DEFAULT 'months'"),   # months | km | hours
            ("interval_km",          "INTEGER DEFAULT 0"),
            ("interval_hours",       "INTEGER DEFAULT 0"),
            ("last_service_reading", "INTEGER DEFAULT 0"),
            ("next_service_reading", "INTEGER DEFAULT 0"),
            ("current_reading",      "INTEGER DEFAULT 0"),
        ):
            if col not in mcols:
                conn.execute(f"ALTER TABLE machines ADD COLUMN {col} {decl}")
        scols = {r["name"] for r in conn.execute("PRAGMA table_info(machine_services)").fetchall()}
        if "reading" not in scols:
            conn.execute("ALTER TABLE machine_services ADD COLUMN reading INTEGER DEFAULT 0")
        if "reading_unit" not in scols:
            conn.execute("ALTER TABLE machine_services ADD COLUMN reading_unit TEXT DEFAULT ''")


import json as _json

DEFAULT_VEHICLE_ITEMS = [
    "Tyres & wheel nuts — condition and pressure",
    "Lights, indicators & hazards — all working",
    "Brakes — foot & hand brake",
    "Mirrors — clean & adjusted",
    "Windscreen & wipers — clean, no cracks",
    "Engine oil level",
    "Coolant / water level",
    "Fuel level",
    "Hooter / horn",
    "Seatbelts — working",
    "Licence disc — valid & displayed",
    "Number plates — clean & visible",
    "Fire extinguisher — present & charged",
    "First aid kit — present",
    "Warning triangle — present",
    "Fluid leaks — none under vehicle",
    "Body damage — note any new damage",
    "Load secured & within limit",
]


def ensure_default_checklist():
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) c FROM checklist_templates").fetchone()["c"]
        if n == 0:
            items = [{"id": f"i{i+1}", "label": lbl} for i, lbl in enumerate(DEFAULT_VEHICLE_ITEMS)]
            conn.execute(
                "INSERT INTO checklist_templates (name, description, items, ask_odometer) "
                "VALUES (?,?,?,1)",
                ("Truck — Daily Vehicle Check",
                 "Basic pre-trip inspection to be done each morning before driving.",
                 _json.dumps(items)),
            )


def next_free_asset_no(prefix="OF"):
    """Smallest positive integer not used within this prefix.

    Fills gaps, so a deleted OF001 becomes the next suggestion again. Each
    prefix (OF, WS, …) has its own independent sequence.
    """
    with db() as conn:
        used = {r["asset_no"] for r in conn.execute(
            "SELECT asset_no FROM assets WHERE prefix=? AND asset_no IS NOT NULL",
            (prefix,)).fetchall()}
    n = 1
    while n in used:
        n += 1
    return n


def ensure_default_groups():
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) c FROM asset_groups").fetchone()["c"]
        if n == 0:
            conn.executemany(
                "INSERT OR IGNORE INTO asset_groups (name, prefix, sort) VALUES (?,?,?)",
                [("Office / Admin", "OF", 0), ("Workshop", "WS", 1), ("Workshop Machines", "WM", 2)],
            )


from datetime import date as _date


def add_months(iso_str, months):
    """Add (or subtract) whole months to an ISO yyyy-mm-dd string, clamping the
    day to the last valid day of the target month. Returns an ISO string."""
    try:
        d = _date.fromisoformat(iso_str)
    except (TypeError, ValueError):
        return ""
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    # Clamp the day (e.g. 31 Jan + 1 month -> 28/29 Feb).
    import calendar
    last = calendar.monthrange(y, m)[1]
    return _date(y, m, min(d.day, last)).isoformat()


# Asset-register groups whose machines feed the service tracker. Matched by a
# group name containing "machine", plus the default Workshop-Machines prefix.
MACHINE_GROUP_PREFIXES = ("WM",)


def machine_group_prefixes(conn):
    """Prefixes of asset groups that represent machines (name ~ 'machine', or WM)."""
    prefixes = set(MACHINE_GROUP_PREFIXES)
    try:
        for r in conn.execute(
            "SELECT prefix FROM asset_groups WHERE LOWER(name) LIKE '%machine%'"
        ).fetchall():
            if r["prefix"]:
                prefixes.add(r["prefix"])
    except Exception:
        pass
    return prefixes


def _machine_asset_label(prefix, no):
    return f"{prefix or ''}{str(no).zfill(3)}" if no is not None else ""


def list_machine_assets(conn):
    """Assets that live in a machine group, with their label."""
    prefixes = machine_group_prefixes(conn)
    if not prefixes:
        return []
    qmarks = ",".join("?" for _ in prefixes)
    rows = conn.execute(
        f"SELECT id, prefix, asset_no, name, serial_number, location "
        f"FROM assets WHERE prefix IN ({qmarks}) ORDER BY prefix, asset_no",
        tuple(prefixes),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["label"] = _machine_asset_label(d["prefix"], d["asset_no"])
        out.append(d)
    return out


def purge_demo_machines():
    """One-time cleanup of the old fake Truck/Compressor/PC demo rows.

    Only removes them if they are clearly untouched: not linked to an asset and
    carrying nothing but the system-logged demo services. Anything the user has
    edited or logged a real service against is left alone.
    """
    with db() as conn:
        rows = conn.execute(
            "SELECT id FROM machines WHERE name IN ('Truck','Compressor','PC') "
            "AND (asset_id IS NULL OR asset_id = 0)"
        ).fetchall()
        for r in rows:
            mid = r["id"]
            real = conn.execute(
                "SELECT COUNT(*) c FROM machine_services "
                "WHERE machine_id=? AND IFNULL(logged_by,'') <> 'system'",
                (mid,),
            ).fetchone()["c"]
            if real == 0:
                conn.execute("DELETE FROM machine_services WHERE machine_id=?", (mid,))
                conn.execute("DELETE FROM machines WHERE id=?", (mid,))


def import_machines_from_assets(asset_ids=None, exclude_trucks=False):
    """Create machine-service entries linked to machine-group assets.

    Skips assets that are already linked. When ``asset_ids`` is None, imports the
    whole machine group (used for a first-run auto-populate). New machines start
    on the default 6-month schedule with no dates — the user logs real services
    or switches a machine to km/hours tracking afterwards. Returns how many were
    added.
    """
    added = 0
    with db() as conn:
        linked = {r["asset_id"] for r in conn.execute(
            "SELECT asset_id FROM machines WHERE asset_id IS NOT NULL").fetchall()}
        for a in list_machine_assets(conn):
            if asset_ids is not None and a["id"] not in asset_ids:
                continue
            if a["id"] in linked:
                continue
            if exclude_trucks and "truck" in (a["name"] or "").lower():
                continue
            conn.execute(
                "INSERT INTO machines (name, kind, location, serial_number, asset_id, "
                "track_by, interval_months) VALUES (?,?,?,?,?,?,?)",
                (a["name"], "machine", a["location"] or "", a["serial_number"] or "",
                 a["id"], "months", 6),
            )
            added += 1
    return added


def ensure_machines_from_assets():
    """First-run populate: if no machines exist yet, pull them from the machine
    group of the asset register (leaving any truck to be added by hand)."""
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) c FROM machines").fetchone()["c"]
    if n:
        return
    import_machines_from_assets(asset_ids=None, exclude_trucks=True)


def get_settings():
    with db() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    out = dict(DEFAULT_SETTINGS)
    out.update({r["key"]: r["value"] for r in rows})
    return out


def update_settings(values: dict):
    with db() as conn:
        for k, v in values.items():
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (k, str(v)),
            )
    return get_settings()
