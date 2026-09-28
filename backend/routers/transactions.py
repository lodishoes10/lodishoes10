"""Transaksi: penjualan (SALE) & tukar artikel/ukuran berbasis qty (TUKAR).

Correctness rules baked in:
- ALL money is integer Rupiah — no floats anywhere.
- Prices/names/costs are snapshotted server-side from the stock & article docs (client can't tamper).
- Stock decrements are atomic (find_one_and_update with qty >= n) and compensated on failure —
  a sale/exchange never half-applies.
- Discount is allocated across lines exactly (last line absorbs rounding remainder), so
  profit = revenue - discount - cost is always exact and never double-counted.
- TUKAR: kasir memilih BERAPA pasang dari sebuah item dan target boleh CAMPUR (artikel &
  ukuran berbeda-beda). Selisih dihitung per pasang lalu ditotal jadi satu pembayaran/kembalian.
  Pasang yang ditukar di-reverse dari artikel lama dan dicatat ke artikel baru DI TRANSAKSI
  SALE ASAL, sehingga omset & laporan per artikel ikut menyesuaikan. Tukar bertahap boleh
  selama sisa pasang masih ada dan transaksi <= 7 hari, cabang yang sama.
"""

import os
import re
import uuid
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from lib.auth import get_current_user, naive_to_aware, now_utc, read_branch, require_branch
from lib.db import clean_doc, db, next_seq
from lib.dates import now_app, range_bounds_utc
from lib.receipt import build_receipt_text
from lib.schemas import Page

router = APIRouter()

PAY_METHODS = ("TUNAI", "QRIS", "TRANSFER", "DEBIT")
PAY_PATTERN = "^(TUNAI|QRIS|TRANSFER|DEBIT)$"
EXCHANGE_WINDOW_DAYS = 7


class SaleItemIn(BaseModel):
    article_id: str
    size: str = Field(min_length=1, max_length=8)
    qty: int = Field(gt=0, le=999)


class SaleIn(BaseModel):
    branch_id: str = ""
    items: list[SaleItemIn] = Field(min_length=1)
    discount: int = Field(default=0, ge=0)
    payment_method: str = Field(pattern=PAY_PATTERN)
    paid: int = Field(default=0, ge=0)
    customer_phone: str = Field(default="", max_length=24)


class TxItemOut(BaseModel):
    id: str
    article_id: str
    article_code: str
    article_name: str
    size: str
    qty: int
    price: int
    cost: int
    line_revenue: int
    discount_alloc: int
    line_cost: int
    exchanged_qty: int = 0  # total pasang yang sudah ditukar dari baris ini
    from_exchange: bool = False  # baris hasil tukar (masuk menggantikan baris lama)
    new_size: str | None = None
    new_price: int | None = None
    new_article_id: str | None = None
    new_article_code: str | None = None
    new_article_name: str | None = None


class TxOut(BaseModel):
    id: str
    receipt_no: str
    branch_id: str
    branch_name: str
    type: str
    cashier_id: str
    cashier_name: str
    items: list[TxItemOut]
    subtotal: int
    discount: int
    total: int
    payment_method: str
    paid: int
    change: int
    customer_phone: str
    note: str = ""
    wa_sent: bool = False
    wa_status: str | None = None
    created_at: datetime


class ExchangeTargetIn(BaseModel):
    article_id: str
    size: str = Field(min_length=1, max_length=8)
    qty: int = Field(gt=0, le=999)


class ExchangeLineIn(BaseModel):
    item_id: str
    targets: list[ExchangeTargetIn] = Field(min_length=1)


class ExchangeIn(BaseModel):
    branch_id: str = ""
    lines: list[ExchangeLineIn] = Field(min_length=1)
    payment_method: str = Field(pattern=PAY_PATTERN)
    diff_paid: int = Field(default=0, ge=0)


class WAIn(BaseModel):
    phone: str = Field(min_length=8, max_length=24)


def tx_out(doc: dict) -> TxOut:
    return TxOut(**clean_doc(doc))


def alloc_discount(lines: list[dict], discount: int) -> None:
    subtotal = sum(l["line_revenue"] for l in lines)
    if subtotal <= 0 or discount <= 0:
        return
    remaining = discount
    for i, l in enumerate(lines):
        if i == len(lines) - 1:  # last line absorbs the remainder → Σalloc == discount exactly
            l["discount_alloc"] = remaining
        else:
            share = discount * l["line_revenue"] // subtotal
            l["discount_alloc"] = share
            remaining -= share


