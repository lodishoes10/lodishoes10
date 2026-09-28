# LodiShoes POS — Spesifikasi Hidup

Aplikasi kasir (POS) toko sepatu multi cabang. UI Bahasa Indonesia, mata uang IDR (semua uang
disimpan sebagai INTEGER Rupiah — tidak ada float di mana pun).

## Stack
- Backend FastAPI, semua route di `api_router` prefix `/api`. `/openapi.json`, `/docs`, `/redoc` DIMATIKAN.
- Frontend Vite + React 19 + TS strict, TanStack Query, shadcn/base-ui, Tailwind v4.
- MongoDB (motor). Index didefinisikan di `backend/lib/db.py` (`INDEXES`).

## Akun (PIN hash scrypt)
| username | PIN | peran | cabang |
|---|---|---|---|
| admin | 1234 | admin | semua cabang |
| kasirbalaraja | 1111 | kasir | Balaraja (BLR) |
| kasirciledug | 2222 | kasir | Ciledug (CLD) |

Login = `POST /api/auth/login` → cookie httpOnly `pos_session` (7 hari). `GET /api/auth/me` = siapa saya.
Logout `POST /api/auth/logout`. Halaman login TIDAK pernah memuat daftar user.

## Aturan Peran (dipaksa di backend, bukan hanya UI)
- **admin**: semua cabang, melihat & mengisi `cost_price` (harga modal), akses `/laporan` (laba kotor),
  `/produk`, `/pengguna`, boleh koreksi qty stok manual.
- **kasir**: terkunci ke `branch_id` miliknya (403 bila mencoba cabang lain), `cost_price` TIDAK
  dikirim backend (selalu `null`), hanya bisa tambah ukuran + harga jual.

