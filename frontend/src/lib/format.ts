import { ApiError } from "@/lib/api";

/** Rp 150.000 — pemisah ribuan titik, tanpa desimal (semua uang integer Rupiah). */
export function rupiah(v: number | null | undefined): string {
  const n = Math.trunc(Number(v ?? 0));
  const sign = n < 0 ? "-" : "";
  return `${sign}Rp ${Math.abs(n).toLocaleString("id-ID")}`;
}

/** Angka polos dengan pemisah ribuan (untuk qty besar). */
export function angka(v: number | null | undefined): string {
  return Math.trunc(Number(v ?? 0)).toLocaleString("id-ID");
}

/** Buang semua non-digit — dipakai input uang & input nomor WA. */
export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Parse input uang yang diketik user ("150.000" -> 150000). */
export function parseUang(s: string): number {
  const d = onlyDigits(s);
  return d ? parseInt(d, 10) : 0;
}

export function formatTanggal(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTanggalSingkat(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

/** Sisa hari tukar ukuran (maks 7 hari dari tanggal transaksi). */
export function sisaHariTukar(iso: string): number {
  const created = new Date(iso).getTime();
  const batas = created + 7 * 24 * 60 * 60 * 1000;
  return Math.ceil((batas - Date.now()) / (24 * 60 * 60 * 1000));
}

/** Ambil pesan error yang bisa dibaca user dari ApiError FastAPI ({detail: ...}). */
export function pesanError(e: unknown, fallback = "Terjadi kesalahan"): string {
  if (e instanceof ApiError) {
    const body = e.body as { detail?: unknown } | null;
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: string } | undefined;
      if (first?.msg) return first.msg;
    }
    if (e.status === 401) return "Sesi berakhir, silakan login lagi";
    if (e.status === 403) return "Anda tidak punya akses untuk aksi ini";
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export const DEFAULT_SIZES = ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"];
