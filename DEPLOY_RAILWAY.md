# PANDUAN DEPLOY LodiShoes POS ke Railway (+ MongoDB Atlas) — LANGKAH LENGKAP

Aplikasi ini dirancang deploy **satu service** di Railway: backend FastAPI menyajikan
API (`/api`) **dan** frontend React yang sudah di-build. Frontend & backend satu domain,
jadi login cookie langsung berfungsi (tanpa ribet CORS).

Yang Anda butuhkan: akun GitHub (kode sudah di sana), akun MongoDB Atlas (gratis), akun Railway.

---

## LANGKAH 1 — Simpan kode terbaru ke GitHub

1. Di kolom chat Emergent, klik **"Save to Github"** (folder/kolom input chat) agar file
   terbaru ikut ter-push: `Dockerfile`, `railway.toml`, `.dockerignore`, `DEPLOY_RAILWAY.md`,
   dan semua revisi batch 6.
2. Pastikan branch `main` di repo `lodianto502-bit/lodishoes10` berisi file `Dockerfile`
   di root. (Cek di GitHub.)

> Cadangan offline (jika GitHub bermasalah): unduh zip
> `https://shoe-pos-setup.preview.emergentagent.com/lodishoes-pos-REVISI-batch6.zip`,
> ekstrak, lalu push manual ke repo.

---

## LANGKAH 2 — Siapkan MongoDB Atlas (database online, gratis)

1. Buka https://cloud.mongodb.com → **Sign up / Login**.
2. **Create Project** → nama bebas (mis. `lodishoes`) → **Create Cluster** → pilih
   **M0 (FREE)**, provider & region bebas (pilih yang dekat, mis. Singapore) → **Create**.
3. Saat diminta, buat **Database User**: username (mis. `lodiadmin`) + password
   (buat yang kuat, CATAT). Simpan.
4. Menu kiri → **Network Access** → **Add IP Address** → pilih **Allow Access from
   Anywhere** (`0.0.0.0/0`) → Confirm. (Diperlukan agar Railway bisa konek.)
5. Menu **Database** → cluster Anda → **Connect** → **Drivers** → **Node.js/Driver apa
   pun** → copy **connection string**, bentuknya:
   ```
   mongodb+srv://lodiadmin:<password>@cluster0.xxxxx.mongodb.net/
   ```
6. Ganti `<password>` dengan password user tadi (tanpa tanda `<>`). Ini adalah nilai
   `MONGO_URL` Anda. Simpan baik-baik.

---

## LANGKAH 3 — Deploy ke Railway

1. Buka https://railway.app → **Login with GitHub**.
2. Klik **New Project** → **Deploy from GitHub repo** → pilih repo `lodishoes10`.
3. Railway akan **otomatis mendeteksi `Dockerfile`** di root dan mulai build
   (membangun frontend + backend sekaligus). Tunggu 3–8 menit.
4. Setelah service dibuat, buka tab **Variables** dan isi:

   | Key | Value |
   |---|---|
   | `MONGO_URL` | connection string Atlas dari Langkah 2 (yang sudah diganti passwordnya) |
   | `DB_NAME` | `lodishoes` (atau nama bebas) |
   | `COOKIE_SECURE` | `true` |
   | `APP_TZ` | `Asia/Jakarta` |
   | `CORS_ORIGINS` | `*` (aman: frontend & backend satu domain) |

   (Railway mengisi `PORT` otomatis — jangan diubah.)

5. Tab **Settings** → **Networking** → **Generate Domain** untuk mendapatkan URL publik
   (mis. `lodishoes10-production.up.railway.app`). Ini alamat aplikasi Anda.

6. Saat boot pertama, aplikasi **otomatis mengisi data awal** (auto-seed): 2 cabang,
   akun, 6 artikel contoh, dan stok. Tidak perlu menjalankan apa pun manual.

---

## LANGKAH 4 — Tes & ganti PIN (PENTING)

1. Buka URL Railway Anda → halaman login muncul.
2. Login awal: **admin / 1234**.
3. **SEGERA ganti PIN** semua akun lewat menu **Pengguna** (admin) — jangan biarkan PIN
   default (1234/1111/2222) dipakai di produksi.
4. Hapus artikel contoh & masukkan produk asli:
   - **Master Produk → Impor CSV** (atau tambah manual) untuk daftar artikel.
   - **Stok → Impor CSV** untuk stok per ukuran per cabang.
   - Template + contoh bisa diunduh dari dialog "Impor CSV".
5. (Opsional) Hapus data contoh lewat **Pengaturan → Reset data demo** jika tersedia.

---

## Catatan & Troubleshooting

- **Login tidak bisa / langsung ter-logout:** pastikan `COOKIE_SECURE=true` DAN URL dibuka
  lewat **https://** (Railway domain otomatis HTTPS). Jangan pakai http.
- **Build gagal di Railway:** buka tab **Deployments → View Logs**. Kalau error menyebut
  `@emergentbase`, pastikan `Dockerfile` terbaru sudah ter-push (file itu sudah melepas
  paket internal Emergent saat build).
- **Backup harian otomatis** (`.emergent/crons.yml`) HANYA berjalan di Emergent. Di
  Railway, jika mau backup harian, pakai fitur **Cron** Railway yang memanggil
  `POST https://<domain-anda>/api/cron/backup-mongo` dengan header
  `Authorization: Bearer <WEBHOOK_CRON_SECRET>` (set `WEBHOOK_CRON_SECRET` di Variables).
- **Custom domain** (mis. `pos.tokoanda.com`): Railway → Settings → Custom Domain.
- **Atlas TLS diblokir** hanya terjadi di preview Emergent. Dari Railway, Atlas berjalan normal.

---

## Ringkasan arsitektur produksi

```
Browser (HP/komputer toko)
   │  https://<domain-railway-anda>
   ▼
Railway (1 container):
   ├─ Frontend React (build statis, disajikan di /)
   └─ Backend FastAPI (API di /api)
        │
        ▼
MongoDB Atlas (database online)
```

Semua satu domain → cookie login aman & berfungsi. Selesai — aplikasi siap dipakai toko.
