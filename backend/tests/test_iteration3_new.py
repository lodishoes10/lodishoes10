"""Iter3: verifikasi 3 perubahan baru (Opsi-1 omzet tukar, CSV impor produk & stok, cookie secure).

Sesuai catatan agent-to-agent:
- SALE asal TIDAK berubah setelah TUKAR — itu perilaku yang diminta (bukan bug).
- Selisih tukar masuk omzet HARI TUKAR (dashboard + gross-profit range).
- Cookie SESSION harus Secure=True karena COOKIE_SECURE=true di backend/.env.
- Pakai HTTPS preview URL, satu session per user (hindari rate-limit).
"""
import os
import re
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://shoe-pos-setup.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(u, p):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": u, "pin": p}, timeout=20)
    assert r.status_code == 200, r.text
    return s, r.json(), r


@pytest.fixture(scope="module")
def admin():
    s, u, _ = _login("admin", "1234")
    return s, u


@pytest.fixture(scope="module")
def kasir_blr():
    s, u, _ = _login("kasirbalaraja", "1111")
    return s, u


@pytest.fixture(scope="module")
def kasir_cld():
    s, u, _ = _login("kasirciledug", "2222")
    return s, u


# ---------- cookie secure ----------

def test_cookie_session_is_secure():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": "admin", "pin": "1234"}, timeout=20)
    assert r.status_code == 200
    # Verifikasi via header Set-Cookie (requests menyimpan atribut di jar)
    set_cookie = r.headers.get("set-cookie", "")
    # Cookie name is pos_session (backend impl)
    assert "pos_session=" in set_cookie
    # Isolate the pos_session cookie attributes (ignore Cloudflare's __cf_bm)
    pos_part = [p for p in set_cookie.split(",") if "pos_session=" in p][0]
    assert "Secure" in pos_part, f"cookie tidak Secure: {pos_part}"
    assert "HttpOnly" in pos_part, f"cookie tidak HttpOnly: {pos_part}"


# ---------- helpers stok ----------

def _matrix(sess, branch_id):
    r = sess.get(f"{API}/stock/matrix?branch_id={branch_id}", timeout=20)
    assert r.status_code == 200, r.text
    out = {}
    for a in r.json():
        for s in a["sizes"]:
            out[(a["article_id"], a["code"], s["size"])] = s
    return out


def _pick(mat, exclude=None, min_qty=1, price_gt=None, price_lt=None):
    exclude = exclude or set()
    for (aid, code, sz), s in mat.items():
        if (aid, sz) in exclude:
            continue
        if int(s["qty"]) < min_qty:
            continue
        p = int(s["selling_price"])
        if price_gt is not None and p <= price_gt:
            continue
        if price_lt is not None and p >= price_lt:
            continue
        return aid, code, sz, p
    return None


# ---------- Opsi-1 omzet tukar ----------

