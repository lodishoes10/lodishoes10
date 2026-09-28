"""Auth core: scrypt PIN hashing, httpOnly cookie sessions, role/branch scoping.

Security rules implemented here:
- PINs are never stored in plaintext (scrypt with random salt, constant-time compare).
- Sessions are opaque tokens in an httpOnly cookie — no tokens in JSON bodies.
- `get_current_user` guards every endpoint; `require_admin` gates admin-only data.
- Kasir accounts are hard-locked to their own branch at query level.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, Request
from fastapi.params import Depends

from lib.db import db

SESSION_COOKIE = "pos_session"
SESSION_TTL_DAYS = 7
_SCRYPT = {"n": 16384, "r": 8, "p": 1, "dklen": 32}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def naive_to_aware(dt: datetime) -> datetime:
    """Motor returns naive datetimes for BSON dates — normalise to aware UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def hash_pin(pin: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt), **_SCRYPT)
    return f"scrypt${salt}${dk.hex()}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    dk = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt), **_SCRYPT)
    return hmac.compare_digest(dk.hex(), digest)


async def create_session(user_id: str) -> tuple[str, datetime]:
    token = secrets.token_hex(32)
    expires = now_utc() + timedelta(days=SESSION_TTL_DAYS)
    await db.sessions.insert_one({"token": token, "user_id": user_id, "created_at": now_utc(), "expires_at": expires})
    return token, expires


async def destroy_session(token: str) -> None:
    await db.sessions.delete_one({"token": token})


async def get_current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Belum login")
    session = await db.sessions.find_one({"token": token})
    if not session:
        raise HTTPException(status_code=401, detail="Sesi berakhir, silakan login lagi")
    if naive_to_aware(session["expires_at"]) < now_utc():
        await db.sessions.delete_one({"_id": session["_id"]})
        raise HTTPException(status_code=401, detail="Sesi berakhir, silakan login lagi")
    user = await db.users.find_one({"id": session["user_id"]})
    if not user:
        raise HTTPException(status_code=401, detail="Akun tidak ditemukan")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Khusus admin")
    return user


async def user_public(user: dict) -> dict:
    branch_name = None
    if user.get("branch_id"):
        b = await db.branches.find_one({"id": user["branch_id"]})
        branch_name = b["name"] if b else None
    return {
        "id": user["id"],
        "username": user["username"],
        "name": user["name"],
        "role": user["role"],
        "branch_id": user.get("branch_id"),
        "branch_name": branch_name,
    }


def require_branch(user: dict, branch_id: str) -> str:
    """Branch for a WRITE (mutating) endpoint — a branch is mandatory. Kasir is pinned to their own."""
    requested = (branch_id or "").strip()
    if user.get("role") == "admin":
        if not requested:
            raise HTTPException(status_code=400, detail="Pilih cabang terlebih dahulu")
        return requested
    own = (user.get("branch_id") or "").strip()
    if not own:
        raise HTTPException(status_code=403, detail="Akun belum terhubung ke cabang")
    if requested and requested != own:
        raise HTTPException(status_code=403, detail="Anda hanya dapat mengakses cabang Anda sendiri")
    return own


def read_branch(user: dict, branch_id: str) -> str | None:
    """Branch filter for LIST endpoints. Kasir pinned (403 on other branch); admin None = all branches."""
    requested = (branch_id or "").strip()
    if user.get("role") == "admin":
        return requested or None
    own = (user.get("branch_id") or "").strip()
    if not own:
        raise HTTPException(status_code=403, detail="Akun belum terhubung ke cabang")
    if requested and requested != own:
        raise HTTPException(status_code=403, detail="Anda hanya dapat mengakses cabang Anda sendiri")
    return own
