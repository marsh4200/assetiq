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
