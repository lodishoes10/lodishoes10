"""Pemeliharaan: reset data demo (admin) + endpoint cron backup harian MongoDB."""

import asyncio
import hmac
import logging
import os
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from lib.auth import require_admin
from lib.db import db

router = APIRouter()
logger = logging.getLogger(__name__)

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/app/backups"))
BACKUP_KEEP_DAYS = 7

# Koleksi data operasional (transaksi & pergerakan stok) vs data master (artikel, cabang, user).
OPERATIONAL = [
    "transactions",
    "exchanges",
    "transfers",
    "opnames",
    "cash_sessions",
    "cash_movements",
    "expenses",
    "counters",
]


class ResetIn(BaseModel):
    # Pengaman: user harus mengetik HAPUS agar tidak terpicu karena salah klik.
    confirm: str = Field(pattern="^HAPUS$")
    # True  = bersih total (artikel & stok ikut dihapus) → siap input stok real
    # False = hanya transaksi dihapus, stok di-nol-kan, artikel tetap
    wipe_master: bool = True


@router.post("/admin/reset-demo")
async def reset_demo(input: ResetIn, user: dict = Depends(require_admin)):
    """Hapus data demo sekali klik sebelum mulai transaksi real. Akun & cabang selalu aman."""
    deleted: dict[str, int] = {}
    for name in OPERATIONAL:
        res = await db[name].delete_many({})
        deleted[name] = res.deleted_count

    if input.wipe_master:
        for name in ("stock_items", "articles"):
            res = await db[name].delete_many({})
            deleted[name] = res.deleted_count
    else:
        res = await db.stock_items.update_many({}, {"$set": {"qty": 0}})
        deleted["stock_items_dinolkan"] = res.modified_count

    logger.info("reset-demo oleh %s: %s", user["username"], deleted)
    return {
        "ok": True,
        "wipe_master": input.wipe_master,
        "deleted": deleted,
        "message": (
            "Semua data demo dihapus. Silakan input artikel & stok real Anda."
            if input.wipe_master
            else "Transaksi demo dihapus dan stok di-nol-kan. Artikel tetap ada."
        ),
    }


def _run_backup(run_id: str) -> None:
    """Dump MongoDB ke arsip harian + buang arsip yang lebih tua dari BACKUP_KEEP_DAYS."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    db_name = os.environ["DB_NAME"]
    out = BACKUP_DIR / f"{db_name}-{stamp}"
    try:
        subprocess.run(
            ["mongodump", "--uri", os.environ["MONGO_URL"], "--db", db_name, "--out", str(out), "--quiet"],
            check=True,
            capture_output=True,
            timeout=600,
        )
        archive = shutil.make_archive(str(out), "gztar", root_dir=str(out))
        shutil.rmtree(out, ignore_errors=True)
        cutoff = datetime.now(timezone.utc) - timedelta(days=BACKUP_KEEP_DAYS)
        for old in BACKUP_DIR.glob(f"{db_name}-*.tar.gz"):
            if datetime.fromtimestamp(old.stat().st_mtime, timezone.utc) < cutoff:
                old.unlink(missing_ok=True)
        logger.info("backup selesai (%s): %s", run_id, archive)
    except Exception as exc:  # backup gagal tidak boleh menjatuhkan aplikasi
        logger.error("backup GAGAL (%s): %s", run_id, exc)


@router.post("/cron/backup-mongo")
async def cron_backup_mongo(
    request: Request,
    authorization: str | None = Header(default=None),
    x_webhook_id: str | None = Header(default=None),
):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not secret:
        raise HTTPException(status_code=500, detail="WEBHOOK_CRON_SECRET belum diset")
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token, secret):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        envelope = await request.json()
    except Exception:
        envelope = {}
    if not isinstance(envelope, dict):
        raise HTTPException(status_code=400, detail="Body tidak valid")

    run_id = x_webhook_id or envelope.get("run_id") or datetime.now(timezone.utc).isoformat()
    # Idempoten: run_id yang sama tidak menjalankan backup dua kali.
    existing = await db.cron_runs.find_one({"run_id": run_id})
    if existing:
        return {"ok": True, "duplicate": True, "run_id": run_id}
    await db.cron_runs.insert_one(
        {"run_id": run_id, "job": "backup-mongo", "started_at": datetime.now(timezone.utc)}
    )
    asyncio.get_running_loop().run_in_executor(None, _run_backup, run_id)
    return {"ok": True, "queued": True, "run_id": run_id}


@router.get("/admin/backups")
async def list_backups(user: dict = Depends(require_admin)):
    """Daftar arsip backup yang tersimpan (untuk ditampilkan di halaman Pengaturan)."""
    if not BACKUP_DIR.exists():
        return {"dir": str(BACKUP_DIR), "keep_days": BACKUP_KEEP_DAYS, "items": []}
    items = []
    for f in sorted(BACKUP_DIR.glob("*.tar.gz"), key=lambda p: p.stat().st_mtime, reverse=True):
        st = f.stat()
        items.append(
            {
                "name": f.name,
                "size_kb": round(st.st_size / 1024, 1),
                "created_at": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
            }
        )
    return {"dir": str(BACKUP_DIR), "keep_days": BACKUP_KEEP_DAYS, "items": items[:30]}
