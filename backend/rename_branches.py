"""Ganti nama & kode cabang: Cabang Pusat -> Balaraja (BLR), Cabang Timur -> Ciledug (CLD).

Nama cabang tersimpan juga di dokumen transaksi/transfer/opname/kas (denormalisasi untuk
kecepatan), jadi semuanya disinkronkan agar struk lama pun ikut menampilkan nama baru.

  cd /app/backend && python rename_branches.py
"""

import asyncio

from lib.db import db

RENAME = [
    {"from_code": "PST", "to_code": "BLR", "name": "Balaraja"},
    {"from_code": "TMR", "to_code": "CLD", "name": "Ciledug"},
]


async def main() -> None:
    for r in RENAME:
        branch = await db.branches.find_one({"code": r["from_code"]}) or await db.branches.find_one(
            {"code": r["to_code"]}
        )
        if not branch:
            print(f"- cabang {r['from_code']} tidak ditemukan, dilewati")
            continue
        await db.branches.update_one(
            {"id": branch["id"]},
            # Alamat & telepon dikosongkan: keduanya tidak dicetak di struk lagi.
            {"$set": {"code": r["to_code"], "name": r["name"], "address": "", "phone": ""}},
        )
        for coll, field in (
            ("transactions", "branch_name"),
            ("transfers", "from_branch_name"),
            ("transfers", "to_branch_name"),
            ("opnames", "branch_name"),
            ("cash_sessions", "branch_name"),
            ("expenses", "branch_name"),
            ("exchanges", "branch_name"),
        ):
            key = "from_branch_id" if field == "from_branch_name" else (
                "to_branch_id" if field == "to_branch_name" else "branch_id"
            )
            res = await db[coll].update_many({key: branch["id"]}, {"$set": {field: r["name"]}})
            if res.modified_count:
                print(f"  {coll}.{field}: {res.modified_count} dokumen disinkronkan")
        print(f"+ {r['from_code']} -> {r['to_code']} ({r['name']})")

    print("\nSelesai. Cabang sekarang:")
    async for b in db.branches.find().sort("name", 1):
        print(f"  {b['code']} — {b['name']}")


if __name__ == "__main__":
    asyncio.run(main())