def test_exchange_option1_sale_unchanged_diff_in_today_revenue(kasir_blr, admin):
    s_kasir, user = kasir_blr
    s_admin, _ = admin
    branch_id = user["branch_id"]

    mat = _matrix(s_kasir, branch_id)
    src = _pick(mat, min_qty=1)
    assert src, "no source stock"
    aid, code, sz, price = src
    # cari target lebih MAHAL supaya diff > 0
    tgt = _pick(mat, exclude={(aid, sz)}, min_qty=1, price_gt=price)
    assert tgt, "no target with higher price"
    t_aid, t_code, t_sz, t_price = tgt
    diff = t_price - price
    assert diff > 0

    # Dashboard sebelum
    r = s_admin.get(f"{API}/reports/dashboard?branch_id={branch_id}", timeout=20)
    assert r.status_code == 200
    rev_before = int(r.json().get("today", {}).get("revenue", 0))

    # SALE
    r = s_kasir.post(f"{API}/transactions", json={
        "branch_id": branch_id,
        "items": [{"article_id": aid, "size": sz, "qty": 1}],
        "payment_method": "TUNAI",
        "paid": price,
    }, timeout=20)
    assert r.status_code == 201, r.text
    sale = r.json()
    tx_id = sale["id"]
    sale_total_before = sale["total"]
    item_id = sale["items"][0]["id"]

    # Dashboard sesudah SALE (revenue naik = price)
    r = s_admin.get(f"{API}/reports/dashboard?branch_id={branch_id}", timeout=20)
    rev_after_sale = int(r.json()["today"]["revenue"])
    assert rev_after_sale == rev_before + price, f"expected {rev_before + price}, got {rev_after_sale}"

    # TUKAR ke target lebih mahal
    r = s_kasir.post(f"{API}/transactions/{tx_id}/exchange", json={
        "branch_id": branch_id,
        "lines": [{"item_id": item_id, "targets": [{"article_id": t_aid, "size": t_sz, "qty": 1}]}],
        "payment_method": "TUNAI",
        "diff_paid": diff + 100_000,
    }, timeout=30)
    assert r.status_code == 201, r.text
    tukar = r.json()
    assert tukar["type"] == "TUKAR"
    assert tukar["total"] == diff, f"TUKAR total harus = diff {diff}, got {tukar['total']}"

    # SALE asal TIDAK berubah
    r = s_kasir.get(f"{API}/transactions/{tx_id}", timeout=15)
    assert r.status_code == 200
    got = r.json()
    assert got["total"] == sale_total_before, "SALE total berubah (harusnya tidak per Opsi-1)"
    orig = next(i for i in got["items"] if i["id"] == item_id)
    assert orig["qty"] == 1 and orig["exchanged_qty"] == 1

    # Dashboard sesudah TUKAR: revenue naik sebesar diff (di atas rev_after_sale)
    r = s_admin.get(f"{API}/reports/dashboard?branch_id={branch_id}", timeout=20)
    rev_after_ex = int(r.json()["today"]["revenue"])
    assert rev_after_ex == rev_after_sale + diff, f"dashboard revenue harus +diff({diff}), got {rev_after_ex - rev_after_sale}"

    # Gross-profit hari ini juga mencakup diff
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    r = s_admin.get(f"{API}/reports/gross-profit?from={today}&to={today}&branch_id={branch_id}", timeout=20)
    assert r.status_code == 200, r.text
    gp = r.json()
    totals_rev = int(gp.get("totals", {}).get("revenue", 0))
    assert totals_rev >= rev_after_ex, f"gross-profit totals.revenue harus mencakup TUKAR, got {totals_rev} vs dashboard {rev_after_ex}"


def test_exchange_option1_cheaper_target_reduces_revenue(kasir_blr, admin):
    s_kasir, user = kasir_blr
    s_admin, _ = admin
    branch_id = user["branch_id"]

    mat = _matrix(s_kasir, branch_id)
    # cari source dgn harga tinggi & target dgn harga lebih rendah → diff negatif
    # cari source paling mahal yg qty>=1
    src = None
    best_price = 0
    for (aid, code, sz), s in mat.items():
        if int(s["qty"]) >= 1 and int(s["selling_price"]) > best_price:
            src = (aid, code, sz, int(s["selling_price"]))
            best_price = int(s["selling_price"])
    assert src
    aid, code, sz, price = src
    tgt = _pick(mat, exclude={(aid, sz)}, min_qty=1, price_lt=price)
    if not tgt:
        pytest.skip("no cheaper target available")
    t_aid, t_code, t_sz, t_price = tgt
    diff = t_price - price
    assert diff < 0

    r = s_admin.get(f"{API}/reports/dashboard?branch_id={branch_id}", timeout=20)
    rev0 = int(r.json()["today"]["revenue"])

    r = s_kasir.post(f"{API}/transactions", json={
        "branch_id": branch_id,
        "items": [{"article_id": aid, "size": sz, "qty": 1}],
        "payment_method": "TUNAI",
        "paid": price,
    }, timeout=20)
    assert r.status_code == 201
    sale = r.json()
    tx_id = sale["id"]

    r = s_admin.get(f"{API}/reports/dashboard?branch_id={branch_id}", timeout=20)
    rev1 = int(r.json()["today"]["revenue"])
    assert rev1 == rev0 + price

    # TUKAR ke lebih murah — diff negatif, diff_paid 0
    r = s_kasir.post(f"{API}/transactions/{tx_id}/exchange", json={
        "branch_id": branch_id,
        "lines": [{"item_id": sale["items"][0]["id"], "targets": [{"article_id": t_aid, "size": t_sz, "qty": 1}]}],
        "payment_method": "TUNAI",
        "diff_paid": 0,
    }, timeout=30)
    assert r.status_code == 201, r.text
    tukar = r.json()
    assert tukar["total"] == diff  # negatif

    r = s_admin.get(f"{API}/reports/dashboard?branch_id={branch_id}", timeout=20)
    rev2 = int(r.json()["today"]["revenue"])
    assert rev2 == rev1 + diff, f"cheaper exchange should reduce revenue by {abs(diff)}: {rev1}->{rev2}"


# ---------- Import CSV produk ----------

