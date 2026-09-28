"""User management — admin only. PIN hashes never leave the database."""

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import hash_pin, require_admin, user_public
from lib.db import db

router = APIRouter()

USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,24}$")
PIN_RE = re.compile(r"^\d{4,6}$")


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    name: str = Field(min_length=2, max_length=60)
    role: str = Field(pattern="^(admin|kasir)$")
    pin: str = Field(min_length=4, max_length=6)
    branch_id: str = ""


class PinIn(BaseModel):
    pin: str = Field(min_length=4, max_length=6)


def _validate_pin(pin: str) -> None:
    if not PIN_RE.fullmatch(pin):
        raise HTTPException(status_code=422, detail="PIN harus 4-6 digit angka")


@router.get("/users")
async def list_users(user: dict = Depends(require_admin)):
    docs = await db.users.find().sort("username", 1).to_list(200)
    return [await user_public(d) for d in docs]


@router.post("/users", status_code=201)
async def create_user(input: UserIn, user: dict = Depends(require_admin)):
    username = input.username.strip().lower()
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=422, detail="Username 3-24 huruf kecil/angka/titik")
    _validate_pin(input.pin)
    if await db.users.find_one({"username": username}):
        raise HTTPException(status_code=409, detail="Username sudah dipakai")
    branch_id = None
    if input.role == "kasir":
        branch_id = (input.branch_id or "").strip()
        if not branch_id:
            raise HTTPException(status_code=422, detail="Kasir wajib punya cabang")
        if not await db.branches.find_one({"id": branch_id}):
            raise HTTPException(status_code=404, detail="Cabang tidak ditemukan")
    doc = {
        "id": str(uuid.uuid4()),
        "username": username,
        "name": input.name.strip(),
        "role": input.role,
        "branch_id": branch_id,
        "pin_hash": hash_pin(input.pin),
    }
    await db.users.insert_one(dict(doc))
    return await user_public(doc)


@router.patch("/users/{user_id}/pin")
async def reset_pin(user_id: str, input: PinIn, user: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    _validate_pin(input.pin)
    await db.users.update_one({"id": user_id}, {"$set": {"pin_hash": hash_pin(input.pin)}})
    # Revoke all sessions of that user — an old cookie must not outlive a PIN reset.
    await db.sessions.delete_many({"user_id": user_id})
    return {"ok": True}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_admin)):
    if user_id == user["id"]:
        raise HTTPException(status_code=409, detail="Tidak bisa menghapus akun sendiri")
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    if target.get("role") == "admin":
        admins = await db.users.count_documents({"role": "admin"})
        if admins <= 1:
            raise HTTPException(status_code=409, detail="Minimal satu admin harus tersisa")
    await db.users.delete_one({"id": user_id})
    await db.sessions.delete_many({"user_id": user_id})
    return {"ok": True}
