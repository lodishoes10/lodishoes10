# LodiShoes POS — PRD (Living Document)

## Problem Statement
POS sepatu multi-cabang (React+TS, FastAPI, MongoDB), melanjutkan source existing "Lodi's Project".
Revisi batch 3: scan barcode kamera, barcode gambar + label cetak, tukar artikel berbasis qty
(target campur, penyesuaian omset), transfer stok berpersetujuan admin.

## Architecture
- Frontend: Vite + React 19 + TS strict, TanStack Query, shadcn/base-ui, Tailwind v4, @zxing/browser.
- Backend: FastAPI (routes prefix /api, docs off), motor/MongoDB. Uang = integer Rupiah.
- Barcode: python-barcode + Pillow (PNG Code128 server-side).

## User Personas
- Kasir cabang: transaksi, tukar barang, ajukan transfer. Terkunci 1 cabang, modal disembunyikan.
- Admin: semua cabang, approve/tolak transfer, kelola artikel/label, lihat modal & laporan laba.

## Core Requirements (static)
1. Transaksi POS multi-metode (TUNAI/QRIS/TRANSFER/DEBIT), stok atomik, struk thermal 80mm.
2. Scan barcode: hardware scanner (Enter), kamera live, unggah foto.
3. Barcode gambar per artikel + halaman label cetak 1/2/3 kolom (A4).
4. Tukar artikel/ukuran berbasis qty: sebagian pasang, target campur, selisih ditotal, stok +/- ,
   tukar bertahap <=7 hari & cabang sendiri, kasir boleh tanpa approval.
5. Penyesuaian omset/laporan otomatis saat tukar (omset per artikel pindah, total menyesuaikan).
6. Transfer stok antar cabang: pengajuan -> MENUNGGU -> admin approve/tolak; stok pindah saat approve.
7. Konkurensi aman multi-cabang: nomor struk unik (counter atomik), stok tak minus, anti artikel dobel.

## Implemented (2026-09-28)
- [x] Semua fitur revisi batch 3 (poin 1-7) — diverifikasi testing agent: backend 16/16, frontend smoke 100%.
- [x] Konkurensi: 4 sale paralel BLR+CLD (struk unik), 5 sale paralel stok=1 (1x 201, sisa 409, tak minus).
- [x] Barcode PNG + auto-assign nomor 899xxxxxxxxxx.
- [x] Seed idempoten (transaksi contoh upsert by receipt_no).

## Implemented (2026-09-28, batch 4)
- [x] Unduh PDF halaman label (print-to-PDF jendela bersih, `label-pdf-button`).
- [x] Filter rentang tanggal Riwayat (`riwayat-date-from/to/clear`, memakai `from`/`to` API).
- [x] Lencana jumlah transfer menunggu di menu admin (`GET /api/transfers/pending-count`, `nav-transfer-pending-badge`).
- Verifikasi: tsc + oxlint 0 error, curl endpoint pending-count & filter tanggal OK. UI belum dites di browser (kredit user terbatas).

## Backlog (P1/P2)
- P1: WhatsApp Twilio (endpoint+UI siap, 503 sampai TWILIO_* diisi).
- P2: role-approval berjenjang; uji kamera scanner di HP nyata.

## Next Tasks
- (opsional) Isi kredensial Twilio untuk aktifkan struk WhatsApp.
- Cek UI batch 4 di browser (badge, filter tanggal, tombol Unduh PDF).
