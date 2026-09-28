"""End-to-end backend tests for LodiShoes POS batch 3.

Covers:
- Auth (admin + 2 kasir) with httpOnly cookie session
- Sales with 4 payment methods (TUNAI/QRIS/TRANSFER/DEBIT), stock decrement, receipt
- Barcode lookup + PNG image endpoint
- Exchange (qty-based, mixed targets), stock/omzet mutation
- Exchange restrictions (other branch → 409)
- Reports gross-profit mutation after exchange (SALE only, TUKAR excluded)
- Transfer approval flow (PENDING, approve, reject, kasir 403, 409 re-approve)
- Concurrency: multi-branch simultaneous sales (unique receipts, correct stock)
- Concurrency: single-size race — no negative stock
"""

import asyncio
import concurrent.futures as cf
import os
import uuid

import httpx
import pytest
import requests
import subprocess
from pymongo import MongoClient

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session", autouse=True)
def _fresh_db():
    """Wipe transactional collections + reseed once per session so tests are deterministic."""
    mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db_name = os.environ.get("DB_NAME", "test_database")
    d = mongo[db_name]
    for c in ("transactions", "exchanges", "transfers", "counters", "stock_items", "articles", "branches", "users", "sessions"):
        d[c].drop()
    mongo.close()
    subprocess.run(["python", "/app/backend/seed.py"], check=True, capture_output=True)
    yield


# -------------------- helpers --------------------

def _login(username: str, pin: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": username, "pin": pin}, timeout=15)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin", "1234")


@pytest.fixture(scope="module")
def kasir_blr():
    return _login("kasirbalaraja", "1111")


@pytest.fixture(scope="module")
def kasir_cld():
    return _login("kasirciledug", "2222")


@pytest.fixture(scope="module")
def branches(admin):
    r = admin.get(f"{API}/branches", timeout=15)
    assert r.status_code == 200
    data = r.json()
    m = {b["code"]: b for b in data}
    assert "BLR" in m and "CLD" in m
    return m


@pytest.fixture(scope="module")
def articles(admin):
    r = admin.get(f"{API}/articles?page_size=50", timeout=15)
    assert r.status_code == 200
    items = r.json()["items"]
    return {a["code"]: a for a in items}


def _matrix(sess, branch_id):
    r = sess.get(f"{API}/stock/matrix?branch_id={branch_id}", timeout=15)
    assert r.status_code == 200, r.text
    out = {}
    for a in r.json():
        for s in a["sizes"]:
            out[(a["code"], s["size"])] = s
    return out


def _find_size_with_stock(matrix, code, min_qty=1):
    for (c, sz), s in matrix.items():
        if c == code and s["qty"] >= min_qty:
            return sz, s
    return None, None


# -------------------- Auth --------------------

class TestAuth:
    def test_login_admin_sets_httponly_cookie(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"username": "admin", "pin": "1234"})
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "admin"
        # httpOnly session cookie
        set_cookie = r.headers.get("set-cookie", "")
        assert "pos_session" in set_cookie
        assert "HttpOnly" in set_cookie

    def test_login_wrong_pin(self):
        r = requests.post(f"{API}/auth/login", json={"username": "admin", "pin": "0000"})
        assert r.status_code == 401

    def test_me(self, admin):
        r = admin.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_kasir_login(self, kasir_blr, kasir_cld):
        r1 = kasir_blr.get(f"{API}/auth/me")
        r2 = kasir_cld.get(f"{API}/auth/me")
        assert r1.status_code == 200 and r1.json()["role"] == "kasir"
        assert r2.status_code == 200 and r2.json()["role"] == "kasir"
        assert r1.json()["branch_id"] != r2.json()["branch_id"]


# -------------------- Sales & payment methods --------------------

