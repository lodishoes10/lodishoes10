import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, db, ensure_indexes  # noqa: E402
from routers import (  # noqa: E402
    admin,
    articles,
    auth,
    branches,
    cash,
    opnames,
    reports,
    stock,
    transactions,
    transfers,
    users,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def boot():
        await ensure_indexes()
        # Deploy pertama kali (mis. Railway + Atlas baru): database kosong → isi data awal
        # (cabang, akun admin/kasir, artikel contoh). Idempoten, hanya jalan bila users kosong.
        if await db.users.count_documents({}) == 0:
            try:
                from seed import main as seed_main
                await seed_main()
                logger.info("Database kosong — seed awal dijalankan otomatis (admin/1234)")
            except Exception as exc:
                logger.error("Auto-seed gagal: %s", exc)

    app.state.index_task = asyncio.create_task(boot())  # background: a big index build must not block boot
    yield
    client.close()


# Keamanan: /openapi.json, /docs, /redoc dimatikan — skema API tidak bocor ke publik.
app = FastAPI(lifespan=lifespan, openapi_url=None, docs_url=None, redoc_url=None)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "LodiShoes POS API", "ok": True}


@api_router.get("/health")
async def health():
    """Keep-alive ping — dipanggil frontend berkala supaya backend tidak cold start."""
    return {"ok": True, "time": datetime.now().isoformat()}


api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(branches.router, tags=["branches"])
api_router.include_router(users.router, tags=["users"])
api_router.include_router(articles.router, tags=["articles"])
api_router.include_router(stock.router, tags=["stock"])
api_router.include_router(transactions.router, tags=["transactions"])
api_router.include_router(transfers.router, tags=["transfers"])
api_router.include_router(opnames.router, tags=["opnames"])
api_router.include_router(cash.router, tags=["cash"])
api_router.include_router(reports.router, tags=["reports"])
api_router.include_router(admin.router, tags=["admin"])

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Include the router in the main app — must stay the LAST statement.
app.include_router(api_router)

# --- Produksi satu-service (Railway/Render): sajikan build frontend (Vite dist) ---
# Semua path non-/api mengembalikan index.html (SPA client-side routing). Di preview
# Emergent folder dist tidak ada, jadi blok ini tidak aktif dan Vite dev server tetap jalan.
FRONTEND_DIST = ROOT_DIR.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    from starlette.exceptions import HTTPException as _StarletteHTTPException
    from starlette.responses import FileResponse
    from starlette.staticfiles import StaticFiles

    class SPAStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope):  # fallback ke index.html utk rute SPA
            try:
                return await super().get_response(path, scope)
            except _StarletteHTTPException as exc:
                if exc.status_code == 404:
                    return FileResponse(FRONTEND_DIST / "index.html")
                raise

    app.mount("/", SPAStaticFiles(directory=str(FRONTEND_DIST), html=True), name="spa")
    logger.info("Menyajikan frontend build dari %s", FRONTEND_DIST)
