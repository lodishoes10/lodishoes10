"""Smoke tests for LodiShoes POS restore.

Covers: health, auth (admin & kasir), articles list, barcode PNG, POS sale (stock decrement),
transfer request by kasir + admin visibility + kasir cannot approve (403).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://lodishoes-pos.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


def _login(username, pin):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": username, "pin": pin}, timeout=15)
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
    return s, r.json()


@pytest.fixture(scope="module")
def admin_session():
    return _login("admin", "1234")


@pytest.fixture(scope="module")
def kasir_balaraja_session():
    return _login("kasirbalaraja", "1111")


@pytest.fixture(scope="module")
def kasir_ciledug_session():
    return _login("kasirciledug", "2222")


# --- Health ---
def test_health_ok():
    r = requests.get(f"{API}/health", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True


# --- Auth ---
def test_login_admin_returns_user(admin_session):
    _, user = admin_session
    assert user.get("role") == "admin"
    assert user.get("username") == "admin"


def test_login_kasir_returns_user(kasir_balaraja_session):
    _, user = kasir_balaraja_session
    assert user.get("role") == "kasir"
    assert user.get("branch_id")


def test_login_wrong_pin_401():
    r = requests.post(f"{API}/auth/login", json={"username": "admin", "pin": "9999"}, timeout=15)
    assert r.status_code == 401


def test_auth_me(admin_session):
    s, _ = admin_session
    r = s.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 200
    assert r.json().get("username") == "admin"


# --- Articles + Barcode PNG ---
def test_list_articles(admin_session):
    s, _ = admin_session
    r = s.get(f"{API}/articles?page=1&page_size=5", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert isinstance(data["items"], list)


def test_barcode_png_content_type(admin_session):
    s, _ = admin_session
    r = s.get(f"{API}/articles?page=1&page_size=1", timeout=15)
    items = r.json().get("items", [])
    if not items:
        pytest.skip("no articles seeded")
    aid = items[0]["id"]
    r2 = s.get(f"{API}/articles/{aid}/barcode.png", timeout=20)
    assert r2.status_code == 200
    assert r2.headers.get("content-type", "").startswith("image/png")
    # PNG signature
    assert r2.content[:8] == b"\x89PNG\r\n\x1a\n"


# --- POS Sale by kasir decrements stock ---
def test_pos_sale_decrements_stock(kasir_balaraja_session):
    s, user = kasir_balaraja_session
    branch_id = user["branch_id"]

    # find a stock item with qty > 0 in this branch via /stock/matrix
    r = s.get(f"{API}/stock/matrix?branch_id={branch_id}", timeout=15)
    assert r.status_code == 200, r.text
    rows = r.json()
    target = None
    for row in rows:
        for sz in row.get("sizes", []):
            if int(sz.get("qty", 0)) > 0:
                target = {"article_id": row["article_id"], "size": sz["size"], "qty": int(sz["qty"]), "selling_price": int(sz["selling_price"])}
                break
        if target:
            break
    if not target:
        pytest.skip("no stock available in branch for sale")

    before = int(target["qty"])
    price = int(target.get("selling_price", 0))

    payload = {
        "branch_id": branch_id,
        "items": [{"article_id": target["article_id"], "size": target["size"], "qty": 1}],
        "discount": 0,
        "payment_method": "TUNAI",
        "paid": price,
        "customer_phone": "",
    }
    r2 = s.post(f"{API}/transactions", json=payload, timeout=20)
    assert r2.status_code == 201, r2.text
    tx = r2.json()
    assert tx["total"] == price
    assert tx["type"] == "SALE"
    assert tx["receipt_no"]

    # verify stock decremented
    r3 = s.get(f"{API}/stock/matrix?branch_id={branch_id}", timeout=15)
    rows3 = r3.json()
    row_match = next((row for row in rows3 if row["article_id"] == target["article_id"]), None)
    assert row_match is not None
    sz_match = next((sz for sz in row_match["sizes"] if sz["size"] == target["size"]), None)
    assert sz_match is not None
    assert int(sz_match["qty"]) == before - 1


# --- Transfer flow: kasir requests, admin sees, kasir cannot approve ---
def test_transfer_kasir_request_admin_sees_kasir_cannot_approve(
    kasir_balaraja_session, kasir_ciledug_session, admin_session
):
    s_kasir, user_kasir = kasir_balaraja_session
    _, user_ciledug = kasir_ciledug_session
    s_admin, _ = admin_session

    from_branch = user_kasir["branch_id"]
    to_branch = user_ciledug["branch_id"]
    assert from_branch != to_branch

    # find a stock in kasir's branch via /stock/matrix
    r = s_kasir.get(f"{API}/stock/matrix?branch_id={from_branch}", timeout=15)
    rows = r.json()
    target = None
    for row in rows:
        for sz in row.get("sizes", []):
            if int(sz.get("qty", 0)) > 0:
                target = {"article_id": row["article_id"], "size": sz["size"]}
                break
        if target:
            break
    if not target:
        pytest.skip("no stock to transfer")

    payload = {
        "from_branch_id": from_branch,
        "to_branch_id": to_branch,
        "items": [{"article_id": target["article_id"], "size": target["size"], "qty": 1}],
        "note": "TEST_transfer_smoke",
    }
    r2 = s_kasir.post(f"{API}/transfers", json=payload, timeout=15)
    assert r2.status_code == 201, r2.text
    transfer = r2.json()
    assert transfer["status"] == "MENUNGGU"
    transfer_id = transfer["id"]

    # admin can see pending count
    r3 = s_admin.get(f"{API}/transfers/pending-count", timeout=15)
    assert r3.status_code == 200
    assert r3.json().get("count", 0) >= 1

    # admin can list transfers and find this one
    r4 = s_admin.get(f"{API}/transfers?limit=50", timeout=15)
    assert r4.status_code == 200
    ids = [t["id"] for t in r4.json()]
    assert transfer_id in ids

    # kasir cannot approve → 403
    r5 = s_kasir.post(f"{API}/transfers/{transfer_id}/approve", timeout=15)
    assert r5.status_code == 403, f"expected 403, got {r5.status_code}: {r5.text}"

    # cleanup: admin rejects to keep DB clean
    r6 = s_admin.post(f"{API}/transfers/{transfer_id}/reject", json={"reason": "test cleanup"}, timeout=15)
    assert r6.status_code == 200
