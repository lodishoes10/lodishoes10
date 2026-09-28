# LodiShoes POS — PRD

## Problem Statement (asli)
Kasir toko sepatu multi-cabang (Balaraja & Ciledug): POS, stok per ukuran, barcode
(generate PNG + scan kamera HP), cetak label A4, tukar artikel/ukuran berbasis qty
(maks 7 hari, cabang asal), penyesuaian omset otomatis ikut tukar, transfer stok
antar cabang dengan persetujuan admin, kas harian, laporan, backup MongoDB harian
via cron (03:00 WIB).

## Arsitektur
- Frontend: Vite + React 19 + TypeScript, TanStack Query, base-ui/shadcn, Tailwind v4. Proxy /api → localhost:8001 (vite.config.ts). Port 3000.
- Backend: FastAPI, motor (MongoDB async), semua route prefix /api, docs dimatikan. Port 8001.
- Uang integer Rupiah. Auth PIN (scrypt) + cookie SESSION httpOnly.
- Cron: .emergent/crons.yml → POST /api/cron/backup-mongo (Bearer WEBHOOK_CRON_SECRET), arsip 7 hari di BACKUP_DIR.
- Env backend: MONGO_URL, DB_NAME, CORS_ORIGINS, APP_TZ=Asia/Jakarta, WEBHOOK_CRON_SECRET, BACKUP_DIR=/app/backups.

## Persona
- Admin/pemilik: semua cabang, modal + laba kotor, approve transfer, reset demo, backup.
- Kasir: POS cabang sendiri, tukar ≤7 hari, ajukan transfer (tidak bisa approve).

## Next Tasks
- Push ke GitHub bila user kirim token WRITE.
- (Opsional produksi) batasi CORS_ORIGINS ke domain toko saat go-live.
- Isi kredensial Twilio bila struk WA diperlukan.

