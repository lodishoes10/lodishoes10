"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel, ReturnDocument

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "users": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("username", ASCENDING)], name="username", unique=True),
    ],
    "sessions": [
        IndexModel([("token", ASCENDING)], name="token", unique=True),
        IndexModel([("expires_at", ASCENDING)], name="expires_at"),
    ],
    "branches": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "articles": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("code", ASCENDING)], name="code", unique=True),
        IndexModel([("name", ASCENDING)], name="name"),
        # Barcode unik tapi opsional: partial index agar banyak artikel tanpa barcode tetap boleh.
        IndexModel(
            [("barcode", ASCENDING)],
            name="barcode_unik",
            unique=True,
            partialFilterExpression={"barcode": {"$type": "string", "$gt": ""}},
        ),
    ],
    "cron_runs": [
        IndexModel([("run_id", ASCENDING)], name="run_id", unique=True),
        IndexModel([("started_at", ASCENDING)], name="started_at_ttl", expireAfterSeconds=60 * 60 * 24 * 30),
    ],
    # Anti-dobel: ukuran 39 untuk artikel yang sama di cabang yang sama = SATU dokumen (qty naik), bukan duplikat.
    "stock_items": [
        IndexModel(
            [("branch_id", ASCENDING), ("article_id", ASCENDING), ("size", ASCENDING)],
            name="branch_article_size",
            unique=True,
        ),
        IndexModel([("branch_id", ASCENDING), ("qty", ASCENDING)], name="branch_qty"),
    ],
    "transactions": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("receipt_no", ASCENDING)], name="receipt_no", unique=True),
        IndexModel([("branch_id", ASCENDING), ("created_at", DESCENDING)], name="branch_created"),
        IndexModel([("type", ASCENDING), ("created_at", DESCENDING)], name="type_created"),
    ],
    # Tukar bertahap: satu item boleh ditukar berkali-kali selama sisa qty masih ada
    # (batas di-cek di endpoint, bukan lewat index unik).
    "exchanges": [
        IndexModel([("tx_id", ASCENDING)], name="tx_id"),
        IndexModel([("created_at", DESCENDING)], name="created_desc"),
    ],
    "transfers": [IndexModel([("created_at", DESCENDING)], name="created_desc")],
    "opnames": [IndexModel([("created_at", DESCENDING)], name="created_desc")],
    "cash_sessions": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("branch_id", ASCENDING), ("status", ASCENDING)], name="branch_status"),
    ],
    "cash_movements": [IndexModel([("session_id", ASCENDING)], name="session")],
    "expenses": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("branch_id", ASCENDING), ("created_at", DESCENDING)], name="branch_created"),
    ],
    "counters": [],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)


def clean_doc(doc: dict) -> dict:
    """Strip Mongo _id and make naive BSON datetimes aware UTC (Pydantic serialises the offset)."""
    out = dict(doc)
    out.pop("_id", None)
    for k, v in out.items():
        if isinstance(v, datetime) and v.tzinfo is None:
            out[k] = v.replace(tzinfo=timezone.utc)
    return out


async def next_seq(key: str) -> int:
    """Atomic, race-safe sequence for receipt numbers (per branch per day)."""
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return int(doc["seq"])
