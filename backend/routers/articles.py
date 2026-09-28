"""Artikel (master produk).

- Harga modal (cost_price) hanya untuk admin — kasir tidak pernah menerimanya.
- Kasir cabang BOLEH membuat artikel baru (nama + barcode + harga jual), tapi tidak boleh
  mengisi/melihat modal. Modal diisi admin belakangan.
- Barcode unik (sparse) → scan langsung mengisi nama artikel otomatis.
- Gambar barcode (PNG Code128) di-generate server; artikel tanpa barcode otomatis
  mendapat nomor barcode unik saat gambar/label pertama kali diminta.
"""

import asyncio
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from lib.auth import get_current_user, now_utc, require_admin
from lib.barcode_gen import barcode_png
from lib.db import clean_doc, db, next_seq
from lib.schemas import Page

router = APIRouter()


class ArticleOut(BaseModel):
    id: str
    code: str
    name: str
    brand: str = ""
    category: str = ""
    barcode: str = ""
    cost_price: int | None = None  # None untuk kasir (hidden by design)
    image_url: str = ""
    is_active: bool = True
    created_at: datetime


class ArticleIn(BaseModel):
    code: str = Field(default="", max_length=24)  # kosong = dibuatkan otomatis
    name: str = Field(min_length=2, max_length=80)
    brand: str = Field(default="", max_length=40)
    category: str = Field(default="", max_length=40)
    barcode: str = Field(default="", max_length=48)
    cost_price: int = Field(default=0, ge=0)
    image_url: str = Field(default="", max_length=400_000)


class ArticlePatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    brand: str | None = Field(default=None, max_length=40)
    category: str | None = Field(default=None, max_length=40)
    barcode: str | None = Field(default=None, max_length=48)
    cost_price: int | None = Field(default=None, ge=0)
    image_url: str | None = Field(default=None, max_length=400_000)
    is_active: bool | None = None


def article_out(doc: dict, include_cost: bool) -> ArticleOut:
    data = clean_doc(doc)
    data.setdefault("barcode", "")
    if not include_cost:
        data.pop("cost_price", None)
    return ArticleOut(**data)


async def _auto_code() -> str:
    """Kode artikel otomatis LS-### supaya kasir tidak perlu memikirkan format."""
    last = await db.articles.find({"code": {"$regex": r"^LS-\d+$"}}).sort("code", -1).limit(1).to_list(1)
    n = int(last[0]["code"].split("-")[1]) + 1 if last else 1
    while await db.articles.find_one({"code": f"LS-{n:03d}"}):
        n += 1
    return f"LS-{n:03d}"


@router.get("/articles", response_model=Page[ArticleOut])
async def list_articles(
    q: str = "",
    include_inactive: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    user: dict = Depends(get_current_user),
):
    match: dict = {}
    if not (include_inactive and user.get("role") == "admin"):
        match["is_active"] = True
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        match["$or"] = [{"name": rx}, {"code": rx}, {"brand": rx}, {"barcode": rx}]
    total = await db.articles.count_documents(match)
    docs = (
        await db.articles.find(match)
        .sort("code", 1)
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list(page_size)
    )
    is_admin = user.get("role") == "admin"
    return Page(items=[article_out(d, is_admin) for d in docs], total=total, page=page, page_size=page_size)


@router.get("/articles/by-barcode/{barcode}", response_model=ArticleOut)
async def get_by_barcode(barcode: str, user: dict = Depends(get_current_user)):
    """Scan barcode → artikel. Dipakai POS & form tambah stok untuk isi otomatis."""
    code = barcode.strip()
    doc = await db.articles.find_one({"barcode": code, "is_active": True})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Barcode {code} belum terdaftar")
    return article_out(doc, user.get("role") == "admin")


