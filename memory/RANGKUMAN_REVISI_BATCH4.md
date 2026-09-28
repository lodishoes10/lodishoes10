# LodiShoes POS — Rangkuman Revisi BATCH 4 (28 Sep 2026)

Lanjutan dari RANGKUMAN_REVISI.md. Berisi perubahan pada workspace baru setelah restore dari GitHub.

## 1. Restore dari GitHub (bukan build ulang)
- Kode di-clone dari https://github.com/lodianto502-bit/lodishoes10 (repo PRIVAT, pakai PAT).
- backend/.env dibuat ulang (tidak ikut repo): MONGO_URL, DB_NAME, CORS_ORIGINS="*",
  APP_TZ="Asia/Jakarta", WEBHOOK_CRON_SECRET, BACKUP_DIR="/app/backups".
- requirements.txt: baris `emergentintegrations` & `litellm` DIBUANG (konflik hash & tidak dipakai kode).
- Frontend: `yarn install --ignore-engines` (@zxing/library minta Node>=24, pod Node 20 — aman).
- Login tetap: admin/1234, kasirbalaraja/1111, kasirciledug/2222 (jalankan `python seed.py`).

## 2. Revisi fitur BATCH 4

### a. Tukar BANYAK ARTIKEL sekaligus (perbaikan utama)
Masalah lama: di UI hanya bisa menukar 1 artikel per proses (padahal backend sudah dukung banyak).
Perbaikan (frontend `src/pages/Riwayat.tsx`):
- Dialog Tukar sekarang MULTI-ITEM. Setiap baris barang punya CHECKBOX untuk dipilih.
- Tombol baru **"Tukar Beberapa"** di tiap transaksi (muncul bila ada >1 barang bisa ditukar) →
  membuka dialog dengan SEMUA barang tercentang.
- Tombol **"Tukar"** per baris tetap ada → membuka dialog dengan barang itu saja tercentang.
- Tiap barang: pilih jumlah pasang + banyak "Pengganti" (artikel/ukuran boleh beda-beda).
- Selisih SEMUA barang dijumlah jadi satu pembayaran/kembalian.
- Contoh yang sudah diuji: beli Runner uk 39/40/41 (@1) → tukar jadi Court uk40 + Formal uk39 +
  Sport uk41 dalam SATU proses. Backend `POST /api/transactions/{id}/exchange` menerima `lines[]`.

### b. Real-time tanpa refresh (near real-time, polling 10 detik)
- `src/lib/queryClient.ts` default tetap; tiap query kunci diberi `refetchInterval: 10_000`:
  Dashboard, Stok, POS (stock-matrix), Riwayat (transactions), Transfer (list + stock).
- `src/components/AppShell.tsx`: hook `useOrderNotifier` memantau penjualan terbaru di cabang aktif
  tiap 10 detik. Bila ada struk SALE baru dari kasir LAIN → tampil TOAST "Orderan baru • {struk}"
  dan otomatis menyegarkan dashboard, stok, & riwayat (stok langsung berkurang di layar admin).
- Badge transfer menunggu persetujuan: interval dipercepat 30s → 15s.

### c. Mobile & notifikasi
- Layout sudah responsif (sidebar → Sheet di HP, panel keranjang → bottom sheet).
- Dialog Tukar multi-item: `max-h-[92svh] overflow-y-auto sm:max-w-2xl` (scroll mulus di HP).
- Notifikasi memakai `sonner` (Toaster richColors) — konsisten di semua menu.

## 3. Tips hemat kredit (penting)
1. Kumpulkan revisi dalam SATU pesan yang jelas (mis. "perbaiki A, B, C") daripada banyak pesan
   kecil bolak-balik — tiap iterasi memakai kredit.
2. Sebutkan langsung menu/halaman + langkah reproduksi bila ada bug, sertakan screenshot bila perlu.
3. Untuk perubahan besar, minta kerjakan bertahap tapi digabung per tema.
4. Simpan/push ke GitHub secara berkala (sudah dilakukan) supaya aman bila kredit habis.
5. Isi ulang/aktifkan auto top-up Universal Key dari Profile → Manage plan bila perlu.

## 4. Belum aktif (opsional)
- Kirim struk WhatsApp (Twilio): isi TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
  di backend/.env lalu restart backend.
- Realtime saat ini pakai polling 10 detik (bukan websocket) — ringan & hemat, cukup untuk toko.
