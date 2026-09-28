# LodiShoes POS — Rangkuman Revisi BATCH 5 (28 Sep 2026)

Lanjutan dari BATCH 4. Fokus: halaman Riwayat Tukar + audit keamanan & perbaikannya.

## 1. Halaman baru: Riwayat Tukar (/riwayat-tukar)
- Backend: koleksi `db.exchanges` sudah menyimpan tiap penukaran. Ditambah endpoint
  **GET /api/exchanges** (scoped cabang, filter tanggal, pagination) di `routers/transactions.py`.
- Frontend: halaman baru `src/pages/RiwayatTukar.tsx` + menu "Riwayat Tukar" di sidebar.
- Menampilkan tiap penukaran secara rapi: **dari artikel/ukuran → ke artikel/ukuran × qty**,
  selisih per baris, total selisih (pelanggan menambah / kasir mengembalikan), tanggal, kasir.
- Diuji: TRX-20260928-BLR-003 → 3 baris (Runner 39→Court40, Runner40→Formal39, Runner41→Sport41),
  total selisih Rp 170.000.

## 2. Audit keamanan + perbaikan
Audit menyeluruh (auth, otorisasi cabang, injeksi, CORS, kebocoran data, cron secret).
Otorisasi cabang, hashing PIN (scrypt), gating admin, dan cron secret sudah AMAN. Diperbaiki:

- **[HIGH] Modal bocor ke kasir** — respons transaksi (`GET/POST /api/transactions*`) dulu
  menyertakan `cost` & `line_cost`. Kini di-nolkan untuk role kasir; hanya admin melihat modal.
  (fix di `routers/transactions.py` fungsi `tx_out(doc, user)`). DIUJI: kasir=0, admin=185000.
- **[MEDIUM] Brute-force PIN** — login tanpa batas percobaan. Kini: 5 gagal → kunci 15 menit
  per (IP+username), reset saat berhasil (koleksi `login_attempts`). DIUJI: percobaan ke-6 → 429.
  (fix di `lib/auth.py`: check_login_allowed/record_login_failure/clear_login_attempts + `routers/auth.py`).
- **[LOW] Cookie sesi belum Secure** — ditambah `secure=True` (HTTPS-only) pada cookie login.
- **[LOW] Param tanggal ngawur → 500** — `lib/dates.py` kini balas **422** untuk format tanggal salah.
- **[LOW] CORS `*` + credentials** — DIBIARKAN untuk preview (satu origin via ingress, aman karena
  SameSite=lax). Saat pakai domain sendiri jangka panjang, batasi `CORS_ORIGINS` ke domain toko.

## 3. Hasil tes
- Backend: 13/13 pytest lolos (smoke + tukar multi-artikel).
- Frontend: login 3 akun, dialog tukar multi-item, halaman Riwayat Tukar — semua OK.
- Verifikasi keamanan via curl: cost tersembunyi, brute-force terkunci, tanggal ngawur 422.

## 4. Catatan penggunaan jangka panjang
- Sebelum go-live dengan domain sendiri: set `CORS_ORIGINS` ke domain toko, pastikan HTTPS
  (cookie Secure sudah aktif).
- Backup MongoDB harian otomatis via cron (.emergent/crons.yml) — pastikan `BACKUP_DIR` ada.
- Struk WhatsApp: isi kredensial Twilio bila ingin diaktifkan.