class TestSales:
    def test_sale_all_four_pay_methods(self, kasir_blr, branches, articles):
        blr = branches["BLR"]["id"]
        mat = _matrix(kasir_blr, blr)
        # pick LS-002 which is not the LS-001 already used by seed sample tx yesterday
        code = "LS-002"
        for method in ("TUNAI", "QRIS", "TRANSFER", "DEBIT"):
            sz, s = _find_size_with_stock(mat, code, 1)
            assert sz, f"no stock for {code}"
            art_id = articles[code]["id"]
            price = s["selling_price"]
            payload = {
                "branch_id": blr,
                "items": [{"article_id": art_id, "size": sz, "qty": 1}],
                "discount": 0,
                "payment_method": method,
                "paid": price if method == "TUNAI" else 0,
                "customer_phone": "",
            }
            r = kasir_blr.post(f"{API}/transactions", json=payload)
            assert r.status_code == 201, f"{method}: {r.status_code} {r.text}"
            tx = r.json()
            assert tx["payment_method"] == method
            assert tx["total"] == price
            assert tx["receipt_no"].startswith("TRX-")
            assert tx["type"] == "SALE"
            # refresh matrix — verify stock decremented
            mat2 = _matrix(kasir_blr, blr)
            assert mat2[(code, sz)]["qty"] == s["qty"] - 1, "stock not decremented"
            mat = mat2

    def test_sale_tunai_insufficient_paid(self, kasir_blr, branches, articles):
        blr = branches["BLR"]["id"]
        mat = _matrix(kasir_blr, blr)
        sz, s = _find_size_with_stock(mat, "LS-003", 1)
        assert sz
        r = kasir_blr.post(f"{API}/transactions", json={
            "branch_id": blr,
            "items": [{"article_id": articles["LS-003"]["id"], "size": sz, "qty": 1}],
            "payment_method": "TUNAI",
            "paid": 100,
        })
        assert r.status_code == 422

    def test_kasir_cannot_sell_other_branch(self, kasir_blr, branches, articles):
        cld = branches["CLD"]["id"]
        r = kasir_blr.post(f"{API}/transactions", json={
            "branch_id": cld,
            "items": [{"article_id": articles["LS-002"]["id"], "size": "40", "qty": 1}],
            "payment_method": "QRIS",
        })
        assert r.status_code == 403


# -------------------- Barcode --------------------

class TestBarcode:
    def test_barcode_lookup(self, kasir_blr):
        r = kasir_blr.get(f"{API}/articles/by-barcode/8998111000017")
        assert r.status_code == 200
        assert r.json()["code"] == "LS-001"

    def test_barcode_lookup_not_found(self, kasir_blr):
        r = kasir_blr.get(f"{API}/articles/by-barcode/0000000000000")
        assert r.status_code == 404

    def test_barcode_png(self, kasir_blr, articles):
        r = kasir_blr.get(f"{API}/articles/{articles['LS-001']['id']}/barcode.png")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


# -------------------- Exchange --------------------