def test_import_articles_create_and_update(admin):
    s_admin, _ = admin
    uniq = uuid.uuid4().hex[:6].upper()
    code_new = f"UJI-{uniq}"
    code_upd = f"UJI-U{uniq}"

    # 1) Buat satu artikel awal via API biasa untuk verifikasi update
    r = s_admin.post(f"{API}/articles", json={
        "code": code_upd, "name": "Uji Impor Awal", "brand": "UjiBrand", "category": "Uji",
    }, timeout=15)
    assert r.status_code == 201, r.text
    art_id_upd = r.json()["id"]

    csv_text = (
        "kode,nama,brand,kategori,barcode,modal\n"
        f"{code_new},Uji Impor Baru,UjiBrand,Uji,,150000\n"
        f"{code_upd},Uji Impor Diperbarui,UjiBrand,Uji,,175000\n"
        f",Nama Tanpa Kode {uniq},UjiBrand,Uji,,100000\n"
        "BAD-ROW,A,UjiBrand,Uji,,50000\n"  # nama terlalu pendek → error
    )
    r = s_admin.post(f"{API}/articles/import", json={"csv": csv_text}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["created"] >= 2  # code_new + auto-code row
    assert body["updated"] >= 1
    assert any("Baris 5" in e for e in body["errors"])

    # Verify update took effect
    r = s_admin.get(f"{API}/articles?q={code_upd}", timeout=15)
    hits = [a for a in r.json()["items"] if a["code"] == code_upd]
    assert hits and hits[0]["name"] == "Uji Impor Diperbarui"
    assert hits[0]["cost_price"] == 175000

    # Cleanup: soft-delete artikel uji
    for code in (code_new, code_upd):
        r = s_admin.get(f"{API}/articles?q={code}&include_inactive=true", timeout=15)
        for a in r.json()["items"]:
            if a["code"].startswith("UJI-"):
                s_admin.delete(f"{API}/articles/{a['id']}", timeout=15)


def test_import_articles_admin_only(kasir_blr):
    s, _ = kasir_blr
    r = s.post(f"{API}/articles/import", json={"csv": "nama\nX"}, timeout=15)
    assert r.status_code == 403


# ---------- Import CSV stok ----------

def test_import_stock_overwrites_and_reports_errors(kasir_blr):
    s_kasir, user = kasir_blr
    branch_id = user["branch_id"]
    mat = _matrix(s_kasir, branch_id)
    # pilih 2 baris nyata
    keys = list(mat.items())[:2]
    assert len(keys) >= 1
    (aid1, code1, sz1), row1 = keys[0]
    new_qty = 77
    new_price = int(row1["selling_price"])  # jangan ubah harga jual real
    csv_text = f"kode,ukuran,jumlah,harga_jual\n{code1},{sz1},{new_qty},{new_price}\nZZZ-NOT-EXIST,40,5,100000\n"
    r = s_kasir.post(f"{API}/stock/import", json={"branch_id": branch_id, "csv": csv_text}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applied"] == 1
    assert any("ZZZ-NOT-EXIST" in e for e in body["errors"])

    # Verify SET (overwrite)
    mat2 = _matrix(s_kasir, branch_id)
    assert int(mat2[(aid1, code1, sz1)]["qty"]) == new_qty

    # Restore original qty
    csv_restore = f"kode,ukuran,jumlah,harga_jual\n{code1},{sz1},{int(row1['qty'])},{new_price}\n"
    r = s_kasir.post(f"{API}/stock/import", json={"branch_id": branch_id, "csv": csv_restore}, timeout=20)
    assert r.status_code == 200


def test_import_stock_kasir_cannot_target_other_branch(kasir_blr, kasir_cld):
    s_blr, u_blr = kasir_blr
    s_cld, u_cld = kasir_cld
    csv_text = "kode,ukuran,jumlah,harga_jual\nLS-001,40,1,100000\n"
    r = s_blr.post(f"{API}/stock/import", json={"branch_id": u_cld["branch_id"], "csv": csv_text}, timeout=15)
    assert r.status_code == 403


# ---------- Regresi ringkas ----------

def test_wrong_pin_rejected():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": "admin", "pin": "0000"}, timeout=15)
    assert r.status_code == 401


def test_admin_only_reports_guard(kasir_blr):
    s, _ = kasir_blr
    r = s.get(f"{API}/reports/gross-profit?from=2025-01-01&to=2100-01-01", timeout=15)
    assert r.status_code == 403


def test_logout_invalidates_cookie(admin):
    s, _ = admin
    r = s.post(f"{API}/auth/logout", timeout=15)
    assert r.status_code in (200, 204)
    # after logout /auth/me should be 401
    r2 = s.get(f"{API}/auth/me", timeout=15)
    assert r2.status_code == 401
