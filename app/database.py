"""SQLite layer for AssetIQ. No ORM — plain sqlite3, ISO date strings."""
import os
import sqlite3
from contextlib import contextmanager

DATA_DIR = os.environ.get("ASSETIQ_DATA", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data"))
DB_PATH = os.path.join(DATA_DIR, "assetiq.db")

DEFAULT_SETTINGS = {
    "business_name": "ARSmartHome",
    "notify_lead_days": "60",      # ~2 months
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
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_no ON assets(asset_no)"
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


def next_free_asset_no():
    """Smallest positive integer not currently used as a label number.

    Fills gaps, so a deleted 001 becomes the next suggestion again.
    """
    with db() as conn:
        used = {r["asset_no"] for r in conn.execute(
            "SELECT asset_no FROM assets WHERE asset_no IS NOT NULL").fetchall()}
    n = 1
    while n in used:
        n += 1
    return n


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
