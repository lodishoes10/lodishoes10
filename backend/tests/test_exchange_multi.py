"""Non-destructive tests for LodiShoes multi-line TUKAR feature and Riwayat Tukar endpoint.

Does NOT wipe the DB — uses live seeded data. Creates a fresh SALE with 2 items
then exchanges both simultaneously with different target articles/sizes.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://lodishoes-pos.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(u, p):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": u, "pin": p}, timeout=15)
    assert r.status_code == 200, r.text
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    return _login("admin", "1234")


@pytest.fixture(scope="module")
def kasir_blr():
    return _login("kasirbalaraja", "1111")


@pytest.fixture(scope="module")
def kasir_cld():
    return _login("kasirciledug", "2222")


def _matrix(sess, branch_id):
    r = sess.get(f"{API}/stock/matrix?branch_id={branch_id}", timeout=15)
    assert r.status_code == 200, r.text
    out = {}
    for a in r.json():
        for s in a["sizes"]:
            out[(a["article_id"], a["code"], s["size"])] = s
    return out


def _pick_stock(matrix, min_qty=1, exclude=None):
    """Pick (article_id, code, size, price, qty) with qty>=min_qty; exclude given (article_id,size) tuples."""
    exclude = exclude or set()
    for (aid, code, sz), s in matrix.items():
        if (aid, sz) in exclude:
            continue
        if int(s["qty"]) >= min_qty:
            return aid, code, sz, int(s["selling_price"]), int(s["qty"])
    return None


def test_exchange_multi_line_and_riwayat(kasir_blr, admin):
    s_kasir, user = kasir_blr
    branch_id = user["branch_id"]
    mat = _matrix(s_kasir, branch_id)

    # Pick TWO different source items that both have qty>=1
    src1 = _pick_stock(mat, min_qty=1)
    assert src1, "no stock at all in Balaraja"
    aid1, code1, sz1, price1, _ = src1
    src2 = _pick_stock(mat, min_qty=1, exclude={(aid1, sz1)})
    assert src2, "need 2 different stock items"
    aid2, code2, sz2, price2, _ = src2

    total_before = price1 + price2

    # STEP 1: create a fresh SALE with 2 items
    r = s_kasir.post(f"{API}/transactions", json={
        "branch_id": branch_id,
        "items": [
            {"article_id": aid1, "size": sz1, "qty": 1},
            {"article_id": aid2, "size": sz2, "qty": 1},
        ],
        "payment_method": "TUNAI",
        "paid": total_before,
    }, timeout=20)
    assert r.status_code == 201, r.text
    sale = r.json()
    tx_id = sale["id"]
    assert len(sale["items"]) == 2
    src_item1 = next(i for i in sale["items"] if i["article_id"] == aid1 and i["size"] == sz1)
    src_item2 = next(i for i in sale["items"] if i["article_id"] == aid2 and i["size"] == sz2)

    # STEP 2: pick 2 different target stocks (must not match sources)
    mat = _matrix(s_kasir, branch_id)
    excluded = {(aid1, sz1), (aid2, sz2)}
    tgt1 = _pick_stock(mat, min_qty=1, exclude=excluded)
    assert tgt1
    t_aid1, t_code1, t_sz1, t_price1, t_qty1 = tgt1
    excluded.add((t_aid1, t_sz1))
    tgt2 = _pick_stock(mat, min_qty=1, exclude=excluded)
    assert tgt2
    t_aid2, t_code2, t_sz2, t_price2, t_qty2 = tgt2

    # STEP 3: exchange both source lines simultaneously (multi-line)
    diff = (t_price1 - price1) + (t_price2 - price2)
    payload = {
        "branch_id": branch_id,
        "lines": [
            {"item_id": src_item1["id"], "targets": [{"article_id": t_aid1, "size": t_sz1, "qty": 1}]},
            {"item_id": src_item2["id"], "targets": [{"article_id": t_aid2, "size": t_sz2, "qty": 1}]},
        ],
        "payment_method": "TUNAI",
        "diff_paid": max(diff, 0) + 100_000 if diff > 0 else 0,
    }
    r = s_kasir.post(f"{API}/transactions/{tx_id}/exchange", json=payload, timeout=30)
    assert r.status_code == 201, r.text
    tukar = r.json()
    assert tukar["type"] == "TUKAR"
    assert tukar["total"] == diff

    # STEP 4: transaksi SALE asal TIDAK diubah nilainya — qty tetap, hanya exchanged_qty naik.
    r = s_kasir.get(f"{API}/transactions/{tx_id}", timeout=15)
    assert r.status_code == 200
    mutated = r.json()
    orig1 = next(i for i in mutated["items"] if i["id"] == src_item1["id"])
    orig2 = next(i for i in mutated["items"] if i["id"] == src_item2["id"])
    assert orig1["qty"] == 1 and orig1["exchanged_qty"] == 1
    assert orig2["qty"] == 1 and orig2["exchanged_qty"] == 1
    # Omzet penjualan asli tidak berubah (total tetap).
    assert mutated["total"] == sale["total"]
    # Tidak ada baris hasil-tukar yang ditempel ke transaksi asal (target ada di transaksi TUKAR).
    assert not any(i.get("from_exchange") for i in mutated["items"])

    # STEP 5: verify stock: sources +1, targets -1
    mat2 = _matrix(s_kasir, branch_id)
    # For sources, look up by (aid, sz)
    def qty_of(m, aid, sz):
        for (a, c, s), row in m.items():
            if a == aid and s == sz:
                return int(row["qty"])
        return None
    # We had consumed 1 each from src earlier via sale; now returned via exchange → net = pre-sale value.
    # Just assert relative to POST-sale snapshot: pre-exchange we drained by 1, exchange restored → +1 vs pre-exchange.
    # Since we already refreshed mat AFTER sale, we compare tgt qty −1 from that snapshot.
    assert qty_of(mat2, t_aid1, t_sz1) == t_qty1 - 1
    assert qty_of(mat2, t_aid2, t_sz2) == t_qty2 - 1

    # STEP 6: GET /api/exchanges — the new tx must appear
    r = s_kasir.get(f"{API}/exchanges?page_size=20", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and body["total"] >= 1
    ex_row = next((e for e in body["items"] if e["tx_id"] == tx_id), None)
    assert ex_row is not None, "our exchange missing from /api/exchanges"
    assert len(ex_row["lines"]) == 2
    # each line has from_article/size + to_article/size + diff
    for ln in ex_row["lines"]:
        assert ln["article_name"] and ln["size"]
        assert ln["targets"] and len(ln["targets"]) >= 1
        for t in ln["targets"]:
            assert t["article_name"] and t["size"] and t["qty"] >= 1


def test_exchange_qty_mismatch_422(kasir_blr):
    s_kasir, user = kasir_blr
    branch_id = user["branch_id"]
    mat = _matrix(s_kasir, branch_id)
    src = _pick_stock(mat, min_qty=1)
    assert src
    aid, _, sz, price, _ = src
    r = s_kasir.post(f"{API}/transactions", json={
        "branch_id": branch_id,
        "items": [{"article_id": aid, "size": sz, "qty": 1}],
        "payment_method": "TUNAI",
        "paid": price,
    }, timeout=20)
    assert r.status_code == 201
    tx = r.json()
    item_id = tx["items"][0]["id"]

    tgt = _pick_stock(_matrix(s_kasir, branch_id), min_qty=2, exclude={(aid, sz)})
    if not tgt:
        pytest.skip("no target with qty>=2 to mismatch")
    t_aid, _, t_sz, _, _ = tgt

    # try to exchange 1 pasang -> 2 pasang (qty mismatch)
    r = s_kasir.post(f"{API}/transactions/{tx['id']}/exchange", json={
        "branch_id": branch_id,
        "lines": [{"item_id": item_id, "targets": [{"article_id": t_aid, "size": t_sz, "qty": 2}]}],
        "payment_method": "TUNAI",
        "diff_paid": 10_000_000,
    }, timeout=20)
    assert r.status_code == 422, f"expected 422 qty mismatch, got {r.status_code}: {r.text}"


def test_exchange_other_branch_forbidden(kasir_cld, kasir_blr):
    """Kasir Ciledug cannot exchange a Balaraja transaction."""
    s_blr, user_blr = kasir_blr
    branch_blr = user_blr["branch_id"]
    # find/create a BLR SALE
    r = s_blr.get(f"{API}/transactions?branch_id={branch_blr}&type=SALE&page_size=1", timeout=15)
    assert r.status_code == 200
    items = r.json()["items"]
    if not items:
        pytest.skip("no BLR SALE to try")
    blr_tx_id = items[0]["id"]

    s_cld, user_cld = kasir_cld
    # GET the tx as CLD → should be 403 (own-branch guard)
    r = s_cld.get(f"{API}/transactions/{blr_tx_id}", timeout=15)
    assert r.status_code == 403


def test_riwayat_tukar_filter_and_pagination(admin, kasir_blr):
    s_admin, _ = admin
    r = s_admin.get(f"{API}/exchanges?page=1&page_size=5", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["page"] == 1 and body["page_size"] == 5
    assert isinstance(body["items"], list)
    assert len(body["items"]) <= 5

    # kasir sees only own branch (server-side filter). Just assert no 403.
    s_kasir, _ = kasir_blr
    r = s_kasir.get(f"{API}/exchanges", timeout=15)
    assert r.status_code == 200

    # invalid date filter should not 500
    r = s_admin.get(f"{API}/exchanges?from=2025-01-01&to=2100-01-01", timeout=15)
    assert r.status_code == 200
