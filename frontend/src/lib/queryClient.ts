import { QueryClient } from "@tanstack/react-query";

// Exported so lib/session can wipe it at session boundaries — cached data outlives logout.
// Defaults dituning untuk target "semua menu < 2 detik": data dianggap segar 30 detik
// sehingga pindah menu memakai cache (instan) dan hanya refetch di belakang layar.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