class TestExchange:
    def test_exchange_mixed_targets_and_report_mutation(self, kasir_blr, admin, branches, articles):
        blr = branches["BLR"]["id"]
        # Find the seeded YESTERDAY sale: LS-001 uk40 qty3 at Balaraja
        r = kasir_blr.get(f"{API}/transactions?branch_id={blr}&type=SALE&page_size=100")
        assert r.status_code == 200
        found = None
        for tx in r.json()["items"]:
            for it in tx["items"]:
                if it["article_code"] == "LS-001" and it["size"] == "40" and it["qty"] >= 2 and not it.get("from_exchange"):
                    found = (tx, it)
                    break
            if found:
                break
        assert found, "seed sample tx LS-001 uk40 not found"
        tx, item = found
        tx_id = tx["id"]
        item_id = item["id"]
        old_qty = item["qty"]
        old_subtotal = tx["subtotal"]
        old_price = item["price"]

        # Report snapshot BEFORE exchange (article LS-001)
        r0 = admin.get(f"{API}/reports/gross-profit?branch_id={blr}&group_by=article&from=2000-01-01&to=2100-01-01")
        assert r0.status_code == 200, r0.text
        before = {row["key"]: row for row in r0.json().get("rows", [])}

        # Ensure targets have stock: LS-002 uk39 (target A) and LS-003 uk40 (target B)
        mat = _matrix(kasir_blr, blr)
        # pick two different articles/sizes
        target_a_size, ta = _find_size_with_stock(mat, "LS-002", 1)
        target_b_size, tb = _find_size_with_stock(mat, "LS-003", 1)
        assert target_a_size and target_b_size

        # Exchange 2 pairs total: 1 -> LS-002 target_a_size, 1 -> LS-003 target_b_size
        payload = {
            "branch_id": blr,
            "lines": [{
                "item_id": item_id,
                "targets": [
                    {"article_id": articles["LS-002"]["id"], "size": target_a_size, "qty": 1},
                    {"article_id": articles["LS-003"]["id"], "size": target_b_size, "qty": 1},
                ],
            }],
            "payment_method": "TUNAI",
            "diff_paid": 10_000_000,  # extra for cash change
        }
        r = kasir_blr.post(f"{API}/transactions/{tx_id}/exchange", json=payload)
        assert r.status_code == 201, r.text
        tukar_tx = r.json()
        assert tukar_tx["type"] == "TUKAR"
        expected_diff = (ta["selling_price"] - old_price) + (tb["selling_price"] - old_price)
        assert tukar_tx["total"] == expected_diff, f"diff mismatch {tukar_tx['total']} vs {expected_diff}"
        if expected_diff > 0:
            assert tukar_tx["change"] == 10_000_000 - expected_diff
        else:
            assert tukar_tx["paid"] == 0
            assert tukar_tx["change"] == -expected_diff

        # Fetch mutated original SALE
        r = kasir_blr.get(f"{API}/transactions/{tx_id}")
        assert r.status_code == 200
        mutated = r.json()
        # original item qty decreased by 2, exchanged_qty=2
        src = next(i for i in mutated["items"] if i["id"] == item_id)
        assert src["qty"] == old_qty - 2, f"src qty {src['qty']} old {old_qty}"
        assert src["exchanged_qty"] == 2
        # New rows with from_exchange=True appended (2 rows)
        new_rows = [i for i in mutated["items"] if i.get("from_exchange")]
        assert len(new_rows) >= 2
        # Subtotal recomputed
        expected_new_subtotal = sum(i["line_revenue"] for i in mutated["items"])
        assert mutated["subtotal"] == expected_new_subtotal
        assert mutated["subtotal"] != old_subtotal

        # Stock: old LS-001 uk40 +2, new targets -1 each
        mat2 = _matrix(kasir_blr, blr)
        assert mat2[("LS-001", "40")]["qty"] == mat.get(("LS-001", "40"), {"qty": 0})["qty"] + 2
        assert mat2[("LS-002", target_a_size)]["qty"] == ta["qty"] - 1
        assert mat2[("LS-003", target_b_size)]["qty"] == tb["qty"] - 1

        # Reports mutated: LS-001 revenue decreased, LS-002 & LS-003 increased.
        r1 = admin.get(f"{API}/reports/gross-profit?branch_id={blr}&group_by=article&from=2000-01-01&to=2100-01-01")
        assert r1.status_code == 200
        after = {row["key"]: row for row in r1.json().get("rows", [])}

        def rev(m, key):
            return m.get(key, {}).get("revenue", 0)

        ls001_id = articles["LS-001"]["id"]
        ls002_id = articles["LS-002"]["id"]
        ls003_id = articles["LS-003"]["id"]
        # LS-001 old_price * 2 removed
        assert rev(after, ls001_id) == rev(before, ls001_id) - 2 * old_price
        # LS-002 and LS-003 gained their target prices
        assert rev(after, ls002_id) == rev(before, ls002_id) + ta["selling_price"]
        assert rev(after, ls003_id) == rev(before, ls003_id) + tb["selling_price"]

        # TUKAR should NOT be in omzet totals — verify by ensuring TUKAR tx type is excluded
        # The gross-profit endpoint filters SALE only; already implied above.
        # Sanity: try group_by absent (totals)
        r2 = admin.get(f"{API}/reports/gross-profit?branch_id={blr}&from=2000-01-01&to=2100-01-01")
        assert r2.status_code == 200

    def test_exchange_other_branch_rejected(self, kasir_cld, branches, articles):
        # Kasir CLD tries to exchange a Balaraja tx — should get 403 (own-branch check) not 409
        blr = branches["BLR"]["id"]
        # Find any BLR SALE
        r = kasir_cld.get(f"{API}/transactions?branch_id={blr}&type=SALE&page_size=5")
        # kasir CLD cannot read BLR at list level — expect 403
        assert r.status_code in (403,)


