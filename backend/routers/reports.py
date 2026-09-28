"""Laporan — semua dihitung server-side (aggregation + index). Laba kotor hanya admin."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from lib.auth import get_current_user, require_admin, read_branch
from lib.db import db
from lib.dates import app_zone, range_bounds_utc

router = APIRouter()


class DashboardToday(BaseModel):
    count: int
    revenue: int
    items: int
    profit: int | None = None  # None untuk kasir


class TrendPoint(BaseModel):
    date: str
    total: int
    count: int


class BestSeller(BaseModel):
    article_id: str
    article_name: str
    qty: int
    revenue: int


class LowStockItem(BaseModel):
    id: str
    article_name: str
    article_code: str
    size: str
    qty: int
    selling_price: int


class DashboardOut(BaseModel):
    today: DashboardToday
    trend: list[TrendPoint]
    best_sellers: list[BestSeller]
    low_stock: list[LowStockItem]
    out_of_stock: int


class ProfitRow(BaseModel):
    key: str
    label: str
    sublabel: str = ""
    qty: int
    revenue: int
    discount: int
    cost: int
    profit: int
    expense: int = 0  # pengeluaran (hanya terisi saat group_by=branch)
    net_profit: int = 0  # laba bersih = laba kotor − pengeluaran


class ProfitOut(BaseModel):
    rows: list[ProfitRow]
    totals: ProfitRow
    expense_included: bool = False


@router.get("/reports/dashboard", response_model=DashboardOut)
async def dashboard(branch_id: str = "", user: dict = Depends(get_current_user)):
    b = read_branch(user, branch_id)
    zone = app_zone()
    now_local = datetime.now(zone)
    today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

    base_match: dict = {"type": "SALE"}  # penjualan murni
    if b:
        base_match["branch_id"] = b
    today_match = base_match | {"created_at": {"$gte": today_start}}
    tukar_today_match: dict = {"type": "TUKAR", "created_at": {"$gte": today_start}}
    if b:
        tukar_today_match["branch_id"] = b

    tx_agg = await db.transactions.aggregate(
        [
            {"$match": today_match},
            {"$group": {"_id": None, "count": {"$sum": 1}, "revenue": {"$sum": "$total"}, "discount": {"$sum": "$discount"}}},
        ]
    ).to_list(1)
    item_agg = await db.transactions.aggregate(
        [
            {"$match": today_match},
            {"$unwind": "$items"},
            {"$group": {"_id": None, "items": {"$sum": "$items.qty"}, "cost": {"$sum": "$items.line_cost"}}},
        ]
    ).to_list(1)
    # Selisih tukar hari ini: revenue += Σtotal (selisih harga jual), cost += Σcost_diff (selisih modal).
    tukar_agg = await db.transactions.aggregate(
        [
            {"$match": tukar_today_match},
            {"$group": {"_id": None, "diff_rev": {"$sum": "$total"}, "diff_cost": {"$sum": "$cost_diff"}}},
        ]
    ).to_list(1)

    count = int(tx_agg[0]["count"]) if tx_agg else 0
    discount = int(tx_agg[0]["discount"]) if tx_agg else 0
    items_sold = int(item_agg[0]["items"]) if item_agg else 0
    diff_rev = int(tukar_agg[0]["diff_rev"]) if tukar_agg else 0
    diff_cost = int(tukar_agg[0]["diff_cost"]) if tukar_agg else 0
    revenue = (int(tx_agg[0]["revenue"]) if tx_agg else 0) + diff_rev  # omzet penjualan + selisih tukar
    cost = (int(item_agg[0]["cost"]) if item_agg else 0) + diff_cost
    is_admin = user.get("role") == "admin"

    # 7-day trend (including today). Total omzet per hari = penjualan + selisih tukar hari itu;
    # count hanya menghitung penjualan (SALE) agar jumlah transaksi tidak dobel.
    start7 = today_start - timedelta(days=6)
    both_match: dict = {"type": {"$in": ["SALE", "TUKAR"]}}
    if b:
        both_match["branch_id"] = b
    trend_rows = await db.transactions.aggregate(
        [
            {"$match": both_match | {"created_at": {"$gte": start7}}},
            {
                "$group": {
                    "_id": {"$dateToString": {"date": "$created_at", "format": "%Y-%m-%d", "timezone": str(zone)}},
                    "total": {"$sum": "$total"},
                    "count": {"$sum": {"$cond": [{"$eq": ["$type", "SALE"]}, 1, 0]}},
                }
            },
        ]
    ).to_list(50)
    by_day = {r["_id"]: r for r in trend_rows}
    trend = []
    for i in range(6, -1, -1):
        d = (now_local.date() - timedelta(days=i)).isoformat()
        r = by_day.get(d, {})
        trend.append(TrendPoint(date=d, total=int(r.get("total", 0)), count=int(r.get("count", 0))))

    # Best sellers — last 30 days.
    start30 = today_start - timedelta(days=29)
    best_rows = await db.transactions.aggregate(
        [
            {"$match": base_match | {"created_at": {"$gte": start30}}},
            {"$unwind": "$items"},
            {
                "$group": {
                    "_id": "$items.article_id",
                    "name": {"$first": "$items.article_name"},
                    "qty": {"$sum": "$items.qty"},
                    "revenue": {"$sum": "$items.line_revenue"},
                }
            },
            {"$sort": {"qty": -1, "revenue": -1}},
            {"$limit": 8},
        ]
    ).to_list(8)
    best_sellers = [
        BestSeller(article_id=r["_id"], article_name=r["name"], qty=int(r["qty"]), revenue=int(r["revenue"]))
        for r in best_rows
    ]

    # Low stock — server-side, indexed on (branch_id, qty).
    low_match: dict = {"qty": {"$lte": 5}}
    if b:
        low_match["branch_id"] = b
    low_docs = (
        await db.stock_items.find(low_match).sort("qty", 1).limit(15).to_list(15)
    )
    low_stock = [
        LowStockItem(
            id=d["id"],
            article_name=d.get("article_name", "-"),
            article_code=d.get("article_code", "-"),
            size=d["size"],
            qty=int(d["qty"]),
            selling_price=int(d["selling_price"]),
        )
        for d in low_docs
    ]
    out_match: dict = {"qty": 0}
    if b:
        out_match["branch_id"] = b
    out_of_stock = await db.stock_items.count_documents(out_match)

    return DashboardOut(
        today=DashboardToday(
            count=count,
            revenue=revenue,
            items=items_sold,
            profit=(revenue - discount - cost) if is_admin else None,
        ),
        trend=trend,
        best_sellers=best_sellers,
        low_stock=low_stock,
        out_of_stock=out_of_stock,
    )


@router.get("/reports/gross-profit", response_model=ProfitOut)
async def gross_profit(
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    group_by: str = Query("branch", pattern="^(branch|article)$"),
    branch_id: str = "",
    user: dict = Depends(require_admin),  # admin only
):
    start, end = range_bounds_utc(from_date, to_date, default_days=30)
    match: dict = {"type": "SALE", "created_at": {"$gte": start, "$lt": end}}
    b = read_branch(user, branch_id)
    if b:
        match["branch_id"] = b

    if group_by == "branch":
        gid = "$branch_id"
        label_expr, sublabel_expr = "$branch_name", "$branch_id"
    else:
        gid = "$items.article_id"
        label_expr, sublabel_expr = "$items.article_name", "$items.article_code"

    rows = await db.transactions.aggregate(
        [
            {"$match": match},
            {"$unwind": "$items"},
            {
                "$group": {
                    "_id": gid,
                    "label": {"$first": label_expr},
                    "sublabel": {"$first": sublabel_expr},
                    "qty": {"$sum": "$items.qty"},
                    "revenue": {"$sum": "$items.line_revenue"},
                    "discount": {"$sum": "$items.discount_alloc"},
                    "cost": {"$sum": "$items.line_cost"},
                }
            },
            {"$sort": {"revenue": -1}},
        ]
    ).to_list(500)

    out_rows = [
        ProfitRow(
            key=str(r["_id"]),
            label=r.get("label") or "-",
            sublabel=str(r.get("sublabel") or ""),
            qty=int(r["qty"]),
            revenue=int(r["revenue"]),
            discount=int(r["discount"]),
            cost=int(r["cost"]),
            # Exact: revenue - discount - cost (discount allocated per-line at sale time).
            profit=int(r["revenue"]) - int(r["discount"]) - int(r["cost"]),
        )
        for r in rows
    ]

    # ---- Selisih TUKAR ikut dihitung (rentang & scope sama) → laba per artikel/cabang akurat ----
    tukar_match: dict = {"type": "TUKAR", "created_at": {"$gte": start, "$lt": end}}
    if b:
        tukar_match["branch_id"] = b
    row_by_key = {r.key: r for r in out_rows}

    def _fold(key: str, label: str, sublabel: str, rev: int, cst: int) -> None:
        existing = row_by_key.get(key)
        if existing:
            existing.revenue += rev
            existing.cost += cst
            existing.profit = existing.revenue - existing.discount - existing.cost
        else:
            nr = ProfitRow(
                key=key, label=label or "-", sublabel=sublabel,
                qty=0, revenue=rev, discount=0, cost=cst, profit=rev - cst,
            )
            out_rows.append(nr)
            row_by_key[key] = nr

    if group_by == "branch":
        t_rows = await db.transactions.aggregate([
            {"$match": tukar_match},
            {"$group": {"_id": "$branch_id", "label": {"$first": "$branch_name"},
                        "revenue": {"$sum": "$total"}, "cost": {"$sum": "$cost_diff"}}},
        ]).to_list(500)
        for tr in t_rows:
            _fold(str(tr["_id"]), tr.get("label") or "-", str(tr["_id"]),
                  int(tr.get("revenue", 0)), int(tr.get("cost", 0)))
    else:
        t_rows = await db.transactions.aggregate([
            {"$match": tukar_match},
            {"$unwind": "$items"},
            {"$group": {"_id": "$items.new_article_id",
                        "label": {"$first": "$items.new_article_name"},
                        "sublabel": {"$first": "$items.new_article_code"},
                        "revenue": {"$sum": "$items.rev_delta"}, "cost": {"$sum": "$items.cost_delta"}}},
        ]).to_list(500)
        for tr in t_rows:
            _fold(str(tr["_id"]), tr.get("label") or "-", str(tr.get("sublabel") or ""),
                  int(tr.get("revenue", 0)), int(tr.get("cost", 0)))

    # Laba bersih = laba kotor − pengeluaran. Pengeluaran hanya bisa dipetakan per CABANG
    # (sebuah pengeluaran tidak melekat pada artikel), jadi kolomnya diisi saat group_by=branch.
    expense_match: dict = {"created_at": {"$gte": start, "$lt": end}}
    if b:
        expense_match["branch_id"] = b
    exp_rows = await db.expenses.aggregate(
        [{"$match": expense_match}, {"$group": {"_id": "$branch_id", "total": {"$sum": "$amount"}}}]
    ).to_list(500)
    exp_by_branch = {str(r["_id"]): int(r["total"]) for r in exp_rows}
    total_expense = sum(exp_by_branch.values())

    if group_by == "branch":
        known = {r.key for r in out_rows}
        for r in out_rows:
            r.expense = exp_by_branch.get(r.key, 0)
            r.net_profit = r.profit - r.expense
        # Cabang yang punya pengeluaran tapi belum ada penjualan tetap harus terlihat (laba negatif).
        for branch_id, amount in exp_by_branch.items():
            if branch_id in known:
                continue
            doc = await db.branches.find_one({"id": branch_id})
            out_rows.append(
                ProfitRow(
                    key=branch_id,
                    label=(doc or {}).get("name") or "-",
                    sublabel=branch_id,
                    qty=0,
                    revenue=0,
                    discount=0,
                    cost=0,
                    profit=0,
                    expense=amount,
                    net_profit=-amount,
                )
            )
        out_rows.sort(key=lambda r: r.revenue, reverse=True)

    total_profit = sum(r.profit for r in out_rows)
    totals = ProfitRow(
        key="TOTAL",
        label="TOTAL",
        qty=sum(r.qty for r in out_rows),
        revenue=sum(r.revenue for r in out_rows),
        discount=sum(r.discount for r in out_rows),
        cost=sum(r.cost for r in out_rows),
        profit=total_profit,
        expense=total_expense,
        net_profit=total_profit - total_expense,
    )
    return ProfitOut(rows=out_rows, totals=totals, expense_included=group_by == "branch")
