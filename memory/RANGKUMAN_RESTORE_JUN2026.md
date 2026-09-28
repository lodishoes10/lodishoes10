# LodiShoes POS — Rangkuman Restore & Status Final (Jun 2026, batch6-final)

## 1. Apa yang terjadi
- Workspace lama hilang. Kode dipulihkan dari ZIP `lodishoes-pos-REVISI-batch6.zip`
  (GitHub `main` saat itu masih batch3 — sudah diganti).
- Database: MongoDB Atlas cluster `lodishoes.7dj73tb.mongodb.net`, DB **`lodishoes`**.
  Cluster sebelumnya KOSONG (hanya `sample_mflix`) → auto-seed jalan. Data lama TIDAK ada di Atlas.

## 2. Perubahan di batch ini (setelah batch6)
- `frontend/src/pages/Dashboard.tsx`: sub-label kartu Omzet → "Penjualan + selisih tukar hari ini".
- `frontend/src/pages/Laporan.tsx`: deskripsi laporan disesuaikan Opsi 1 (selisih tukar dicatat di hari tukar).
- `backend/tests/test_iteration2_full.py`: assertion lama (Opsi 2) diperbarui ke Opsi 1.
- Tidak ada perubahan logika backend — omzet memang sudah menghitung selisih tukar (`reports.py` `diff_rev`).

## 3. Hasil QA penuh (testing agent, iteration_2)
- Backend pytest 31/31 (serial `-n 0`); frontend 100% — semua halaman admin, kasirbalaraja, kasirciledug
  terbuka tanpa error console; akses role benar; cookie `Secure; HttpOnly`; import CSV produk & stok jalan;
  tukar Opsi 1 (SALE asli tidak berubah, selisih masuk omzet hari tukar) terverifikasi.
- WhatsApp → 503 (Twilio kosong) = disengaja.

## 4. Environment (`backend/.env`, TIDAK ikut Git/ZIP)
```
MONGO_URL="mongodb+srv://<user>:<password>@lodishoes.7dj73tb.mongodb.net/?appName=lodishoes"
DB_NAME="lodishoes"
CORS_ORIGINS="*"
COOKIE_SECURE="true"
APP_TZ="Asia/Jakarta"
WEBHOOK_CRON_SECRET="<random hex>"
BACKUP_DIR="/app/backups"
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""
TWILIO_WHATSAPP_FROM=""
```
Atlas Network Access harus mengizinkan IP server (0.0.0.0/0 paling aman untuk hosting dinamis).

## 5. Cara jalankan ulang (workspace / server baru)
1. `git clone https://github.com/lodishoes10/lodishoes10.git` (branch `main`) atau unzip `lodishoes-pos-FINAL-jun2026.zip`.
2. `cd backend && pip install -r requirements.txt` — buat `.env` seperti di atas.
3. `cd frontend && yarn install --ignore-engines` (Node 20; `@zxing/library` minta Node ≥24 tapi jalan normal).
4. Start: backend `uvicorn server:app --host 0.0.0.0 --port 8001`, frontend `yarn start` (Vite, proxy `/api` → 8001).
5. Login default seed: `admin/1234`, `kasirbalaraja/1111`, `kasirciledug/2222`. Ganti PIN admin di halaman Pengguna.
6. Lockout PIN (5x/15 menit) → hapus koleksi `login_attempts`.

## 6. Deploy (nanti)
Panduan lengkap Railway + Atlas: `DEPLOY_RAILWAY.md`, `Dockerfile`, `railway.toml` sudah ada di repo.
Set `PLAIN_BUILD=true` saat build frontend di luar Emergent.

## 7. Deploy Railway (SELESAI, Jun 2026)
- URL produksi: https://lodishoes-pos-production.up.railway.app (project "Lodishoes", service `lodishoes-pos`, env production).
- Deploy via `railway up` (upload dari workspace, bukan GitHub App). Untuk deploy ulang: `RAILWAY_TOKEN=<project token> railway up --service 17a0dbef-8ade-40ae-a8a2-2706f6398ef4 --detach` dari root repo,
  atau sambungkan repo GitHub di dashboard Railway (Settings → Source) agar auto-deploy tiap push.
- DB sama dengan preview Emergent (Atlas `lodishoes`) → satu data, tidak dobel.
- Dockerfile: type-check hanya `tsconfig.app.json` (vite.config.ts mengimpor paket internal Emergent yang dilepas saat build).
- Variabel di Railway: MONGO_URL, DB_NAME, COOKIE_SECURE, CORS_ORIGINS, APP_TZ, WEBHOOK_CRON_SECRET, BACKUP_DIR=/tmp/backups, TWILIO_* kosong.
