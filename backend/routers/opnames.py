"""Stock opname — audit fisik vs sistem; selisih diterapkan ke stok & tercatat."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from lib.auth import get_current_user, now_utc, read_branch, require_branch
from lib.db import clean_doc, db

router = APIRouter()


class OpnameItemIn(BaseModel):
    stock_id: str
    counted_qty: int = Field(ge=0, le=99999)


class OpnameIn(BaseModel):
    branch_id: str = ""
    items: list[OpnameItemIn] = Field(min_length=1)
    note: str = Field(default="", max_length=200)


class OpnameItemOut(BaseModel):
    article_id: str
    article_code: str
    article_name: str
    size: str
    system_qty: int
    counted_qty: int
    diff: int


class OpnameOut(BaseModel):
    id: str
    branch_id: str
    branch_name: str
    items: list[OpnameItemOut]
    note: str = ""
    created_by_name: str
    created_at: datetime


@router.get("/opnames", response_model=list[OpnameOut])
async def list_opnames(branch_id: str = "", limit: int = Query(20, le=100), user: dict = Depends(get_current_user)):
    match: dict = {}
    b = read_branch(user, branch_id)
    if b:
        match["branch_id"] = b
    docs = await db.opnames.find(match).sort("created_at", -1).limit(limit).to_list(limit)
    return [OpnameOut(**clean_doc(d)) for d in docs]


@router.post("/opnames", response_model=OpnameOut, status_code=201)
async def create_opname(input: OpnameIn, user: dict = Depends(get_current_user)):
    b = require_branch(user, input.branch_id)
    branch = await db.branches.find_one({"id": b})
    if not branch:
        raise HTTPException(status_code=404, detail="Cabang tidak ditemukan")

    items_out: list[dict] = []
    seen: set[str] = set()
    for it in input.items:
        if it.stock_id in seen:
            raise HTTPException(status_code=422, detail="Ada item opname ganda")
        seen.add(it.stock_id)
        stock = await db.stock_items.find_one({"id": it.stock_id})
        if not stock or stock["branch_id"] != b:
            raise HTTPException(status_code=403, detail="Item stok tidak ada di cabang ini")
        system_qty = int(stock["qty"])
        counted = int(it.counted_qty)
        if counted != system_qty:
            await db.stock_items.update_one(
                {"id": it.stock_id}, {"$set": {"qty": counted, "updated_at": now_utc()}}
            )
        items_out.append(
            {
                "article_id": stock["article_id"],
                "article_code": stock.get("article_code", ""),
                "article_name": stock.get("article_name", ""),
                "size": stock["size"],
                "system_qty": system_qty,
                "counted_qty": counted,
                "diff": counted - system_qty,
            }
        )

    doc = {
        "id": str(uuid.uuid4()),
        "branch_id": b,
        "branch_name": branch["name"],
        "items": items_out,
        "note": input.note.strip(),
        "created_by_name": user["name"],
        "created_at": now_utc(),
    }
    await db.opnames.insert_one(dict(doc))
    return OpnameOut(**clean_doc(doc))