## Data Model (koleksi utama)
- `users`: id, username(unik), name, role, branch_id, pin_hash
- `sessions`: token(unik), user_id, expires_at
- `branches`: id, code(BLR/CLD), name, address+phone TIDAK dipakai di struk lagi
- `articles`: id, code(unik, otomatis LS-###), name, brand, category, **barcode (unik partial)**, cost_price, image_url, is_active
- `stock_items`: **unik (branch_id, article_id, size)** ← jaminan anti-artikel-dobel; qty, selling_price
- `transactions`: id, receipt_no(unik), branch_id, type `SALE|TUKAR`, items[], subtotal, discount,
  total, payment_method, paid, change, wa_sent
  - `items[]`: article_id/code/name, size, qty, price, cost, line_revenue, discount_alloc, line_cost,
    new_size/new_price (hanya pada TUKAR)
- `exchanges`: unik (tx_id, item_id) ← satu item hanya bisa ditukar sekali
- `transfers`, `opnames`, `cash_sessions`, `cash_movements`, `expenses`, `counters`

## Perhitungan (diverifikasi)
- Harga & modal di-*snapshot* server dari stock/article saat transaksi — klien tidak bisa mengubah harga.
- Diskon dialokasikan per baris proporsional; baris terakhir menyerap sisa pembulatan sehingga
  Σ`discount_alloc` == `discount` persis.
- `laba kotor = Σ line_revenue − Σ discount_alloc − Σ line_cost`, hanya `type=SALE`.
- Transaksi `TUKAR` tidak pernah masuk omzet/laba (semua agregasi mem-filter `type: "SALE"`).
- Kas seharusnya = modal awal + kas masuk − kas keluar + penjualan TUNAI (termasuk selisih tukar bertanda).

## Alur Kunci
1. **POS `/transaksi`**: cari artikel (filter klien, instan) → klik ukuran (habis = nonaktif,
   line-through) → keranjang → diskon/metode bayar/preset uang → checkout. Stok dikurangi ATOMIK
   (`qty >= n`) dengan kompensasi bila salah satu baris gagal. Struk muncul otomatis.
2. **Tukar Ukuran `/riwayat`**: hanya `type=SALE`, maks 7 hari, satu item sekali tukar.
   Ukuran baru −1 (bersyarat stok), ukuran lama +1. Tercatat sebagai transaksi `TUKAR` berisi selisih tunai.
3. **Struk**: dialog menampilkan struk gaya Indomaret 32 kolom. Cetak = `window.print()`.
   CSS cetak ada di `frontend/src/index.css` (`@media print`) + deskriptor `@page { size: 80mm auto }`
   yang WAJIB tinggal di `frontend/index.html` — pipeline Tailwind v4 (Lightning CSS) membuang
   deskriptor `size` bila ditulis di `index.css`. Cabang DOM selain struk di-`display:none`
   (bukan hanya `visibility:hidden`, karena kotak layoutnya masih memakan tinggi dan
   mendorong struk ke halaman ke-2), dan `translate`/`transform` pembungkus dialog
   dinetralkan. Terverifikasi: 1 halaman, lebar 80mm, posisi tengah.
4. **WhatsApp**: `POST /api/transactions/{id}/whatsapp` kirim struk teks via Twilio dari nomor WA toko.
   Tanpa kredensial → 503 dengan pesan jelas (lihat backend/.env).
5. **Stok anti-dobel**: `POST /api/stock/add` upsert pada kunci unik (branch, article, size);
   respons `merged: true` berarti qty digabung ke artikel yang sama.

## Performa
- Keep-alive `GET /api/health` tiap 4 menit dari AppShell (hilangkan cold start).
- Dashboard & laba kotor dihitung server-side (aggregation pipeline + index), bukan di klien.
- Riwayat & artikel paginasi. `staleTime` 30s → pindah menu memakai cache (instan).
- Gambar artikel `loading="lazy"` + lebar terkompres dari CDN.

## Integrasi
Twilio WhatsApp — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` di `backend/.env`.
**BELUM DIISI (placeholder)** — endpoint & UI lengkap, mengembalikan 503 sampai kredensial diisi.

## Revisi lanjutan (batch 2)
- **Struk**: tanpa alamat, tanpa nomor telepon, tanpa ketentuan tukar 7 hari. Kepala struk =
  `LODISHOES` + nama cabang (BALARAJA / CILEDUG).
- **Barcode**: `GET /api/articles/by-barcode/{barcode}`. Di POS & form stok, scanner yang
  mengirim Enter langsung memicu pencarian; artikel terisi otomatis. Barcode unik (partial index).
- **Kasir boleh menulis artikel sendiri**: `POST /api/articles` terbuka untuk kasir, tapi
  `cost_price` dipaksa 0 (modal tetap milik admin) dan kode dibuat otomatis.
- **Ukuran bebas**: input teks (maks 8 char) — "39", "40.5", "XL" valid. Chip saran diambil dari
  ukuran yang sudah dipakai di cabang tsb, bukan daftar paksa.
- **Laba bersih**: `/api/reports/gross-profit` mengembalikan `expense` & `net_profit`
  (= laba kotor − pengeluaran). Terisi saat `group_by=branch` (pengeluaran tidak melekat ke artikel);
  cabang yang hanya punya pengeluaran tetap muncul dengan laba negatif.
- **Reset data demo**: `POST /api/admin/reset-demo` (admin, body `{"confirm":"HAPUS","wipe_master":true}`).
  Akun & cabang selalu aman. UI di `/pengaturan`.
- **Backup harian**: `.emergent/crons.yml` -> `POST /api/cron/backup-mongo` tiap 03:00 WIB,
  Bearer `WEBHOOK_CRON_SECRET`, idempoten via `X-Webhook-Id` (koleksi `cron_runs`, TTL 30 hari),
  mongodump -> `/app/backups/*.tar.gz`, simpan 7 hari. Daftar arsip: `GET /api/admin/backups`.
- **Notifikasi seragam**: semua `window.prompt/confirm` bawaan browser diganti
  `components/PromptDialog.tsx` + toast sonner, jadi tampilan pemberitahuan sama di seluruh aplikasi.
- **Anti-bentrok**: terverifikasi 6 transaksi bersamaan di 2 cabang — nomor struk unik
  (counter atomik per cabang per hari) dan stok tepat.
- **Tukar ukuran** hanya bisa antar-ukuran pada ARTIKEL YANG SAMA (artikel dikunci dari item
  transaksi asal), dan selisih harga dihitung dari harga ukuran baru — tidak mungkin tertukar artikel lain.
