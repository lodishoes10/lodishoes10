import { queryClient } from "@/lib/queryClient";
import { apiPost } from "@/lib/api";
import type { OkResult } from "@/lib/types";

/** Panggil setelah login sukses — cache milik akun sebelumnya tidak boleh bocor. */
export function beginSession() {
  queryClient.clear();
}

/** Satu-satunya jalan keluar: hapus sesi server LALU bersihkan cache react-query. */
export async function endSession() {
  try {
    await apiPost<OkResult>("/auth/logout");
  } finally {
    queryClient.clear();
  }
}
