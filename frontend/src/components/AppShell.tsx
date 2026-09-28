import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Barcode,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Package,
  Receipt,
  Repeat,
  ScrollText,
  Settings,
  Store,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useBranches, useMe } from "@/hooks/useAuth";
import { BranchScopeContext } from "@/hooks/useScope";
import { endSession } from "@/lib/session";
import { rupiah } from "@/lib/format";
import type { Paged, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Pemantau orderan real-time. Setiap 10 detik memeriksa penjualan terbaru di cabang aktif.
 * Bila ada struk SALE baru dari kasir LAIN, tampilkan notifikasi dan segarkan dashboard,
 * stok, serta riwayat — sehingga admin tahu ada orderan masuk & stok berkurang tanpa refresh.
 */
function useOrderNotifier(branchId: string, userId: string) {
  const qc = useQueryClient();
  const baseline = useRef<{ branch: string; receipt: string | null }>({ branch: "", receipt: null });
  useQuery({
    queryKey: ["order-watch", branchId],
    queryFn: async () => {
      const res = await apiGet<Paged<Transaction>>(
        `/transactions?branch_id=${encodeURIComponent(branchId)}&type=SALE&page_size=1`,
      );
      const latest = res.items[0] ?? null;
      const b = baseline.current;
      if (b.branch !== branchId) {
        // Ganti cabang → set patokan tanpa notifikasi (hindari alarm palsu).
        baseline.current = { branch: branchId, receipt: latest?.receipt_no ?? null };
        return res;
      }
      if (latest && latest.receipt_no !== b.receipt) {
        if (b.receipt !== null && latest.cashier_id !== userId) {
          toast.success(`Orderan baru • ${latest.receipt_no}`, {
            description: `${latest.branch_name} · ${latest.cashier_name} · ${rupiah(latest.total)}`,
          });
        }
        baseline.current = { branch: branchId, receipt: latest.receipt_no };
        qc.invalidateQueries({ queryKey: ["dashboard", branchId] });
        qc.invalidateQueries({ queryKey: ["stock-matrix", branchId] });
        qc.invalidateQueries({ queryKey: ["transactions"] });
      }
      return res;
    },
    enabled: !!branchId,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
    retry: false,
  });
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/transaksi", label: "Transaksi", icon: Receipt },
  { to: "/riwayat", label: "Riwayat & Tukar", icon: ScrollText },
  { to: "/riwayat-tukar", label: "Riwayat Tukar", icon: Repeat },
  { to: "/stok", label: "Stok", icon: Package },
  { to: "/transfer", label: "Transfer Stok", icon: ArrowLeftRight },
  { to: "/label", label: "Label Barcode", icon: Barcode },
  { to: "/opname", label: "Opname", icon: ClipboardCheck },
  { to: "/kas", label: "Kas & Pengeluaran", icon: Wallet },
  { to: "/produk", label: "Master Produk", icon: Store, adminOnly: true },
  { to: "/laporan", label: "Laba Kotor & Bersih", icon: TrendingUp, adminOnly: true },
  { to: "/pengguna", label: "Pengguna", icon: Users, adminOnly: true },
  { to: "/pengaturan", label: "Pengaturan", icon: Settings, adminOnly: true },
];

const BRANCH_KEY = "lodishoes.branch";

function NavLinks({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const pending = useQuery({
    queryKey: ["transfers", "pending-count"],
    queryFn: () => apiGet<{ count: number }>("/transfers/pending-count"),
    enabled: isAdmin,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });
  const pendingCount = pending.data?.count ?? 0;
  return (
    <nav className="flex flex-col gap-1" data-testid="sidebar-nav">
      {NAV.filter((n) => !n.adminOnly || isAdmin).map((item) => {
        const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            data-testid={`nav-${item.to === "/" ? "dashboard" : item.to.slice(1)}`}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
              active
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-slate-400 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <span
              className={cn(
                "absolute left-0 h-6 w-[3px] rounded-r-full bg-sky-400 transition-opacity duration-150",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <Icon className={cn("size-[18px] shrink-0 transition-transform duration-150", !active && "group-hover:translate-x-0.5")} />
            <span className="truncate">{item.label}</span>
            {item.to === "/transfer" && isAdmin && pendingCount > 0 && (
              <span
                className="tabular ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900"
                title={`${pendingCount} transfer menunggu persetujuan`}
                data-testid="nav-transfer-pending-badge"
              >
                {pendingCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAdmin } = useMe();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: branches } = useBranches(!!user);

  const [adminBranch, setAdminBranch] = useState<string>(
    () => localStorage.getItem(BRANCH_KEY) ?? "",
  );

  // Keep-alive: ping ringan tiap 4 menit supaya backend tidak pernah cold start.
  useQuery({
    queryKey: ["keepalive"],
    queryFn: () => apiGet<{ ok: boolean }>("/health"),
    refetchInterval: 4 * 60_000,
    enabled: !!user,
    retry: false,
    staleTime: 0,
  });

  // Admin default ke cabang pertama begitu daftar cabang tiba.
  useEffect(() => {
    if (isAdmin && !adminBranch && branches && branches.length > 0) {
      setAdminBranch(branches[0].id);
    }
  }, [isAdmin, adminBranch, branches]);

  useEffect(() => {
    if (adminBranch) localStorage.setItem(BRANCH_KEY, adminBranch);
  }, [adminBranch]);

  const scope = useMemo(() => {
    if (!user) return null;
    const branchId = isAdmin ? adminBranch : (user.branch_id ?? "");
    const branchName = isAdmin
      ? (branches?.find((b) => b.id === branchId)?.name ?? "Pilih cabang")
      : (user.branch_name ?? "-");
    return {
      user,
      isAdmin,
      branchId,
      branchName,
      setBranchId: (id: string) => setAdminBranch(id),
    };
  }, [user, isAdmin, adminBranch, branches]);

  useOrderNotifier(scope?.branchId ?? "", user?.id ?? "");

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background" data-testid="shell-loading">
        <div className="flex flex-col items-center gap-3">
          <div className="size-10 animate-spin rounded-full border-3 border-slate-200 border-t-sky-500" />
          <p className="text-sm text-muted-foreground">Menyiapkan LodiShoes POS…</p>
        </div>
      </div>
    );
  }

  if (!user || !scope) return <Navigate to="/login" replace />;

  const handleLogout = async () => {
    await endSession();
    navigate("/login", { replace: true });
  };

  const sidebar = (
    <div className="flex h-full flex-col gap-6 bg-sidebar p-4 text-sidebar-foreground">
      <div className="flex items-center gap-3 px-2">
        <div className="flex size-10 items-center justify-center rounded-xl bg-sky-500/15 ring-1 ring-sky-400/40">
          <Store className="size-5 text-sky-400" />
        </div>
        <div className="leading-tight">
          <p className="font-heading text-base font-bold tracking-tight">LodiShoes</p>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Point of Sale
          </p>
        </div>
      </div>
      <NavLinks isAdmin={isAdmin} onNavigate={() => setMobileOpen(false)} />
      <div className="mt-auto space-y-3 border-t border-sidebar-border pt-4">
        <div className="px-2">
          <p className="truncate text-sm font-semibold" data-testid="shell-user-name">
            {user.name}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge
              variant="secondary"
              className="bg-sky-500/15 text-[10px] tracking-wider text-sky-300"
              data-testid="shell-user-role"
            >
              {user.role.toUpperCase()}
            </Badge>
            {!isAdmin && (
              <Badge variant="outline" className="border-slate-600 text-[10px] text-slate-300">
                {user.branch_name ?? "-"}
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          data-testid="logout-button"
          className="w-full justify-start gap-2 text-slate-300 hover:bg-red-500/10 hover:text-red-300"
        >
          <LogOut className="size-4" /> Keluar
        </Button>
      </div>
    </div>
  );

  return (
    <BranchScopeContext.Provider value={scope}>
      <div className="flex min-h-svh bg-background">
        <aside className="no-print sticky top-0 hidden h-svh w-60 shrink-0 lg:block">{sidebar}</aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur-md">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                render={
                  <Button variant="ghost" size="icon-sm" className="lg:hidden" data-testid="mobile-menu-button">
                    <MenuIcon className="size-5" />
                  </Button>
                }
              />
              <SheetContent side="left" className="w-64 border-none p-0">
                {sidebar}
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1">
              {isAdmin ? (
                <div className="flex items-center gap-2">
                  <span className="hidden text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:inline">
                    Cabang
                  </span>
                  <Select
                    value={scope.branchId}
                    onValueChange={(v: string) => scope.setBranchId(v)}
                  >
                    <SelectTrigger className="h-9 w-[190px]" data-testid="branch-selector">
                      <SelectValue>
                        {(v) => branches?.find((b) => b.id === (v as string))?.name ?? "Pilih cabang"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(branches ?? []).map((b) => (
                        <SelectItem key={b.id} value={b.id} data-testid={`branch-option-${b.code}`}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Store className="size-4 text-muted-foreground" />
                  <span className="truncate text-sm font-semibold" data-testid="branch-locked-label">
                    {user.branch_name ?? "-"}
                  </span>
                  <Badge variant="outline" className="hidden text-[10px] sm:inline-flex">
                    Terkunci
                  </Badge>
                </div>
              )}
            </div>
          </header>

          <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </BranchScopeContext.Provider>
  );
}