## Riwayat Implementasi- Sep 2026 (workspace lama): seluruh fitur di atas selesai (lihat RANGKUMAN_REVISI.md & SPEC.md).
- 28 Sep 2026 (workspace ini): RESTORE dari GitHub lodianto502-bit/lodishoes10.
  - Clone via PAT, salin ke /app, hapus sisa template CRA (App.js, index.js, ui/*.jsx radix, craco/postcss/tailwind config lama).
  - requirements.txt: buang emergentintegrations + litellm (konflik hash, tidak dipakai kode).
  - yarn install --ignore-engines (@zxing/library minta node>=24, pod node 20 — aman).
  - backend/.env dibuat ulang (tidak ikut repo). Seed dijalankan.
  - Smoke test PASS: backend 9/9 pytest, frontend login admin+kasir, /label, barcode PNG, sale TUNAI, transfer approval.
- 28 Sep 2026 (batch 4):
  - Tukar MULTI-ARTIKEL sekaligus di UI (Riwayat.tsx): checkbox per barang + tombol "Tukar Beberapa";
    diuji Runner uk39/40/41 → Court40+Formal39+Sport41 dalam satu proses (backend lines[]).
  - Real-time near-live: refetchInterval 10s pada Dashboard/Stok/POS/Riwayat/Transfer; useOrderNotifier
    di AppShell (toast "Orderan baru" + auto-invalidate dashboard/stok/riwayat); badge transfer 15s.
  - Zip lengkap: /app/frontend/public/lodishoes-pos-REVISI-batch4.zip (juga di /app/).
  - Push GitHub GAGAL: PAT read-only (butuh token write access).

- 28 Sep 2026 (workspace BARU, restore ke-2): restore dari zip lodishoes-pos-REVISI.zip (184 KB, workspace lama) karena repo GitHub private.
  - Hapus template CRA lama (src App.js/index.js, craco/jsconfig/postcss/tailwind config, plugins/, yarn.lock lama) → rsync isi zip ke /app.
  - pip install requirements OK; yarn install --ignore-engines (@zxing/library minta node>=24, pod node 20 — aman).
  - backend/.env dari zip sudah cocok (localhost mongo, DB_NAME=test_database). Seed dijalankan ulang (idempoten).
  - Verifikasi testing agent PASS: backend smoke 13/13, login admin+2 kasir (API+UI), POS sale TUNAI sukses (TRX-20260928-BLR-007), semua halaman admin render, logout OK.
  - Catatan: legacy test_backend_api.py kena rate-limit login (5/15mnt per ip:username) bila full suite dijalankan — jalankan `mongosh test_database --eval 'db.login_attempts.deleteMany({})'` dulu. Route transfer adalah /transfer (bukan /transfer-stok).
  - KEAMANAN: user membagikan PAT GitHub read-only di chat — WAJIB revoke di GitHub Settings > Developer settings.
- 28 Sep 2026 (verifikasi pra-deploy MENYELURUH): testing agent iteration_2 PASS 100% —
  backend 25/25 pytest (auth admin+2 kasir, wrong-PIN 401, POS sale+diskon+QRIS, barcode lookup,
  transfer request+approve guard, TUKAR multi-line 2 item→2 artikel beda, TUKAR multi-target 1 sumber
  qty2→2 artikel/ukuran beda, guard qty-mismatch 422 & cross-branch 403, exchanges list, dashboard,
  laba kotor admin-only, kas, opname, pengguna, logout). Frontend semua halaman render tanpa error JS,
  dialog Tukar (tombol "Pengganti" & "Tukar Beberapa") terkonfirmasi. Fitur tukar multi-artikel/
  multi-ukuran/multi-pasang FULLY VERIFIED. Aplikasi DEPLOY-READY.
- 28 Sep 2026 (BATCH 6 — pra-deploy, user deploy manual hari ini):
  - OMZET TUKAR → Opsi 1 (keputusan pemilik): transaksi SALE asal TIDAK diubah nilainya; hanya
    exchanged_qty naik. Selisih harga jual dicatat sebagai TUKAR di HARI TUKAR dan ikut omzet hari itu
    (target lebih murah → selisih negatif). Omzet harian kini cocok dengan uang laci. Laba Kotor ikut
    akurat via cost_diff. reports.py: dashboard today & trend + gross-profit kini menghitung TUKAR.
  - IMPORT CSV massal (terpisah): Master Produk `/api/articles/import` (admin) kolom
    kode,nama,brand,kategori,barcode,modal; Stok `/api/stock/import` (require_branch) kolom
    kode/barcode,ukuran,jumlah,harga_jual (qty & harga MENIMPA — isi awal/koreksi). Frontend: komponen
    baru CsvImportDialog + tombol "Impor CSV" di Produk.tsx & Stok.tsx + template contoh unduh.
  - COOKIE SECURE env-driven: cookie_secure() (env COOKIE_SECURE, default true) → cookie pos_session
    Secure=true. .env: COOKIE_SECURE="true".
  - Testing agent iteration_3 PASS 100%: backend 23/23 pytest, UI /produk & /stok dialog Impor CSV +
    template terkonfirmasi, semua nav render. Verifikasi omzet Opsi-1 (SALE tetap, diff di hari tukar,
    dashboard naik sebesar diff) OK.
  - Zip backup baru: /app/frontend/public/lodishoes-pos-REVISI-batch6.zip (111 file). Rangkuman:
    memory/RANGKUMAN_REVISI_BATCH6.md.
  - DEPLOY: user mau manual hari ini. Cookie butuh frontend+backend satu origin → rekomendasi
    Emergent Publish ATAU Railway/Render (backend menyajikan build frontend). Vercel+Railway lintas
    domain = cookie tidak terkirim (butuh SameSite=None + CORS credentials). Menunggu pilihan user.
## Backlog
- P0: Keputusan jalur deploy (satu origin) + eksekusi config sesuai pilihan.
- P1: WhatsApp struk via Twilio (butuh TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM di backend/.env — belum diset, fitur WA akan error 503 sampai diisi).
- P2: CORS_ORIGINS dibatasi ke origin eksplisit saat go-live (saat ini * atas permintaan user); refactor endpoint exchange.

## Next Tasks
- Minta user verifikasi data/flow sesuai kebutuhan toko.
- Isi kredensial Twilio bila struk WA diperlukan.