async def make_receipt_no(branch: dict, prefix: str = "TRX") -> str:
    day = now_app().strftime("%Y%m%d")
    seq = await next_seq(f"{prefix}:{branch['code']}:{day}")
    return f"{prefix}-{day}-{branch['code']}-{seq:03d}"


@router.post("/transactions", response_model=TxOut, status_code=201)
async def create_sale(input: SaleIn, user: dict = Depends(get_current_user)):
    branch_id = require_branch(user, input.branch_id)
    branch = await db.branches.find_one({"id": branch_id})
    if not branch:
        raise HTTPException(status_code=404, detail="Cabang tidak ditemukan")

    # Merge duplicate (article, size) lines so stock math is done once per key.
    merged: dict[tuple[str, str], int] = {}
    order: list[tuple[str, str]] = []
    for it in input.items:
        key = (it.article_id, it.size.strip())
        if key not in merged:
            order.append(key)
        merged[key] = merged.get(key, 0) + it.qty

    lines: list[dict] = []
    for article_id, size in order:
        qty = merged[(article_id, size)]
        stock = await db.stock_items.find_one({"branch_id": branch_id, "article_id": article_id, "size": size})
        available = int(stock["qty"]) if stock else 0
        if not stock or available < qty:
            art = await db.articles.find_one({"id": article_id})
            name = art["name"] if art else article_id
            raise HTTPException(status_code=409, detail=f"Stok {name} ukuran {size} tidak cukup (tersisa {available})")
        art = await db.articles.find_one({"id": article_id})
        if not art:
            raise HTTPException(status_code=404, detail="Artikel tidak ditemukan")
        cost = int(art.get("cost_price", 0) or 0)
        price = int(stock["selling_price"])
        lines.append(
            {
                "id": str(uuid.uuid4()),
                "article_id": article_id,
                "article_code": art["code"],
                "article_name": art["name"],
                "size": size,
                "qty": qty,
                "price": price,
                "cost": cost,
                "line_revenue": price * qty,
                "discount_alloc": 0,
                "line_cost": cost * qty,
                "exchanged_qty": 0,
                "from_exchange": False,
            }
        )

    subtotal = sum(l["line_revenue"] for l in lines)
    if input.discount > subtotal:
        raise HTTPException(status_code=422, detail="Diskon melebihi total belanja")
    alloc_discount(lines, input.discount)
    total = subtotal - input.discount

    if input.payment_method == "TUNAI":
        paid = input.paid
        if paid < total:
            raise HTTPException(status_code=422, detail=f"Uang bayar kurang Rp {total - paid:,}".replace(",", "."))
    else:
        paid = total
    change = paid - total

    # Atomic decrement with compensation — never half-applies.
    done: list[dict] = []
    for l in lines:
        res = await db.stock_items.find_one_and_update(
            {
                "branch_id": branch_id,
                "article_id": l["article_id"],
                "size": l["size"],
                "qty": {"$gte": l["qty"]},
            },
            {"$inc": {"qty": -l["qty"]}, "$set": {"updated_at": now_utc()}},
        )
        if not res:
            for prev in done:  # roll back what was already taken
                await db.stock_items.update_one(
                    {"branch_id": branch_id, "article_id": prev["article_id"], "size": prev["size"]},
                    {"$inc": {"qty": prev["qty"]}},
                )
            raise HTTPException(status_code=409, detail=f"Stok {l['article_name']} ukuran {l['size']} baru saja habis")
        done.append(l)

    tx = {
        "id": str(uuid.uuid4()),
        "receipt_no": await make_receipt_no(branch),
        "branch_id": branch_id,
        "branch_name": branch["name"],
        "type": "SALE",
        "cashier_id": user["id"],
        "cashier_name": user["name"],
        "items": lines,
        "subtotal": subtotal,
        "discount": input.discount,
        "total": total,
        "payment_method": input.payment_method,
        "paid": paid,
        "change": change,
        "customer_phone": input.customer_phone.strip(),
        "note": "",
        "wa_sent": False,
        "wa_status": None,
        "created_at": now_utc(),
    }
    await db.transactions.insert_one(dict(tx))
    return tx_out(tx)


