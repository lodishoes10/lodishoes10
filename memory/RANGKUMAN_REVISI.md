# LodiShoes POS — Rangkuman Revisi & Panduan Pindah Workspace

Dokumen ini merangkum SEMUA yang sudah dikerjakan pada revisi lanjutan (batch 3) supaya
bila kredit habis dan pindah ke workspace baru, tidak perlu mengulang dari awal.

## 1. Cara restore di workspace baru (langkah singkat)
1. Upload `lodishoes-pos-REVISI.zip` ke workspace baru.
2. Unzip ke `/app` (timpa `backend/`, `frontend/`, `memory/`, `.emergent/`).
3. Backend: `cd /app/backend && pip install -r requirements.txt` lalu `python seed.py`.
4. Frontend: `cd /app/frontend && yarn install`.
5. Pastikan `backend/.env` berisi: `MONGO_URL`, `DB_NAME`, `CORS_ORIGINS="*"`, `APP_TZ="Asia/Jakarta"`,
   `WEBHOOK_CRON_SECRET`, `BACKUP_DIR="/app/backups"` (file .env TIDAK ikut di zip, buat manual).
6. `sudo supervisorctl restart backend frontend`.
7. Login: `admin/1234`, `kasirbalaraja/1111`, `kasirciledug/2222`.

## 2. Stack
- Frontend: Vite + React 19 + TypeScript strict, TanStack Query, shadcn/base-ui, Tailwind v4.
- Backend: FastAPI (semua route prefix `/api`, docs dimatikan), motor (MongoDB async).
- Barcode: `python-barcode` + `Pillow` (generate PNG Code128 di server); scan kamera pakai `@zxing/browser`.
- Uang: SELALU integer Rupiah (tidak ada float).

## 3. Fitur revisi yang SUDAH selesai

### a. Scan barcode via kamera HP
- Komponen `frontend/src/components/BarcodeScanner.tsx`: 2 mode — **kamera live** (real-time zxing)
  & **unggah foto** (decode dari gambar).
- Dipakai di **POS** (tombol "Scan Kamera") dan **form Tambah Stok** (ikon kamera).
- Barcode fisik (scanner USB) tetap jalan: input teks yang diakhiri Enter langsung mencari artikel.

### b. Barcode sebagai gambar per artikel + label cetak
- Endpoint `GET /api/articles/{id}/barcode.png` — PNG Code128. Artikel tanpa barcode otomatis
  diberi nomor unik `899xxxxxxxxxx` (via counter atomik) saat gambar/label pertama diminta.
- `POST /api/articles/{id}/barcode` — pastikan artikel punya barcode, kembalikan nomornya.
- Halaman **`/label`** (`frontend/src/pages/Label.tsx`): pilih artikel + jumlah stiker per artikel,
  layout **1 / 2 / 3 kolom**, cetak ke kertas **A4** (named page `labelsheet` di `index.html`).
- Nomor barcode ada di dalam gambar PNG (tidak dobel di teks terpisah).

### c. Tukar artikel/ukuran BERBASIS QTY (inti revisi)
- Endpoint `POST /api/transactions/{tx_id}/exchange`
  body: `{ branch_id, lines:[{ item_id, targets:[{article_id,size,qty}] }], payment_method, diff_paid }`.
- Kasir pilih **berapa pasang** yang ditukar dari qty baris (sisa tetap di transaksi & masih bisa ditukar lagi).
- **Target boleh campur**: 1 baris bisa jadi beberapa artikel/ukuran berbeda dalam satu proses.
- Selisih dihitung **per pasang** lalu **ditotal jadi satu**: positif → pelanggan bayar; negatif → kasir kembalikan.
- **Stok**: artikel/ukuran lama +qty (atomik), target −qty (atomik, berkompensasi bila gagal).
- **Tukar bertahap**: sisa pasang di baris masih bisa ditukar selama transaksi ≤ **7 hari** & **cabang asal**.
- Batasan dipaksa di backend: 7 hari, cabang sendiri, kasir boleh (tanpa approval).

### d. Penyesuaian omset / laporan (ikut tukar)
- Transaksi **SALE asal dimutasi**: qty baris lama berkurang & `exchanged_qty` bertambah; baris target
  baru ditambahkan (`from_exchange=true`); `subtotal`/`total` dihitung ulang.
