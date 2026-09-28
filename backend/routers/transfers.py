"""Transfer / oper stok antar cabang dengan persetujuan admin.

Alur: kasir mengajukan → status MENUNGGU (stok BELUM bergerak) → admin Setujui/Tolak.
Stok pindah HANYA saat disetujui: source decrement atomik (berkompensasi), destination upsert.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from lib.auth import get_current_user, now_utc, read_branch, require_admin, require_branch
from lib.db import clean_doc, db

router = APIRouter()

STATUS = ("MENUNGGU", "DISETUJUI", "DITOLAK")


class TransferItemIn(BaseModel):
    article_id: str
    size: str = Field(min_length=1, max_length=8)
    qty: int = Field(gt=0, le=9999)


class TransferIn(BaseModel):
    from_branch_id: str = ""
    to_branch_id: str = Field(min_length=1)
    items: list[TransferItemIn] = Field(min_length=1)
    note: str = Field(default="", max_length=200)


class RejectIn(BaseModel):
    reason: str = Field(default="", max_length=200)


class TransferItemOut(BaseModel):
    article_id: str
    article_code: str
    article_name: str
    size: str
    qty: int


class TransferOut(BaseModel):
    id: str
    from_branch_id: str
    from_branch_name: str
    to_branch_id: str
    to_branch_name: str
    items: list[TransferItemOut]
    note: str = ""
    status: str = "MENUNGGU"
    created_by_name: str
    created_at: datetime
    decided_by_name: str | None = None
    decided_at: datetime | None = None
    reject_reason: str = ""


def transfer_out(doc: dict) -> TransferOut:
    data = clean_doc(doc)
    data.setdefault("status", "MENUNGGU")
    return TransferOut(**data)


async def _resolve_items(from_id: str, items: list[TransferItemIn]) -> list[dict]:
    """Merge duplikat + snapshot nama & harga; validasi ketersediaan stok di cabang asal."""
    merged: dict[tuple[str, str], int] = {}
    order: list[tuple[str, str]] = []
    for it in items:
        key = (it.article_id, it.size.strip())
        if key not in merged:
            order.append(key)
        merged[key] = merged.get(key, 0) + it.qty

    items_out: list[dict] = []
    for article_id, size in order:
        qty = merged[(article_id, size)]
        stock = await db.stock_items.find_one({"branch_id": from_id, "article_id": article_id, "size": size})
        available = int(stock["qty"]) if stock else 0
        art = await db.articles.find_one({"id": article_id})
        if not art:
            raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
        if not stock or available < qty:
            raise HTTPException(
                status_code=409,
                detail=f"Stok {art['name']} ukuran {size} tidak cukup (tersisa {available})",
            )
        items_out.append(
            {
                "article_id": article_id,
                "article_code": art["code"],
                "article_name": art["name"],
                "size": size,
                "qty": qty,
                "selling_price": int(stock["selling_price"]),
            }
        )
    return items_out


@router.get("/transfers", response_model=list[TransferOut])
async def list_transfers(branch_id: str = "", limit: int = Query(30, le=100), user: dict = Depends(get_current_user)):
    match: dict = {}
    b = read_branch(user, branch_id)
    if b:
        match["$or"] = [{"from_branch_id": b}, {"to_branch_id": b}]
    docs = await db.transfers.find(match).sort("created_at", -1).limit(limit).to_list(limit)
    return [transfer_out(d) for d in docs]


@router.post("/transfers", response_model=TransferOut, status_code=201)
async def create_transfer(input: TransferIn, user: dict = Depends(get_current_user)):
    """Pengajuan transfer oleh kasir/admin. Stok BELUM bergerak sampai admin menyetujui."""
    from_id = require_branch(user, input.from_branch_id)
    to_id = input.to_branch_id.strip()
    if to_id == from_id:
        raise HTTPException(status_code=422, detail="Cabang tujuan sama dengan cabang asal")
    from_b = await db.branches.find_one({"id": from_id})
    to_b = await db.branches.find_one({"id": to_id})
    if not from_b or not to_b:
        raise HTTPException(status_code=404, detail="Cabang tidak ditemukan")

    # Validasi awal supaya pengajuan mustahil ditolak karena stok — tetap divalidasi ulang saat approve.
    items_out = await _resolve_items(from_id, input.items)

    doc = {
        "id": str(uuid.uuid4()),
        "from_branch_id": from_id,
        "from_branch_name": from_b["name"],
        "to_branch_id": to_id,
        "to_branch_name": to_b["name"],
        "items": items_out,  # selling_price ikut tersimpan untuk upsert tujuan saat approve
        "note": input.note.strip(),
        "status": "MENUNGGU",
        "created_by_name": user["name"],
        "created_at": now_utc(),
        "decided_by_name": None,
        "decided_at": None,
        "reject_reason": "",
    }
    await db.transfers.insert_one(dict(doc))
    return transfer_out(doc)


@router.post("/transfers/{transfer_id}/approve", response_model=TransferOut)
async def approve_transfer(transfer_id: str, user: dict = Depends(require_admin)):
    """Admin menyetujui → stok baru berpindah (source −qty atomik, destination +qty upsert)."""
    doc = await db.transfers.find_one({"id": transfer_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Transfer tidak ditemukan")
    if doc.get("status") != "MENUNGGU":
        raise HTTPException(status_code=409, detail=f"Transfer sudah {doc.get('status', 'diproses').lower()}")

    from_id = doc["from_branch_id"]
    to_id = doc["to_branch_id"]
    # Validasi ulang saat approve — stok bisa berubah sejak pengajuan.
    items = await _resolve_items(from_id, [TransferItemIn(**{k: it[k] for k in ("article_id", "size", "qty")}) for it in doc["items"]])

    # Phase 1 — decrement source atomically; compensate everything on the first failure.
    done: list[dict] = []
    for it in items:
        res = await db.stock_items.find_one_and_update(
            {"branch_id": from_id, "article_id": it["article_id"], "size": it["size"], "qty": {"$gte": it["qty"]}},
            {"$inc": {"qty": -it["qty"]}, "$set": {"updated_at": now_utc()}},
        )
        if not res:
            for prev in done:
                await db.stock_items.update_one(
                    {"branch_id": from_id, "article_id": prev["article_id"], "size": prev["size"]},
                    {"$inc": {"qty": prev["qty"]}},
                )
            raise HTTPException(status_code=409, detail=f"Stok {it['article_name']} ukuran {it['size']} baru saja berubah")
        done.append(it)

    # Phase 2 — increment destination (upsert keeps destination price if the size already exists).
    for it in items:
        try:
            await db.stock_items.find_one_and_update(
                {"branch_id": to_id, "article_id": it["article_id"], "size": it["size"]},
                {
                    "$inc": {"qty": it["qty"]},
                    "$set": {"updated_at": now_utc()},
                    "$setOnInsert": {
                        "id": str(uuid.uuid4()),
                        "created_at": now_utc(),
                        "selling_price": it["selling_price"],
                        "article_code": it["article_code"],
                        "article_name": it["article_name"],
                    },
                },
                upsert=True,
            )
        except DuplicateKeyError:
            await db.stock_items.update_one(
                {"branch_id": to_id, "article_id": it["article_id"], "size": it["size"]},
                {"$inc": {"qty": it["qty"]}, "$set": {"updated_at": now_utc()}},
            )

    fresh = await db.transfers.find_one_and_update(
        {"id": transfer_id},
        {"$set": {"status": "DISETUJUI", "decided_by_name": user["name"], "decided_at": now_utc()}},
        return_document=ReturnDocument.AFTER,
    )
    return transfer_out(fresh or doc)


@router.post("/transfers/{transfer_id}/reject", response_model=TransferOut)
async def reject_transfer(transfer_id: str, input: RejectIn, user: dict = Depends(require_admin)):
    """Admin menolak → stok tidak bergerak sama sekali."""
    doc = await db.transfers.find_one({"id": transfer_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Transfer tidak ditemukan")
    if doc.get("status") != "MENUNGGU":
        raise HTTPException(status_code=409, detail=f"Transfer sudah {doc.get('status', 'diproses').lower()}")
    fresh = await db.transfers.find_one_and_update(
        {"id": transfer_id},
        {
            "$set": {
                "status": "DITOLAK",
                "decided_by_name": user["name"],
                "decided_at": now_utc(),
                "reject_reason": input.reason.strip(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    return transfer_out(fresh or doc)
