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
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
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
