import { createContext, useContext } from "react";
import type { CurrentUser } from "@/lib/types";

export interface BranchScope {
  user: CurrentUser;
  isAdmin: boolean;
  /** Cabang aktif yang dipilih (admin bisa ganti; kasir terkunci ke cabangnya). */
  branchId: string;
  branchName: string;
  setBranchId: (id: string) => void;
}

export const BranchScopeContext = createContext<BranchScope | null>(null);

export function useScope(): BranchScope {
  const ctx = useContext(BranchScopeContext);
  if (!ctx) throw new Error("useScope harus dipakai di dalam AppShell");
  return ctx;
}

/** Query string cabang untuk endpoint yang menerima ?branch_id= */
export function branchQuery(branchId: string): string {
  return branchId ? `?branch_id=${encodeURIComponent(branchId)}` : "";
}