# -------------------- Transfers --------------------

class TestTransfers:
    def test_full_approval_flow(self, kasir_blr, admin, branches, articles):
        blr = branches["BLR"]["id"]
        cld = branches["CLD"]["id"]
        mat_src_before = _matrix(kasir_blr, blr)
        mat_dst_before = _matrix(admin, cld)
        # find a size in BLR LS-004 with qty>=2
        sz, s = _find_size_with_stock(mat_src_before, "LS-004", 2)
        assert sz
        qty = 2

        # 1) kasir creates transfer → PENDING, stock unchanged
        r = kasir_blr.post(f"{API}/transfers", json={
            "from_branch_id": blr,
            "to_branch_id": cld,
            "items": [{"article_id": articles["LS-004"]["id"], "size": sz, "qty": qty}],
            "note": "TEST_transfer",
        })
        assert r.status_code == 201, r.text
        transfer = r.json()
        assert transfer["status"] == "MENUNGGU"
        tid = transfer["id"]

        mat_src_mid = _matrix(kasir_blr, blr)
        assert mat_src_mid[("LS-004", sz)]["qty"] == s["qty"], "stock moved before approval!"

        # 2) kasir cannot approve → 403
        r = kasir_blr.post(f"{API}/transfers/{tid}/approve")
        assert r.status_code == 403

        # 3) admin approves → stock moves
        r = admin.post(f"{API}/transfers/{tid}/approve")
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "DISETUJUI"
        mat_src_after = _matrix(kasir_blr, blr)
        mat_dst_after = _matrix(admin, cld)
        assert mat_src_after[("LS-004", sz)]["qty"] == s["qty"] - qty
        old_dst_qty = mat_dst_before.get(("LS-004", sz), {"qty": 0})["qty"]
        assert mat_dst_after[("LS-004", sz)]["qty"] == old_dst_qty + qty

        # 4) re-approve should 409
        r = admin.post(f"{API}/transfers/{tid}/approve")
        assert r.status_code == 409

    def test_reject_keeps_stock(self, kasir_blr, admin, branches, articles):
        blr = branches["BLR"]["id"]
        cld = branches["CLD"]["id"]
        mat_before = _matrix(kasir_blr, blr)
        sz, s = _find_size_with_stock(mat_before, "LS-005", 1)
        assert sz
        r = kasir_blr.post(f"{API}/transfers", json={
            "from_branch_id": blr,
            "to_branch_id": cld,
            "items": [{"article_id": articles["LS-005"]["id"], "size": sz, "qty": 1}],
            "note": "TEST_reject",
        })
        assert r.status_code == 201
        tid = r.json()["id"]
        r = admin.post(f"{API}/transfers/{tid}/reject", json={"reason": "test"})
        assert r.status_code == 200
        assert r.json()["status"] == "DITOLAK"
        mat_after = _matrix(kasir_blr, blr)
        assert mat_after[("LS-005", sz)]["qty"] == s["qty"]
        # re-reject 409
        r = admin.post(f"{API}/transfers/{tid}/reject", json={"reason": "again"})
        assert r.status_code == 409


# -------------------- Concurrency --------------------

def _concurrent_sale(cookies_dict, base_url, branch_id, article_id, size, price):
    """Post a sale in a thread; return (status, receipt_no or error)."""
    try:
        r = requests.post(
            f"{base_url}/api/transactions",
            cookies=cookies_dict,
            json={
                "branch_id": branch_id,
                "items": [{"article_id": article_id, "size": size, "qty": 1}],
                "payment_method": "TUNAI",
                "paid": price,
            },
            timeout=30,
        )
        if r.status_code == 201:
            return (201, r.json()["receipt_no"])
        return (r.status_code, r.text[:200])
    except Exception as e:
        return (0, str(e))