@router.post("/articles", response_model=ArticleOut, status_code=201)
async def create_article(input: ArticleIn, user: dict = Depends(get_current_user)):
    is_admin = user.get("role") == "admin"
    code = (input.code or "").strip().upper() or await _auto_code()
    if await db.articles.find_one({"code": code}):
        raise HTTPException(status_code=409, detail=f"Kode artikel {code} sudah dipakai")
    barcode = input.barcode.strip()
    if barcode and await db.articles.find_one({"barcode": barcode}):
        raise HTTPException(status_code=409, detail=f"Barcode {barcode} sudah dipakai artikel lain")
    doc = {
        "id": str(uuid.uuid4()),
        "code": code,
        "name": input.name.strip(),
        "brand": input.brand.strip(),
        "category": input.category.strip(),
        "barcode": barcode,
        # Kasir tidak boleh menetapkan modal — dipaksa 0, admin mengisinya kemudian.
        "cost_price": int(input.cost_price) if is_admin else 0,
        "image_url": input.image_url,
        "is_active": True,
        "created_at": now_utc(),
    }
    await db.articles.insert_one(dict(doc))
    return article_out(doc, include_cost=is_admin)


@router.patch("/articles/{article_id}", response_model=ArticleOut)
async def patch_article(article_id: str, input: ArticlePatch, user: dict = Depends(get_current_user)):
    is_admin = user.get("role") == "admin"
    doc = await db.articles.find_one({"id": article_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
    update = input.model_dump(exclude_none=True)
    if not is_admin:
        # Kasir hanya boleh melengkapi nama/barcode — modal & status tetap milik admin.
        for locked in ("cost_price", "is_active", "image_url"):
            update.pop(locked, None)
    if "barcode" in update:
        bc = update["barcode"].strip()
        if bc:
            clash = await db.articles.find_one({"barcode": bc, "id": {"$ne": article_id}})
            if clash:
                raise HTTPException(status_code=409, detail=f"Barcode {bc} sudah dipakai {clash['name']}")
        update["barcode"] = bc
    if update:
        await db.articles.update_one({"id": article_id}, {"$set": update})
    fresh = await db.articles.find_one({"id": article_id})
    return article_out(fresh, include_cost=is_admin)


@router.delete("/articles/{article_id}")
async def deactivate_article(article_id: str, user: dict = Depends(require_admin)):
    doc = await db.articles.find_one({"id": article_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
    await db.articles.update_one({"id": article_id}, {"$set": {"is_active": False}})
    return {"ok": True}


async def _ensure_barcode(article_id: str) -> str:
    """Kembalikan barcode artikel; bila kosong, buatkan nomor unik 899xxxxxxxxxx dan simpan."""
    doc = await db.articles.find_one({"id": article_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
    if doc.get("barcode"):
        return doc["barcode"]
    for _ in range(5):
        code = f"899{await next_seq('barcode'):010d}"
        try:
            res = await db.articles.find_one_and_update(
                {"id": article_id, "$or": [{"barcode": ""}, {"barcode": {"$exists": False}}]},
                {"$set": {"barcode": code}},
            )
            if res:
                return code
            fresh = await db.articles.find_one({"id": article_id})
            if fresh and fresh.get("barcode"):
                return fresh["barcode"]
        except DuplicateKeyError:
            continue  # nomor bentrok (jarang) — coba nomor berikutnya
    raise HTTPException(status_code=500, detail="Gagal membuat barcode, coba lagi")


@router.get("/articles/{article_id}/barcode.png")
async def barcode_image(article_id: str, user: dict = Depends(get_current_user)):
    """Gambar barcode (Code128 PNG) untuk label cetak & preview."""
    code = await _ensure_barcode(article_id)
    png = await asyncio.to_thread(barcode_png, code)
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "no-cache"})


@router.post("/articles/{article_id}/barcode")
async def assign_barcode(article_id: str, user: dict = Depends(get_current_user)):
    """Pastikan artikel punya barcode (generate bila belum) dan kembalikan nomornya."""
    code = await _ensure_barcode(article_id)
    return {"barcode": code}
