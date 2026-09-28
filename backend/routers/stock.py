"""Stok per cabang. Anti-dobel dijamin index unik (branch_id, article_id, size):
menambah ukuran 39 ke artikel yang sama HANYA menaikkan qty, tidak pernah duplikat."""

import csv
import io
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from lib.auth import get_current_user, now_utc, require_branch
from lib.db import clean_doc, db

router = APIRouter()


class SizeStockOut(BaseModel):
    id: str
    size: str
    qty: int
    selling_price: int


class StockRowOut(BaseModel):
    article_id: str
    code: str
    name: str
    brand: str = ""
    category: str = ""
    image_url: str = ""
    cost_price: int | None = None  # None untuk kasir
    sizes: list[SizeStockOut]


class StockAddIn(BaseModel):
    branch_id: str = ""
    article_id: str
    # Ukuran ditulis bebas oleh kasir cabang (sandal/sepatu punya penomoran berbeda),
    # mis. "39", "40.5", "XL", "L42". Tetap satu dokumen per (cabang, artikel, ukuran).
    size: str = Field(min_length=1, max_length=8)
    qty: int = Field(gt=0, le=9999)
    selling_price: int = Field(ge=0)


class StockPatchIn(BaseModel):
    selling_price: int | None = Field(default=None, ge=0)
    qty: int | None = Field(default=None, ge=0)  # admin only (koreksi manual)


def _size_key(s: str) -> tuple[int, str]:
    return (len(s), s)


@router.get("/stock/matrix", response_model=list[StockRowOut])
async def stock_matrix(branch_id: str = "", user: dict = Depends(get_current_user)):
    b = require_branch(user, branch_id)
    items = await db.stock_items.find({"branch_id": b}).to_list(5000)
    ids = sorted({i["article_id"] for i in items})
    arts = {a["id"]: a async for a in db.articles.find({"id": {"$in": ids}})}
    is_admin = user.get("role") == "admin"
    rows: dict[str, StockRowOut] = {}
    for it in items:
        art = arts.get(it["article_id"])
        if not art:
            continue
        row = rows.setdefault(
            it["article_id"],
            StockRowOut(
                article_id=it["article_id"],
                code=art["code"],
                name=art["name"],
                brand=art.get("brand", ""),
                category=art.get("category", ""),
                image_url=art.get("image_url", ""),
                cost_price=int(art.get("cost_price", 0)) if is_admin else None,
                sizes=[],
            ),
        )
        row.sizes.append(SizeStockOut(id=it["id"], size=it["size"], qty=int(it["qty"]), selling_price=int(it["selling_price"])))
    out = list(rows.values())
    for r in out:
        r.sizes.sort(key=lambda s: _size_key(s.size))
    out.sort(key=lambda r: (r.code, r.name))
    return out