- Karena laporan agregasi per artikel membaca `items[]` transaksi SALE, **omset per artikel otomatis
  pindah** (artikel lama turun, artikel baru naik) dan **total omset menyesuaikan** naik/turun.
- Transaksi `TUKAR` (bukti selisih uang) TIDAK pernah masuk omzet/laba (semua agregasi filter `type=SALE`).

### e. Transfer stok antar cabang BERPERSETUJUAN
- Kasir `POST /api/transfers` → status **MENUNGGU** (stok BELUM bergerak).
- Admin `POST /api/transfers/{id}/approve` → stok pindah saat itu juga (source −, dest + upsert),
  atau `POST /api/transfers/{id}/reject` (body `{reason}`) → stok tidak berubah.
- Kasir mencoba approve/reject = 403 (khusus admin). Approve/reject ulang = 409.
- UI: badge status **Menunggu Persetujuan / Disetujui / Ditolak**; tombol Setujui/Tolak hanya untuk admin.

### f. Metode pembayaran
- TUNAI, QRIS, TRANSFER, **DEBIT** — berlaku di transaksi biasa & pelunasan selisih tukar.

### g. Tambahan revisi ke-2 (2026-09-28)
- **Unduh PDF label** (`pages/Label.tsx`, tombol `label-pdf-button`): membuka jendela bersih berisi label saja lalu dialog cetak → pilih "Simpan sebagai PDF". Tanpa library tambahan.
- **Filter rentang tanggal Riwayat** (`pages/Riwayat.tsx`, `riwayat-date-from/to/clear`): memakai query `from`/`to` yang sudah ada di `GET /api/transactions`.
- **Lencana transfer menunggu** di menu admin (`components/AppShell.tsx`, `nav-transfer-pending-badge`): endpoint baru `GET /api/transfers/pending-count` (admin only), refresh tiap 30 detik & setelah setujui/tolak.

## 4. File penting yang diubah/ditambah
Backend:
- `routers/transactions.py` — sale + exchange berbasis qty (mutasi omset).
- `routers/transfers.py` — transfer + approval admin.
- `routers/articles.py` — barcode PNG + auto-assign barcode.
- `lib/barcode_gen.py` — generator PNG Code128 (baru).
- `lib/receipt.py` — struk mendukung tukar campur & 4 metode bayar.
- `lib/db.py` — index `exchanges` (bukan lagi unik per item, agar tukar bertahap).
- `seed.py` — artikel diberi barcode; transaksi contoh jadi 3 pasang.

Frontend:
- `components/BarcodeScanner.tsx` (baru), `pages/Label.tsx` (baru).
- `pages/Riwayat.tsx` — dialog tukar qty + target campur + pilih metode bayar.
- `pages/TransferStok.tsx` — pengajuan + approval admin + badge status.
- `pages/POS.tsx`, `pages/Stok.tsx` — tombol scan kamera + metode DEBIT.
- `pages/Produk.tsx` — kolom barcode (gambar).
- `components/ReceiptDialog.tsx`, `lib/types.ts`, `App.tsx`, `components/AppShell.tsx`, `index.css`, `index.html`.

## 5. Keamanan konkurensi (multi-cabang barengan) — SUDAH dijaga
- **Nomor struk unik**: counter atomik per cabang per hari (`db.counters` via `find_one_and_update $inc`).
- **Stok**: pengurangan atomik `find_one_and_update({qty:{$gte:n}}, {$inc:{qty:-n}})` + rollback bila salah satu baris gagal → transaksi tidak pernah setengah jadi.
- **Anti artikel dobel**: index unik `(branch_id, article_id, size)` pada `stock_items`.
- Setiap cabang punya dokumen stok terpisah → transaksi barengan antar cabang tidak saling mengunci.

## 6. Yang belum / opsional (backlog)
- WhatsApp Twilio: endpoint & UI siap, balas 503 sampai `TWILIO_*` diisi di `backend/.env`.
- Konfirmasi terima cabang tujuan pada transfer: TIDAK dipakai (cukup approval admin, sesuai keputusan pemilik).

## 7. Akun uji
Lihat `memory/test_credentials.md`.
