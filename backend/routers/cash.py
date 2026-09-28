"""Kas drawer & pengeluaran. Expected cash dihitung server-side:
modal awal + kas masuk − kas keluar + penjualan TUNAI + selisih tukar tunai."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from lib.auth import get_current_user, naive_to_aware, now_utc, read_branch, require_branch
from lib.db import clean_doc, db
from lib.dates import range_bounds_utc

router = APIRouter()


class MovementOut(BaseModel):
    id: str
    type: str
    amount: int
    note: str
    created_by_name: str
    created_at: object


class CashSessionOut(BaseModel):
    id: str
    branch_id: str
    branch_name: str
    status: str
    opening_cash: int
    opened_by_name: str
    opened_at: object
    closed_at: object | None = None
    counted_cash: int | None = None
    difference: int | None = None
    closed_by_name: str | None = None
    movements: list[MovementOut] = []
    cash_sales: int = 0
    movement_in: int = 0
    movement_out: int = 0
    expected_cash: int = 0


class OpenIn(BaseModel):
    branch_id: str = ""
    opening_cash: int = Field(ge=0)


class MoveIn(BaseModel):
    branch_id: str = ""
    type: str = Field(pattern="^(IN|OUT)$")
    amount: int = Field(gt=0)
    note: str = Field(default="", max_length=120)


class CloseIn(BaseModel):
    branch_id: str = ""
    counted_cash: int = Field(ge=0)


class ExpenseIn(BaseModel):
    branch_id: str = ""
    category: str = Field(pattern="^(RESTOK|OPERASIONAL|GAJI|LAINNYA)$")
    amount: int = Field(gt=0)
    note: str = Field(default="", max_length=160)


class ExpenseOut(BaseModel):
    id: str
    branch_id: str
    branch_name: str
    category: str
    amount: int
    note: str = ""
    created_by_name: str
    created_at: object


async def _active_session(branch_id: str) -> dict | None:
    return await db.cash_sessions.find_one({"branch_id": branch_id, "status": "OPEN"})


async def _summary(session: dict, until: object | None = None) -> dict:
    branch_id = session["branch_id"]
    start = naive_to_aware(session["opened_at"])
    end = until if until is not None else now_utc()
    rows = await db.transactions.aggregate(
        [
            {
                "$match": {
                    "branch_id": branch_id,
                    "payment_method": "TUNAI",
                    "created_at": {"$gte": start, "$lt": end},
                }
            },
            {"$group": {"_id": None, "total": {"$sum": "$total"}}},
        ]
    ).to_list(1)
    cash_sales = int(rows[0]["total"]) if rows else 0  # TUKAR contributes signed diff — exact net cash
    movements = await db.cash_movements.find({"session_id": session["id"]}).sort("created_at", 1).to_list(500)
    m_in = sum(int(m["amount"]) for m in movements if m["type"] == "IN")
    m_out = sum(int(m["amount"]) for m in movements if m["type"] == "OUT")
    return {
        "movements": [MovementOut(**clean_doc(m)) for m in movements],
        "cash_sales": cash_sales,
        "movement_in": m_in,
        "movement_out": m_out,
        "expected_cash": int(session["opening_cash"]) + m_in - m_out + cash_sales,
    }


@router.get("/cash/active")
async def active_cash(branch_id: str = "", user: dict = Depends(get_current_user)):
    b = require_branch(user, branch_id)
    session = await _active_session(b)
    if not session:
        return {"session": None}
    summary = await _summary(session)
    return {"session": CashSessionOut(**clean_doc(session) | summary)}


@router.post("/cash/open", response_model=CashSessionOut, status_code=201)
async def open_cash(input: OpenIn, user: dict = Depends(get_current_user)):
    b = require_branch(user, input.branch_id)
    if await _active_session(b):
        raise HTTPException(status_code=409, detail="Masih ada sesi kas yang terbuka")
    branch = await db.branches.find_one({"id": b})
    doc = {
        "id": str(uuid.uuid4()),
        "branch_id": b,
        "branch_name": branch["name"] if branch else b,
        "status": "OPEN",
        "opening_cash": int(input.opening_cash),
        "opened_by_name": user["name"],
        "opened_at": now_utc(),
        "closed_at": None,
        "counted_cash": None,
        "difference": None,
        "closed_by_name": None,
    }
    await db.cash_sessions.insert_one(dict(doc))
    return CashSessionOut(**clean_doc(doc) | await _summary(doc))


@router.post("/cash/movements", response_model=CashSessionOut)
async def add_movement(input: MoveIn, user: dict = Depends(get_current_user)):
    b = require_branch(user, input.branch_id)
    session = await _active_session(b)
    if not session:
        raise HTTPException(status_code=409, detail="Buka kas dulu")
    doc = {
        "id": str(uuid.uuid4()),
        "session_id": session["id"],
        "type": input.type,
        "amount": int(input.amount),
        "note": input.note.strip(),
        "created_by_name": user["name"],
        "created_at": now_utc(),
    }
    await db.cash_movements.insert_one(dict(doc))
    return CashSessionOut(**clean_doc(session) | await _summary(session))


@router.post("/cash/close", response_model=CashSessionOut)
async def close_cash(input: CloseIn, user: dict = Depends(get_current_user)):
    b = require_branch(user, input.branch_id)
    session = await _active_session(b)
    if not session:
        raise HTTPException(status_code=409, detail="Tidak ada sesi kas terbuka")
    now = now_utc()
    summary = await _summary(session, until=now)
    counted = int(input.counted_cash)
    update = {
        "status": "CLOSED",
        "closed_at": now,
        "counted_cash": counted,
        "expected_cash": summary["expected_cash"],
        "cash_sales": summary["cash_sales"],
        "difference": counted - summary["expected_cash"],  # positif = lebih, negatif = kurang
        "closed_by_name": user["name"],
    }
    await db.cash_sessions.update_one({"id": session["id"]}, {"$set": update})
    fresh = await db.cash_sessions.find_one({"id": session["id"]})
    return CashSessionOut(**clean_doc(fresh))


@router.get("/cash/sessions", response_model=list[CashSessionOut])
async def list_sessions(branch_id: str = "", limit: int = Query(20, le=100), user: dict = Depends(get_current_user)):
    match: dict = {}
    b = read_branch(user, branch_id)
    if b:
        match["branch_id"] = b
    docs = await db.cash_sessions.find(match).sort("opened_at", -1).limit(limit).to_list(limit)
    return [CashSessionOut(**clean_doc(d)) for d in docs]


@router.get("/expenses", response_model=list[ExpenseOut])
async def list_expenses(
    branch_id: str = "",
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    user: dict = Depends(get_current_user),
):
    match: dict = {}
    b = read_branch(user, branch_id)
    if b:
        match["branch_id"] = b
    if from_date or to_date:
        start, end = range_bounds_utc(from_date, to_date, default_days=30)
        match["created_at"] = {"$gte": start, "$lt": end}
    docs = await db.expenses.find(match).sort("created_at", -1).limit(200).to_list(200)
    return [ExpenseOut(**clean_doc(d)) for d in docs]


@router.post("/expenses", response_model=ExpenseOut, status_code=201)
async def create_expense(input: ExpenseIn, user: dict = Depends(get_current_user)):
    b = require_branch(user, input.branch_id)
    branch = await db.branches.find_one({"id": b})
    doc = {
        "id": str(uuid.uuid4()),
        "branch_id": b,
        "branch_name": branch["name"] if branch else b,
        "category": input.category,
        "amount": int(input.amount),
        "note": input.note.strip(),
        "created_by_name": user["name"],
        "created_at": now_utc(),
    }
    await db.expenses.insert_one(dict(doc))
    return ExpenseOut(**clean_doc(doc))