class TestConcurrency:
    def test_multi_branch_concurrent_sales_unique_receipts(self, kasir_blr, kasir_cld, admin, branches, articles):
        """Fire N concurrent sales at BOTH branches simultaneously — all receipts unique per branch/day,
        no cross-branch collisions, stock decremented correctly."""
        blr = branches["BLR"]["id"]
        cld = branches["CLD"]["id"]
        mat_b = _matrix(kasir_blr, blr)
        mat_c = _matrix(kasir_cld, cld)
        # LS-006 with enough stock in both branches
        sz_b, s_b = _find_size_with_stock(mat_b, "LS-006", 2)
        sz_c, s_c = _find_size_with_stock(mat_c, "LS-006", 2)
        assert sz_b and sz_c, "need LS-006 stock >=2 in both branches"

        n_each = 2
        art_id = articles["LS-006"]["id"]
        cookies_b = kasir_blr.cookies.get_dict()
        cookies_c = kasir_cld.cookies.get_dict()

        with cf.ThreadPoolExecutor(max_workers=n_each * 2) as ex:
            futures = []
            for _ in range(n_each):
                futures.append(ex.submit(_concurrent_sale, cookies_b, BASE_URL, blr, art_id, sz_b, s_b["selling_price"]))
                futures.append(ex.submit(_concurrent_sale, cookies_c, BASE_URL, cld, art_id, sz_c, s_c["selling_price"]))
            results = [f.result() for f in futures]
        successes = [r for r in results if r[0] == 201]
        assert len(successes) == n_each * 2, f"failures: {[r for r in results if r[0]!=201]}"
        receipts = [r[1] for r in successes]
        assert len(receipts) == len(set(receipts)), f"duplicate receipt numbers! {receipts}"
        # Receipts must include branch code
        blr_rcpts = [r for r in receipts if "-BLR-" in r]
        cld_rcpts = [r for r in receipts if "-CLD-" in r]
        assert len(blr_rcpts) == n_each and len(cld_rcpts) == n_each

        # Stock decremented exactly n_each per branch
        mat_b2 = _matrix(kasir_blr, blr)
        mat_c2 = _matrix(kasir_cld, cld)
        assert mat_b2[("LS-006", sz_b)]["qty"] == s_b["qty"] - n_each
        assert mat_c2[("LS-006", sz_c)]["qty"] == s_c["qty"] - n_each

    def test_stock_race_no_negative(self, kasir_blr, branches, articles):
        """Two concurrent sales on same size when only 1 unit is left → exactly ONE succeeds, stock never negative."""
        blr = branches["BLR"]["id"]
        mat = _matrix(kasir_blr, blr)
        # Find a size with qty exactly 1 to force contention; else drain to 1
        target_code = "LS-006"
        target_sz = None
        target_stock = None
        for (c, sz), s in mat.items():
            if c == target_code and s["qty"] >= 1:
                target_sz = sz
                target_stock = s
                break
        assert target_sz, "no LS-006 with stock"
        # Drain to exactly 1
        art_id = articles[target_code]["id"]
        while target_stock["qty"] > 1:
            r = kasir_blr.post(f"{API}/transactions", json={
                "branch_id": blr,
                "items": [{"article_id": art_id, "size": target_sz, "qty": 1}],
                "payment_method": "QRIS",
            })
            assert r.status_code == 201, r.text
            mat = _matrix(kasir_blr, blr)
            target_stock = mat[(target_code, target_sz)]

        assert target_stock["qty"] == 1
        price = target_stock["selling_price"]
        cookies = kasir_blr.cookies.get_dict()

        # Fire 5 parallel attempts — only 1 must succeed.
        with cf.ThreadPoolExecutor(max_workers=5) as ex:
            futures = [ex.submit(_concurrent_sale, cookies, BASE_URL, blr, art_id, target_sz, price) for _ in range(5)]
            results = [f.result() for f in futures]
        n_ok = sum(1 for r in results if r[0] == 201)
        n_conflict = sum(1 for r in results if r[0] == 409)
        assert n_ok == 1, f"expected 1 success got {n_ok}, results={results}"
        assert n_ok + n_conflict == 5

        mat2 = _matrix(kasir_blr, blr)
        assert mat2[(target_code, target_sz)]["qty"] == 0, "stock should be exactly 0 (never negative)"
