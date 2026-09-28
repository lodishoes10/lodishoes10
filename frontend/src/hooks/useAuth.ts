import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Branch, CurrentUser } from "@/lib/types";

export const ME_KEY = ["auth", "me"] as const;

/**
 * Siapa yang login. Halaman login TIDAK menunggu daftar user — hanya satu panggilan
 * ringan /auth/me, dan 401 bukan error yang di-retry (langsung dianggap belum login).
 */
export function useMe() {
  const q = useQuery({
    queryKey: ME_KEY,
    queryFn: () => apiGet<CurrentUser>("/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
  });
  return {
    user: q.data ?? null,
    isLoading: q.isLoading,
    isAdmin: q.data?.role === "admin",
    isError: q.isError,
  };
}

/** Daftar cabang — dipakai admin untuk filter, kasir hanya melihat cabangnya. */
export function useBranches(enabled = true) {
  return useQuery({
    queryKey: ["branches"],
    queryFn: () => apiGet<Branch[]>("/branches"),
    enabled,
    staleTime: 10 * 60_000,
  });
}
