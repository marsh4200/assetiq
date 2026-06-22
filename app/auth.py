"""Authentication for AssetIQ.

- Passwords hashed with stdlib pbkdf2_hmac (no external crypto dep).
- Sessions are random tokens stored in the DB; client sends them as a
  Bearer token. Roles: 'admin' and 'user'.
- A default admin/admin account is seeded on first boot and forced to change
  its password at first login.
"""
import hashlib
import hmac
import secrets

from fastapi import Header, HTTPException

from .database import db

ITERATIONS = 200_000


# ----------------------------------------------------------- passwords ------
def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _algo, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# --------------------------------------------------------------- seed -------
def ensure_default_admin():
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
        if n == 0:
            conn.execute(
                "INSERT INTO users (username, password_hash, role, must_change_password) "
                "VALUES (?,?,?,1)",
                ("admin", hash_password("admin"), "admin"),
            )


# ------------------------------------------------------------ sessions ------
def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute("INSERT INTO sessions (token, user_id) VALUES (?,?)", (token, user_id))
    return token


def delete_session(token: str):
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))


def _public(row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "must_change_password": bool(row["must_change_password"]),
        "last_login": row["last_login"],
        "created_at": row["created_at"],
    }


def user_from_token(token: str):
    with db() as conn:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token=?",
            (token,),
        ).fetchone()
    return _public(row) if row else None


# --------------------------------------------------------- dependencies -----
def current_user(authorization: str = Header(default="")):
    token = ""
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    user = user_from_token(token) if token else None
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


def require_admin(authorization: str = Header(default="")):
    user = current_user(authorization)
    if user["role"] != "admin":
        raise HTTPException(403, "Admin access required")
    return user


# ----------------------------------------------------------- user CRUD ------
def authenticate(username: str, password: str):
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        return None
    with db() as conn:
        conn.execute("UPDATE users SET last_login=datetime('now') WHERE id=?", (row["id"],))
    return _public(row)


def change_password(user_id: int, new_password: str):
    with db() as conn:
        conn.execute(
            "UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?",
            (hash_password(new_password), user_id),
        )


def list_users():
    with db() as conn:
        rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
    return [_public(r) for r in rows]


def create_user(username: str, password: str, role: str):
    if role not in ("admin", "user"):
        role = "user"
    with db() as conn:
        exists = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if exists:
            raise HTTPException(409, "Username already exists")
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, role, must_change_password) "
            "VALUES (?,?,?,1)",
            (username, hash_password(password), role),
        )
        row = conn.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
    return _public(row)


def update_user(user_id: int, role: str | None, new_password: str | None):
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        if role in ("admin", "user") and role != row["role"]:
            # Don't allow removing the last admin.
            if row["role"] == "admin" and role == "user":
                admins = conn.execute("SELECT COUNT(*) c FROM users WHERE role='admin'").fetchone()["c"]
                if admins <= 1:
                    raise HTTPException(400, "Cannot demote the last admin")
            conn.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
        if new_password:
            conn.execute(
                "UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?",
                (hash_password(new_password), user_id),
            )
        out = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return _public(out)


def delete_user(user_id: int, acting_user_id: int):
    if user_id == acting_user_id:
        raise HTTPException(400, "You can't delete your own account")
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        if row["role"] == "admin":
            admins = conn.execute("SELECT COUNT(*) c FROM users WHERE role='admin'").fetchone()["c"]
            if admins <= 1:
                raise HTTPException(400, "Cannot delete the last admin")
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    return {"ok": True}