@router.get("/transactions", response_model=Page[TxOut])
async def list_transactions(
    branch_id: str = "",
    tx_type: str = Query("", alias="type"),
    q: str = "",
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    match: dict = {}
    b = read_branch(user, branch_id)
    if b:
        match["branch_id"] = b
    if tx_type in ("SALE", "TUKAR"):
        match["type"] = tx_type
    if q.strip():
        match["receipt_no"] = {"$regex": re.escape(q.strip()), "$options": "i"}
    if from_date or to_date:
        start, end = range_bounds_utc(from_date, to_date, default_days=7)
        match["created_at"] = {"$gte": start, "$lt": end}
    total = await db.transactions.count_documents(match)
    docs = (
        await db.transactions.find(match)
        .sort("created_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list(page_size)
    )
    return Page(items=[tx_out(d) for d in docs], total=total, page=page, page_size=page_size)


@router.get("/transactions/{tx_id}", response_model=TxOut)
async def get_transaction(tx_id: str, user: dict = Depends(get_current_user)):
    tx = await db.transactions.find_one({"id": tx_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    read_branch(user, tx["branch_id"])  # kasir can only open own-branch transactions
    return tx_out(tx)


@router.post("/transactions/{tx_id}/exchange", response_model=TxOut, status_code=201)
async def exchange_items(tx_id: str, input: ExchangeIn, user: dict = Depends(get_current_user)):
    """Tukar artikel/ukuran berbasis qty. Target boleh campur; selisih ditotal jadi satu.

    Efek:
    - Stok artikel/ukuran lama dikembalikan (+), target dikurangi (−) — atomik berkompensasi.
    - Transaksi SALE asal dimutasi: qty baris lama berkurang, baris baru (target) ditambah,
      subtotal/total dihitung ulang → omset total & per artikel menyesuaikan otomatis.
    - Tercatat juga sebagai transaksi TUKAR (selisih uang) yang TIDAK masuk omzet/laba.
    """
    tx = await db.transactions.find_one({"id": tx_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    read_branch(user, tx["branch_id"])
    if tx.get("type") != "SALE":
        raise HTTPException(status_code=409, detail="Hanya transaksi PENJUALAN yang bisa ditukar")
    created = naive_to_aware(tx["created_at"])
    if now_utc() - created > timedelta(days=EXCHANGE_WINDOW_DAYS):
        raise HTTPException(status_code=409, detail="Melewati batas tukar 7 hari")

    branch_id = require_branch(user, input.branch_id)
    if branch_id != tx["branch_id"]:
        raise HTTPException(status_code=409, detail="Tukar hanya bisa di cabang asal transaksi")
    branch = await db.branches.find_one({"id": branch_id})
    if not branch:
        raise HTTPException(status_code=404, detail="Cabang tidak ditemukan")

    # ---- Validasi & resolusi semua baris/target (harga & modal di-snapshot server) ----
    resolved: list[dict] = []  # per baris sumber
    for line in input.lines:
        item = next((i for i in tx["items"] if i["id"] == line.item_id), None)
        if not item:
            raise HTTPException(status_code=404, detail="Item tidak ditemukan di transaksi ini")
        qty_line = sum(t.qty for t in line.targets)
        remaining = int(item["qty"])  # qty baris = sisa yang belum ditukar
        if qty_line < 1 or qty_line > remaining:
            raise HTTPException(
                status_code=422,
                detail=f"{item['article_name']} uk. {item['size']}: sisa yang bisa ditukar {remaining} pasang",
            )
        targets: list[dict] = []
        for t in line.targets:
            size = t.size.strip()
            if t.article_id == item["article_id"] and size == item["size"]:
                raise HTTPException(status_code=422, detail="Target tukar sama dengan artikel/ukuran asal")
            stock = await db.stock_items.find_one(
                {"branch_id": branch_id, "article_id": t.article_id, "size": size}
            )
            available = int(stock["qty"]) if stock else 0
            art = await db.articles.find_one({"id": t.article_id})
            if not art or not art.get("is_active", True):
                raise HTTPException(status_code=404, detail="Artikel target tidak ditemukan")
            if not stock or available < t.qty:
                raise HTTPException(
                    status_code=409,
                    detail=f"Stok {art['name']} ukuran {size} tidak cukup (tersisa {available})",
                )
            targets.append(
                {
                    "article_id": t.article_id,
                    "article_code": art["code"],
                    "article_name": art["name"],
                    "size": size,
                    "qty": t.qty,
                    "price": int(stock["selling_price"]),
                    "cost": int(art.get("cost_price", 0) or 0),
                }
            )
        resolved.append({"item": item, "qty": qty_line, "targets": targets})

    # Gabung target yang sama (artikel+size) di seluruh baris untuk potong stok sekali per kunci.
    merged_targets: dict[tuple[str, str], dict] = {}
    target_order: list[tuple[str, str]] = []
    for r in resolved:
        for t in r["targets"]:
            key = (t["article_id"], t["size"])
            if key not in merged_targets:
                target_order.append(key)
                merged_targets[key] = {**t}
            else:
                merged_targets[key]["qty"] += t["qty"]
    for key in target_order:
        t = merged_targets[key]
        stock = await db.stock_items.find_one(
            {"branch_id": branch_id, "article_id": t["article_id"], "size": t["size"]}
        )
        if not stock or int(stock["qty"]) < t["qty"]:
            raise HTTPException(
                status_code=409,
                detail=f"Stok {t['article_name']} ukuran {t['size']} tidak cukup (tersisa {int(stock['qty']) if stock else 0})",
            )

    # Selisih per pasang → ditotal. Positif = pelanggan menambah; negatif = kasir mengembalikan.
    total_diff = 0
    for r in resolved:
        old_price = int(r["item"]["price"])
        for t in r["targets"]:
            total_diff += t["qty"] * (t["price"] - old_price)

    if total_diff > 0:
        if input.payment_method == "TUNAI":
            if input.diff_paid < total_diff:
                raise HTTPException(
                    status_code=422,
                    detail=f"Uang selisih kurang Rp {total_diff - input.diff_paid:,}".replace(",", "."),
                )
            paid = input.diff_paid
            change = input.diff_paid - total_diff
        else:
            paid = total_diff
            change = 0
    else:
        paid = 0
        change = -total_diff  # uang yang dikembalikan ke pelanggan

    # ---- Stok: target −qty (atomik, kompensasi bila gagal), lalu sumber +qty ----
    done: list[dict] = []
    for key in target_order:
        t = merged_targets[key]
        res = await db.stock_items.find_one_and_update(
            {"branch_id": branch_id, "article_id": t["article_id"], "size": t["size"], "qty": {"$gte": t["qty"]}},
            {"$inc": {"qty": -t["qty"]}, "$set": {"updated_at": now_utc()}},
        )
        if not res:
            for prev in done:
                await db.stock_items.update_one(
                    {"branch_id": branch_id, "article_id": prev["article_id"], "size": prev["size"]},
                    {"$inc": {"qty": prev["qty"]}},
                )
            raise HTTPException(
                status_code=409, detail=f"Stok {t['article_name']} ukuran {t['size']} baru saja berubah"
            )
        done.append(t)

    for r in resolved:
        item = r["item"]
        try:
            await db.stock_items.find_one_and_update(
                {"branch_id": branch_id, "article_id": item["article_id"], "size": item["size"]},
                {
                    "$inc": {"qty": r["qty"]},
                    "$set": {"updated_at": now_utc()},
                    "$setOnInsert": {
                        "id": str(uuid.uuid4()),
                        "created_at": now_utc(),
                        "selling_price": int(item["price"]),
                        "article_code": item["article_code"],
                        "article_name": item["article_name"],
                    },
                },
                upsert=True,
            )
        except DuplicateKeyError:  # concurrent insert won the race — retry as plain increment
            await db.stock_items.update_one(
                {"branch_id": branch_id, "article_id": item["article_id"], "size": item["size"]},
                {"$inc": {"qty": r["qty"]}, "$set": {"updated_at": now_utc()}},
            )

    # ---- Mutasi transaksi SALE asal: omset per artikel ikut pindah ----
    items = [dict(i) for i in tx["items"]]
    tukar_items: list[dict] = []
    exchange_lines: list[dict] = []
    for r in resolved:
        item = r["item"]
        src = next(i for i in items if i["id"] == item["id"])
        n = r["qty"]
        src["qty"] = int(src["qty"]) - n
        src["exchanged_qty"] = int(src.get("exchanged_qty", 0)) + n
        src["line_revenue"] = int(src["price"]) * src["qty"]
        src["line_cost"] = int(src["cost"]) * src["qty"]
        exchange_lines.append(
            {
                "item_id": item["id"],
                "article_id": item["article_id"],
                "article_code": item["article_code"],
                "article_name": item["article_name"],
                "size": item["size"],
                "price": int(item["price"]),
                "qty": n,
                "targets": [
                    {k: t[k] for k in ("article_id", "article_code", "article_name", "size", "qty", "price")}
                    for t in r["targets"]
                ],
            }
        )
        for t in r["targets"]:
            items.append(
                {
                    "id": str(uuid.uuid4()),
                    "article_id": t["article_id"],
                    "article_code": t["article_code"],
                    "article_name": t["article_name"],
                    "size": t["size"],
                    "qty": t["qty"],
                    "price": t["price"],
                    "cost": t["cost"],
                    "line_revenue": t["price"] * t["qty"],
                    "discount_alloc": 0,
                    "line_cost": t["cost"] * t["qty"],
                    "exchanged_qty": 0,
                    "from_exchange": True,
                }
            )
            # Satu baris TUKAR per target: artikel LAMA di field utama, target di new_*.
            tukar_items.append(
                {
                    "id": str(uuid.uuid4()),
                    "article_id": item["article_id"],
                    "article_code": item["article_code"],
                    "article_name": item["article_name"],
                    "size": item["size"],
                    "qty": t["qty"],
                    "price": int(item["price"]),
                    "cost": int(item.get("cost", 0)),
                    "line_revenue": int(item["price"]) * t["qty"],
                    "discount_alloc": 0,
                    "line_cost": int(item.get("cost", 0)) * t["qty"],
                    "exchanged_qty": 0,
                    "from_exchange": False,
                    "new_article_id": t["article_id"],
                    "new_article_code": t["article_code"],
                    "new_article_name": t["article_name"],
                    "new_size": t["size"],
                    "new_price": t["price"],
                }
            )

    new_subtotal = sum(int(i["line_revenue"]) for i in items)
    new_total = new_subtotal - int(tx.get("discount", 0))
    await db.transactions.update_one(
        {"id": tx_id},
        {"$set": {"items": items, "subtotal": new_subtotal, "total": new_total}},
    )

    await db.exchanges.insert_one(
        {
            "id": str(uuid.uuid4()),
            "tx_id": tx_id,
            "receipt_no": tx["receipt_no"],
            "lines": exchange_lines,
            "total_diff": total_diff,
            "payment_method": input.payment_method,
            "branch_id": branch_id,
            "branch_name": branch["name"],
            "by_id": user["id"],
            "by_name": user["name"],
            "created_at": now_utc(),
        }
    )

    # Transaksi TUKAR — bukti selisih uang; TIDAK masuk omzet/laba (semua laporan filter SALE).
    tukar_tx = {
        "id": str(uuid.uuid4()),
        "receipt_no": await make_receipt_no(branch, prefix="TUKAR"),
        "branch_id": branch_id,
        "branch_name": branch["name"],
        "type": "TUKAR",
        "cashier_id": user["id"],
        "cashier_name": user["name"],
        "items": tukar_items,
        "subtotal": total_diff,
        "discount": 0,
        "total": total_diff,
        "payment_method": input.payment_method,
        "paid": paid,
        "change": change,
        "customer_phone": "",
        "note": f"Tukar artikel dari {tx['receipt_no']}",
        "wa_sent": False,
        "wa_status": None,
        "created_at": now_utc(),
    }
    await db.transactions.insert_one(dict(tukar_tx))
    return tx_out(tukar_tx)


def normalize_wa(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    return "+" + digits


@router.post("/transactions/{tx_id}/whatsapp")
async def send_receipt_whatsapp(tx_id: str, input: WAIn, user: dict = Depends(get_current_user)):
    tx = await db.transactions.find_one({"id": tx_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    read_branch(user, tx["branch_id"])
    branch = await db.branches.find_one({"id": tx["branch_id"]}) or {}

    to = normalize_wa(input.phone)
    if len(to) < 11:
        raise HTTPException(status_code=422, detail="Nomor WhatsApp tidak valid (contoh: 08123456789)")

    sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    from_wa = os.environ.get("TWILIO_WHATSAPP_FROM", "").strip()
    if not sid or not token or not from_wa:
        raise HTTPException(
            status_code=503,
            detail="WhatsApp belum dikonfigurasi — isi TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, "
            "TWILIO_WHATSAPP_FROM (nomor WA toko) di backend/.env lalu restart backend",
        )

    text = build_receipt_text(tx, branch)
    data = {
        "To": "whatsapp:" + to,
        "From": from_wa if from_wa.startswith("whatsapp:") else "whatsapp:" + from_wa,
        "Body": text,
    }
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, data=data, auth=(sid, token))
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Gagal menghubungi Twilio — cek koneksi/kredensial")
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("message", "Twilio menolak pesan")
        except Exception:
            detail = "Twilio menolak pesan"
        raise HTTPException(status_code=502, detail=f"WhatsApp gagal: {detail}")
    result = resp.json()
    await db.transactions.update_one(
        {"id": tx_id},
        {
            "$set": {
                "wa_sent": True,
                "wa_to": to,
                "wa_sid": result.get("sid", ""),
                "wa_status": result.get("status", ""),
            }
        },
    )
    return {"ok": True, "to": to, "sid": result.get("sid", ""), "status": result.get("status", "")}