@router.post("/stock/add")
async def add_stock(input: StockAddIn, user: dict = Depends(get_current_user)):
    b = require_branch(user, input.branch_id)
    art = await db.articles.find_one({"id": input.article_id})
    if not art:
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
    size = input.size.strip()
    now = now_utc()
    existing = await db.stock_items.find_one({"branch_id": b, "article_id": input.article_id, "size": size})
    doc = None
    for attempt in range(2):
        try:
            doc = await db.stock_items.find_one_and_update(
                {"branch_id": b, "article_id": input.article_id, "size": size},
                {
                    "$inc": {"qty": input.qty},
                    "$set": {"selling_price": int(input.selling_price), "updated_at": now},
                    "$setOnInsert": {
                        "id": str(uuid.uuid4()),
                        "created_at": now,
                        "article_code": art["code"],
                        "article_name": art["name"],
                    },
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            break
        except DuplicateKeyError:
            if attempt:  # second failure — give up with a clear error
                raise HTTPException(status_code=409, detail="Gagal menambah stok, coba lagi")
    return {
        "ok": True,
        "stock_id": doc["id"],
        "qty": int(doc["qty"]),
        "merged": existing is not None,  # True = ukuran sudah ada → qty digabung (anti-dobel bekerja)
    }


class StockImportIn(BaseModel):
    branch_id: str = ""
    csv: str = Field(min_length=1, max_length=2_000_000)


def _norm(name: str) -> str:
    return (name or "").strip().lower().replace(" ", "_")


_STOCK_ALIASES = {
    "kode": "code", "code": "code", "sku": "code",
    "barcode": "barcode",
    "ukuran": "size", "size": "size",
    "jumlah": "qty", "qty": "qty", "stok": "qty", "stock": "qty",
    "harga_jual": "price", "harga": "price", "price": "price", "selling_price": "price",
}


@router.post("/stock/import")
async def import_stock(input: StockImportIn, user: dict = Depends(get_current_user)):
    """Impor massal stok per ukuran dari CSV untuk cabang aktif.

    Header didukung: kode (atau barcode), ukuran, jumlah, harga_jual.
    Jumlah & harga di-SET (menimpa nilai lama untuk ukuran itu) — cocok untuk isi awal/koreksi.
    """
    b = require_branch(user, input.branch_id)
    reader = csv.DictReader(io.StringIO(input.csv))
    if not reader.fieldnames:
        raise HTTPException(status_code=422, detail="CSV kosong atau tanpa header")
    field_map = {fn: _STOCK_ALIASES.get(_norm(fn)) for fn in reader.fieldnames}
    vals = set(field_map.values())
    if "size" not in vals or "price" not in vals or ("code" not in vals and "barcode" not in vals):
        raise HTTPException(status_code=422, detail="CSV wajib punya kolom: kode (atau barcode), ukuran, harga_jual")

    applied = 0
    errors: list[str] = []
    now = now_utc()
    for i, raw in enumerate(reader, start=2):
        row: dict = {}
        for fn, val in raw.items():
            key = field_map.get(fn)
            if key:
                row[key] = (val or "").strip()
        size = (row.get("size") or "").strip()[:8]
        if not size:
            continue
        code = (row.get("code") or "").strip().upper()
        barcode = (row.get("barcode") or "").strip()
        art = None
        if code:
            art = await db.articles.find_one({"code": code})
        if not art and barcode:
            art = await db.articles.find_one({"barcode": barcode})
        if not art:
            errors.append(f"Baris {i}: artikel '{code or barcode}' tidak ditemukan")
            continue
        try:
            qty = int(re.sub(r"\D", "", row.get("qty", "")) or 0)
            price = int(re.sub(r"\D", "", row.get("price", "")) or 0)
        except ValueError:
            errors.append(f"Baris {i}: jumlah/harga tidak valid")
            continue
        if price <= 0:
            errors.append(f"Baris {i} ({art['name']} {size}): harga jual harus > 0")
            continue
        await db.stock_items.update_one(
            {"branch_id": b, "article_id": art["id"], "size": size},
            {
                "$set": {"qty": qty, "selling_price": price, "updated_at": now},
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "created_at": now,
                    "article_code": art["code"],
                    "article_name": art["name"],
                },
            },
            upsert=True,
        )
        applied += 1
    return {"ok": True, "applied": applied, "errors": errors[:50]}


@router.patch("/stock/{stock_id}")
async def patch_stock(stock_id: str, input: StockPatchIn, user: dict = Depends(get_current_user)):
    item = await db.stock_items.find_one({"id": stock_id})
    if not item:
        raise HTTPException(status_code=404, detail="Stok tidak ditemukan")
    require_branch(user, item["branch_id"])
    update: dict = {}
    if input.selling_price is not None:
        update["selling_price"] = int(input.selling_price)
    if input.qty is not None:
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Koreksi qty khusus admin — gunakan opname/transfer")
        update["qty"] = int(input.qty)
    if not update:
        raise HTTPException(status_code=422, detail="Tidak ada perubahan")
    update["updated_at"] = now_utc()
    doc = await db.stock_items.find_one_and_update({"id": stock_id}, {"$set": update}, return_document=ReturnDocument.AFTER)
    return clean_doc(doc)
