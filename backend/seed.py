"""Seed data demo LodiShoes POS. Idempoten: jalankan ulang aman.

  cd /app/backend && python seed.py

Akun demo (PIN di-hash scrypt di database):
  admin / 1234       -> admin, semua cabang, lihat modal + laba kotor
  kasirbalaraja / 1111 -> kasir Balaraja
  kasirciledug / 2222 -> kasir Ciledug
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from lib.auth import hash_pin
from lib.db import db, ensure_indexes

IMG = [
    "https://images.unsplash.com/photo-1689830570678-956587526e75?crop=entropy&cs=srgb&fm=jpg&w=400&q=70",
    "https://images.unsplash.com/photo-1678266622924-c7c38ddc25e1?crop=entropy&cs=srgb&fm=jpg&w=400&q=70",
    "https://images.pexels.com/photos/34279970/pexels-photo-34279970.jpeg?auto=compress&cs=tinysrgb&w=400",
    "https://images.unsplash.com/photo-1633464130613-0a9154299ac2?crop=entropy&cs=srgb&fm=jpg&w=400&q=70",
]

BRANCHES = [
    {"code": "BLR", "name": "Balaraja", "address": "", "phone": ""},
    {"code": "CLD", "name": "Ciledug", "address": "", "phone": ""},
]

ARTICLES = [
    {"code": "LS-001", "name": "Lodi Runner Hitam", "brand": "Lodi", "category": "Sneakers", "cost_price": 185000, "price": 299000, "img": 0, "barcode": "8998111000017"},
    {"code": "LS-002", "name": "Lodi Court Putih", "brand": "Lodi", "category": "Sneakers", "cost_price": 210000, "price": 349000, "img": 1, "barcode": "8998111000024"},
    {"code": "LS-003", "name": "Lodi Formal Kulit", "brand": "Lodi", "category": "Formal", "cost_price": 265000, "price": 459000, "img": 2, "barcode": "8998111000031"},
    {"code": "LS-004", "name": "Lodi Sport Biru", "brand": "Lodi", "category": "Olahraga", "cost_price": 160000, "price": 259000, "img": 3, "barcode": "8998111000048"},
    {"code": "LS-005", "name": "Lodi Slip-On Abu", "brand": "Lodi", "category": "Casual", "cost_price": 120000, "price": 199000, "img": 0, "barcode": "8998111000055"},
    {"code": "LS-006", "name": "Lodi Boots Coklat", "brand": "Lodi", "category": "Boots", "cost_price": 320000, "price": 549000, "img": 2, "barcode": "8998111000062"},
]

SIZES = ["38", "39", "40", "41", "42", "43"]


async def upsert_branches() -> dict[str, dict]:
    out = {}
    for b in BRANCHES:
        doc = await db.branches.find_one({"code": b["code"]})
        if not doc:
            doc = {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc), **b}
            await db.branches.insert_one(dict(doc))
            print(f"+ cabang {b['name']}")
        else:
            await db.branches.update_one({"code": b["code"]}, {"$set": {"address": b["address"], "phone": b["phone"]}})
        out[b["code"]] = await db.branches.find_one({"code": b["code"]})
    return out


async def upsert_users(branches: dict[str, dict]) -> None:
    accounts = [
        {"username": "admin", "name": "Pemilik Toko", "role": "admin", "pin": "1234", "branch_id": None},
        {"username": "kasirbalaraja", "name": "Kasir Balaraja", "role": "kasir", "pin": "1111", "branch_id": branches["BLR"]["id"]},
        {"username": "kasirciledug", "name": "Kasir Ciledug", "role": "kasir", "pin": "2222", "branch_id": branches["CLD"]["id"]},
    ]
    for a in accounts:
        existing = await db.users.find_one({"username": a["username"]})
        payload = {
            "username": a["username"],
            "name": a["name"],
            "role": a["role"],
            "branch_id": a["branch_id"],
            "pin_hash": hash_pin(a["pin"]),
        }
        if existing:
            await db.users.update_one({"username": a["username"]}, {"$set": payload})
        else:
            await db.users.insert_one({"id": str(uuid.uuid4()), **payload})
            print(f"+ user {a['username']} (PIN {a['pin']})")


async def upsert_articles() -> dict[str, dict]:
    out = {}
    for a in ARTICLES:
        doc = await db.articles.find_one({"code": a["code"]})
        payload = {
            "code": a["code"],
            "name": a["name"],
            "brand": a["brand"],
            "category": a["category"],
            "barcode": a["barcode"],
            "cost_price": a["cost_price"],
            "image_url": IMG[a["img"]],
            "is_active": True,
        }
        if doc:
            await db.articles.update_one({"code": a["code"]}, {"$set": payload})
        else:
            await db.articles.insert_one(
                {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc), **payload}
            )
            print(f"+ artikel {a['name']}")
        out[a["code"]] = await db.articles.find_one({"code": a["code"]})
    return out


async def upsert_stock(branches: dict[str, dict], articles: dict[str, dict]) -> None:
    """Stok per cabang. Beberapa ukuran sengaja 0 supaya tombol 'habis' terlihat nonaktif di POS."""
    plan = {
        "BLR": {"LS-001": [4, 6, 8, 5, 0, 2], "LS-002": [3, 5, 7, 4, 3, 0], "LS-003": [2, 3, 4, 3, 2, 1],
                "LS-004": [0, 4, 6, 5, 2, 1], "LS-005": [5, 6, 3, 2, 0, 0], "LS-006": [1, 2, 3, 2, 1, 0]},
        "CLD": {"LS-001": [2, 3, 5, 4, 1, 0], "LS-002": [1, 4, 6, 3, 2, 1], "LS-003": [0, 2, 3, 2, 1, 0],
                "LS-004": [3, 3, 4, 2, 0, 1], "LS-005": [2, 4, 5, 1, 1, 0], "LS-006": [0, 1, 2, 2, 1, 1]},
    }
    price = {a["code"]: a["price"] for a in ARTICLES}
    for bcode, per_article in plan.items():
        branch = branches[bcode]
        for acode, qtys in per_article.items():
            art = articles[acode]
            for size, qty in zip(SIZES, qtys):
                await db.stock_items.update_one(
                    {"branch_id": branch["id"], "article_id": art["id"], "size": size},
                    {
                        "$set": {
                            "qty": qty,
                            "selling_price": price[acode],
                            "article_code": art["code"],
                            "article_name": art["name"],
                            "updated_at": datetime.now(timezone.utc),
                        },
                        "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc)},
                    },
                    upsert=True,
                )
    print("+ stok per cabang siap (beberapa ukuran 0 = habis)")


async def seed_history(branches: dict[str, dict], articles: dict[str, dict]) -> None:
    """Transaksi contoh kemarin (3 pasang) supaya Tukar berbasis qty bisa langsung diuji."""
    if await db.transactions.count_documents({}):
        return
    branch = branches["BLR"]
    art = articles["LS-001"]
    when = datetime.now(timezone.utc) - timedelta(days=1)
    stock = await db.stock_items.find_one({"branch_id": branch["id"], "article_id": art["id"], "size": "40"})
    price = int(stock["selling_price"])
    qty = 3
    total = price * qty
    paid = 900000
    item = {
        "id": str(uuid.uuid4()),
        "article_id": art["id"],
        "article_code": art["code"],
        "article_name": art["name"],
        "size": "40",
        "qty": qty,
        "price": price,
        "cost": int(art["cost_price"]),
        "line_revenue": price * qty,
        "discount_alloc": 0,
        "line_cost": int(art["cost_price"]) * qty,
        "exchanged_qty": 0,
        "from_exchange": False,
    }
    tx = {
        "id": str(uuid.uuid4()),
        "receipt_no": f"TRX-{when:%Y%m%d}-BLR-001",
        "branch_id": branch["id"],
        "branch_name": branch["name"],
        "type": "SALE",
        "cashier_id": "seed",
        "cashier_name": "Kasir Balaraja",
        "items": [item],
        "subtotal": total,
        "discount": 0,
        "total": total,
        "payment_method": "TUNAI",
        "paid": paid,
        "change": paid - total,
        "customer_phone": "",
        "note": "",
        "wa_sent": False,
        "wa_status": None,
        "created_at": when,
    }
    await db.transactions.insert_one(tx)
    await db.counters.update_one({"_id": f"TRX:BLR:{when:%Y%m%d}"}, {"$set": {"seq": 1}}, upsert=True)
    print("+ 1 transaksi contoh (kemarin) untuk uji Tukar Ukuran")


async def main() -> None:
    await ensure_indexes()
    branches = await upsert_branches()
    await upsert_users(branches)
    articles = await upsert_articles()
    await upsert_stock(branches, articles)
    await seed_history(branches, articles)
    print("\nSeed selesai. Login: admin/1234 - kasirbalaraja/1111 - kasirciledug/2222")


if __name__ == "__main__":
    asyncio.run(main())
