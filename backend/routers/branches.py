"""Cabang (branches). Read for any logged-in user (needed for pickers), write admin-only."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import get_current_user, now_utc, require_admin
from lib.db import clean_doc, db

router = APIRouter()


class BranchOut(BaseModel):
    id: str
    code: str
    name: str
    address: str = ""
    phone: str = ""  # nomor WA toko cabang (format 62…)
    created_at: datetime


class BranchIn(BaseModel):
    code: str = Field(min_length=2, max_length=8)
    name: str = Field(min_length=2, max_length=60)
    address: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=20)


class BranchPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=60)
    address: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=20)


@router.get("/branches", response_model=list[BranchOut])
async def list_branches(user: dict = Depends(get_current_user)):
    docs = await db.branches.find().sort("name", 1).to_list(100)
    return [BranchOut(**clean_doc(d)) for d in docs]


@router.post("/branches", response_model=BranchOut, status_code=201)
async def create_branch(input: BranchIn, user: dict = Depends(require_admin)):
    code = input.code.strip().upper()
    if await db.branches.find_one({"code": code}):
        raise HTTPException(status_code=409, detail="Kode cabang sudah dipakai")
    doc = {
        "id": str(uuid.uuid4()),
        "code": code,
        "name": input.name.strip(),
        "address": input.address.strip(),
        "phone": input.phone.strip(),
        "created_at": now_utc(),
    }
    await db.branches.insert_one(dict(doc))
    return BranchOut(**clean_doc(doc))


@router.patch("/branches/{branch_id}", response_model=BranchOut)
async def patch_branch(branch_id: str, input: BranchPatch, user: dict = Depends(require_admin)):
    doc = await db.branches.find_one({"id": branch_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Cabang tidak ditemukan")
    update = {k: v.strip() for k, v in input.model_dump(exclude_none=True).items()}
    if update:
        await db.branches.update_one({"id": branch_id}, {"$set": update})
    fresh = await db.branches.find_one({"id": branch_id})
    return BranchOut(**clean_doc(fresh))
