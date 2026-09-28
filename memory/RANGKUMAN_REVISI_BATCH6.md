# RANGKUMAN REVISI BATCH 6 — 28 Sep 2026 (pra-deploy)

Ringkasan perubahan di workspace ini (di atas batch 4 & 5). Semua diuji 100% lolos
(backend 23/23 pytest, semua halaman UI render tanpa error) oleh testing agent iteration_3.

---

## 1) PERBAIKAN OMZET TUKAR (sesuai keputusan pemilik — "Opsi 1")

**Masalah lama:** saat tukar, transaksi penjualan ASLI diubah nilainya (omzet "pindah" ke
tanggal beli asli). Akibatnya omzet HARI INI tidak mencerminkan selisih uang yang diterima
di laci kas hari ini.

**Perilaku baru:**
- Transaksi PENJUALAN asli **TIDAK diubah** nilainya (total tetap). Hanya `exchanged_qty`
  per baris yang dinaikkan untuk melacak sisa yang bisa ditukar.
- **Selisih harga jual** dicatat sebagai transaksi TUKAR di **hari tukar** dan ikut
  dihitung sebagai omzet hari itu. Kalau tukar ke barang lebih murah → selisih negatif
  (mengurangi omzet hari itu / uang keluar).
- **Omzet harian sekarang selalu cocok dengan uang di laci kas tiap hari.**
- **Laba Kotor** ikut akurat: selisih modal (`cost_diff`) juga dicatat, sehingga laba
  per artikel & per cabang tetap benar setelah tukar.

**File berubah:** `backend/routers/transactions.py`, `backend/routers/reports.py`,
`backend/tests/test_exchange_multi.py`, `frontend/src/pages/Riwayat.tsx`.

## 2) IMPORT MASSAL CSV (produk & stok terpisah)

- **Master Produk** → tombol **"Impor CSV"** (khusus admin). Kolom: `kode, nama, brand,
  kategori, barcode, modal`. Artikel dicocokkan per kode; kode kosong dibuatkan otomatis.
- **Stok Cabang** → tombol **"Impor CSV"** untuk cabang aktif. Kolom: `kode (atau barcode),
  ukuran, jumlah, harga_jual`. Jumlah & harga **MENIMPA** nilai lama (isi awal/koreksi).
- Keduanya menyediakan **"Unduh template + contoh"** di dialog, dan menampilkan ringkasan
  berapa baris berhasil + daftar baris yang dilewati (beserta alasannya).

**File baru/berubah:** `backend/routers/articles.py` (+`/articles/import`),
`backend/routers/stock.py` (+`/stock/import`),
`frontend/src/components/CsvImportDialog.tsx` (baru), `frontend/src/pages/Produk.tsx`,
`frontend/src/pages/Stok.tsx`.

## 3) COOKIE SECURE (keamanan sesi, siap produksi)

- Cookie sesi `pos_session` sekarang `Secure` (wajib HTTPS), dikontrol env
  `COOKIE_SECURE` (default `true`). Preview & produksi pakai HTTPS jadi aman.
- File: `backend/lib/auth.py` (+`cookie_secure()`), `backend/routers/auth.py`, `backend/.env`.

## Catatan deploy
- CORS sengaja **tidak** dibatasi (`CORS_ORIGINS=*`) atas permintaan pemilik.
- WhatsApp/Twilio belum dikonfigurasi (balas 503) — isi `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` bila ingin struk WA.
- Login cookie butuh frontend & backend di **domain yang sama**. Jalur termudah:
  **Publish di Emergent**, atau **Railway/Render** (backend menyajikan build frontend →
  1 origin, cookie langsung jalan). Vercel(frontend)+Railway(backend) = lintas domain →
  cookie tidak terkirim (butuh konfigurasi khusus).

---
Perintah uji backend cepat (sebelum full suite):
`mongosh test_database --eval 'db.login_attempts.deleteMany({})'` (hindari lockout 5/15m).
