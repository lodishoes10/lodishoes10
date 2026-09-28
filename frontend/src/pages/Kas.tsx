import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Wallet } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "@/components/Chrome";
import { branchQuery, useScope } from "@/hooks/useScope";
import { formatTanggal, onlyDigits, parseUang, pesanError, rupiah } from "@/lib/format";
import type { ActiveCash, CashSession, Expense, ExpenseCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const CATEGORIES: ExpenseCategory[] = ["RESTOK", "OPERASIONAL", "GAJI", "LAINNYA"];
const CAT_LABEL: Record<string, string> = {
  RESTOK: "Restok Barang",
  OPERASIONAL: "Operasional",
  GAJI: "Gaji",
  LAINNYA: "Lainnya",
};

export default function Kas() {
  const { branchId, branchName } = useScope();
  const qc = useQueryClient();
  const [openingText, setOpeningText] = useState("");
  const [moveAmountText, setMoveAmountText] = useState("");
  const [moveNote, setMoveNote] = useState("");
  const [moveType, setMoveType] = useState<"IN" | "OUT">("OUT");
  const [countedText, setCountedText] = useState("");
  const [expAmountText, setExpAmountText] = useState("");
  const [expCategory, setExpCategory] = useState<ExpenseCategory>("OPERASIONAL");
  const [expNote, setExpNote] = useState("");

  const activeQuery = useQuery({
    queryKey: ["cash-active", branchId],
    queryFn: () => apiGet<ActiveCash>(`/cash/active${branchQuery(branchId)}`),
    enabled: !!branchId,
  });

  const sessionsQuery = useQuery({
    queryKey: ["cash-sessions", branchId],
    queryFn: () => apiGet<CashSession[]>(`/cash/sessions${branchQuery(branchId)}`),
    enabled: !!branchId,
  });

  const expensesQuery = useQuery({
    queryKey: ["expenses", branchId],
    queryFn: () => apiGet<Expense[]>(`/expenses${branchQuery(branchId)}`),
    enabled: !!branchId,
  });

  const session = activeQuery.data?.session ?? null;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["cash-active", branchId] });
    qc.invalidateQueries({ queryKey: ["cash-sessions", branchId] });
  };

  const openCash = useMutation({
    mutationFn: () =>
      apiPost<CashSession>("/cash/open", {
        branch_id: branchId,
        opening_cash: parseUang(openingText),
      }),
    onSuccess: () => {
      toast.success("Kas dibuka");
      setOpeningText("");
      invalidate();
    },
    onError: (e) => toast.error(pesanError(e, "Gagal membuka kas")),
  });

  const addMove = useMutation({
    mutationFn: () =>
      apiPost<CashSession>("/cash/movements", {
        branch_id: branchId,
        type: moveType,
        amount: parseUang(moveAmountText),
        note: moveNote,
      }),
    onSuccess: () => {
      toast.success("Mutasi kas dicatat");
      setMoveAmountText("");
      setMoveNote("");
      invalidate();
    },
    onError: (e) => toast.error(pesanError(e, "Gagal mencatat mutasi")),
  });

  const closeCash = useMutation({
    mutationFn: () =>
      apiPost<CashSession>("/cash/close", {
        branch_id: branchId,
        counted_cash: parseUang(countedText),
      }),
    onSuccess: (s) => {
      const d = s.difference ?? 0;
      toast.success(
        d === 0
          ? "Kas ditutup — cocok persis"
          : `Kas ditutup — selisih ${d > 0 ? "lebih" : "kurang"} ${rupiah(Math.abs(d))}`,
      );
      setCountedText("");
      invalidate();
    },
    onError: (e) => toast.error(pesanError(e, "Gagal menutup kas")),
  });

  const addExpense = useMutation({
    mutationFn: () =>
      apiPost<Expense>("/expenses", {
        branch_id: branchId,
        category: expCategory,
        amount: parseUang(expAmountText),
        note: expNote,
      }),
    onSuccess: () => {
      toast.success("Pengeluaran dicatat");
      setExpAmountText("");
      setExpNote("");
      qc.invalidateQueries({ queryKey: ["expenses", branchId] });
    },
    onError: (e) => toast.error(pesanError(e, "Gagal mencatat pengeluaran")),
  });

  return (
    <div>
      <PageHeader
        title="Kas & Pengeluaran"
        description={`Kas drawer ${branchName}. Kas seharusnya dihitung server: modal awal + kas masuk − kas keluar + penjualan tunai.`}
        testId="kas-header"
      />

      <Tabs defaultValue="kas">
        <TabsList className="mb-4" data-testid="kas-tabs">
          <TabsTrigger value="kas" data-testid="kas-tab-drawer">Kas Drawer</TabsTrigger>
          <TabsTrigger value="pengeluaran" data-testid="kas-tab-expenses">Pengeluaran</TabsTrigger>
          <TabsTrigger value="riwayat" data-testid="kas-tab-history">Riwayat Sesi</TabsTrigger>
        </TabsList>

        <TabsContent value="kas">
          {activeQuery.isError && (
            <div className="mb-4">
              <ErrorNote message={pesanError(activeQuery.error, "Data kas belum bisa dimuat")} testId="kas-error" />
            </div>
          )}

          {activeQuery.isLoading ? (
            <SkeletonRows rows={3} testId="kas-loading" />
          ) : !session ? (
            <Card data-testid="kas-open-card">
              <CardHeader>
                <CardTitle className="font-heading text-base">Buka Kas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Belum ada sesi kas terbuka di cabang ini. Masukkan modal awal untuk memulai shift.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="opening" className="text-xs font-semibold uppercase">
                    Modal Awal
                  </Label>
                  <Input
                    id="opening"
                    inputMode="numeric"
                    placeholder="0"
                    value={openingText ? parseUang(openingText).toLocaleString("id-ID") : ""}
                    onChange={(e) => setOpeningText(onlyDigits(e.target.value))}
                    className="tabular max-w-xs"
                    data-testid="kas-opening-input"
                  />
                </div>
                <Button
                  disabled={openCash.isPending}
                  onClick={() => openCash.mutate()}
                  data-testid="kas-open-button"
                >
                  {openCash.isPending ? "Membuka…" : "Buka Kas"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2" data-testid="kas-summary-card">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between font-heading text-base">
                    <span>Sesi Kas Aktif</span>
                    <Badge variant="secondary" data-testid="kas-status-badge">
                      Dibuka {formatTanggal(session.opened_at)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    {[
                      { l: "Modal Awal", v: session.opening_cash, t: "kas-opening" },
                      { l: "Penjualan Tunai", v: session.cash_sales, t: "kas-sales" },
                      { l: "Kas Masuk", v: session.movement_in, t: "kas-in" },
                      { l: "Kas Keluar", v: session.movement_out, t: "kas-out" },
                    ].map((x) => (
                      <div key={x.l} className="rounded-lg border border-border p-3">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {x.l}
                        </dt>
                        <dd className="tabular mt-1 font-semibold" data-testid={x.t}>
                          {rupiah(x.v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="flex items-center justify-between rounded-lg bg-sky-50 px-4 py-3">
                    <span className="text-sm font-semibold text-sky-900">Kas Seharusnya</span>
                    <span className="tabular text-lg font-bold text-sky-900" data-testid="kas-expected">
                      {rupiah(session.expected_cash)}
                    </span>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase">Jenis Mutasi</Label>
                      <Select value={moveType} onValueChange={(v: string) => setMoveType(v as "IN" | "OUT")}>
                        <SelectTrigger data-testid="kas-move-type">
                          <SelectValue>
                            {(v) => ((v as string) === "IN" ? "Kas Masuk" : "Kas Keluar")}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="IN" data-testid="kas-move-in">Kas Masuk</SelectItem>
                          <SelectItem value="OUT" data-testid="kas-move-out">Kas Keluar</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="move-amt" className="text-xs font-semibold uppercase">Jumlah</Label>
                      <Input
                        id="move-amt"
                        inputMode="numeric"
                        placeholder="0"
                        value={moveAmountText ? parseUang(moveAmountText).toLocaleString("id-ID") : ""}
                        onChange={(e) => setMoveAmountText(onlyDigits(e.target.value))}
                        className="tabular"
                        data-testid="kas-move-amount-input"
                      />
                    </div>
                    <Button
                      variant="secondary"
                      disabled={parseUang(moveAmountText) <= 0 || addMove.isPending}
                      onClick={() => addMove.mutate()}
                      data-testid="kas-move-submit-button"
                    >
                      Catat
                    </Button>
                  </div>
                  <Input
                    placeholder="Catatan mutasi (opsional)"
                    value={moveNote}
                    onChange={(e) => setMoveNote(e.target.value)}
                    data-testid="kas-move-note-input"
                  />

                  {session.movements.length > 0 && (
                    <ul className="space-y-1 pt-1" data-testid="kas-movements-list">
                      {session.movements.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-xs"
                          data-testid={`kas-movement-${m.id}`}
                        >
                          <span>
                            <Badge
                              variant={m.type === "IN" ? "secondary" : "outline"}
                              className="mr-2 text-[10px]"
                            >
                              {m.type === "IN" ? "MASUK" : "KELUAR"}
                            </Badge>
                            {m.note || "—"}
                          </span>
                          <span className="tabular font-semibold">{rupiah(m.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="kas-close-card">
                <CardHeader>
                  <CardTitle className="font-heading text-base">Tutup Kas</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="counted" className="text-xs font-semibold uppercase">
                      Uang Fisik Dihitung
                    </Label>
                    <Input
                      id="counted"
                      inputMode="numeric"
                      placeholder="0"
                      value={countedText ? parseUang(countedText).toLocaleString("id-ID") : ""}
                      onChange={(e) => setCountedText(onlyDigits(e.target.value))}
                      className="tabular"
                      data-testid="kas-counted-input"
                    />
                  </div>
                  {countedText && (
                    <p
                      className={cn(
                        "tabular text-sm font-semibold",
                        parseUang(countedText) - session.expected_cash === 0
                          ? "text-emerald-700"
                          : "text-amber-700",
                      )}
                      data-testid="kas-difference-preview"
                    >
                      Selisih {rupiah(parseUang(countedText) - session.expected_cash)}
                    </p>
                  )}
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={!countedText || closeCash.isPending}
                    onClick={() => closeCash.mutate()}
                    data-testid="kas-close-button"
                  >
                    {closeCash.isPending ? "Menutup…" : "Tutup Kas"}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="pengeluaran">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card data-testid="expense-form-card">
              <CardHeader>
                <CardTitle className="font-heading text-base">Catat Pengeluaran</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase">Kategori</Label>
                  <Select
                    value={expCategory}
                    onValueChange={(v: string) => setExpCategory(v as ExpenseCategory)}
                  >
                    <SelectTrigger data-testid="expense-category-select">
                      <SelectValue>{(v) => CAT_LABEL[v as string] ?? "Pilih"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c} data-testid={`expense-category-${c}`}>
                          {CAT_LABEL[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exp-amt" className="text-xs font-semibold uppercase">Jumlah</Label>
                  <Input
                    id="exp-amt"
                    inputMode="numeric"
                    placeholder="0"
                    value={expAmountText ? parseUang(expAmountText).toLocaleString("id-ID") : ""}
                    onChange={(e) => setExpAmountText(onlyDigits(e.target.value))}
                    className="tabular"
                    data-testid="expense-amount-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exp-note" className="text-xs font-semibold uppercase">Keterangan</Label>
                  <Input
                    id="exp-note"
                    placeholder="mis. bayar listrik"
                    value={expNote}
                    onChange={(e) => setExpNote(e.target.value)}
                    data-testid="expense-note-input"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={parseUang(expAmountText) <= 0 || addExpense.isPending}
                  onClick={() => addExpense.mutate()}
                  data-testid="expense-submit-button"
                >
                  {addExpense.isPending ? "Menyimpan…" : "Simpan Pengeluaran"}
                </Button>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2" data-testid="expense-list-card">
              <CardHeader>
                <CardTitle className="font-heading text-base">Pengeluaran Terakhir</CardTitle>
              </CardHeader>
              <CardContent>
                {expensesQuery.isLoading ? (
                  <SkeletonRows rows={4} testId="expense-loading" />
                ) : (expensesQuery.data?.length ?? 0) === 0 ? (
                  <EmptyState title="Belum ada pengeluaran" icon={Wallet} testId="expense-empty" />
                ) : (
                  <ul className="space-y-2" data-testid="expense-list">
                    {expensesQuery.data!.map((x) => (
                      <li
                        key={x.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                        data-testid={`expense-row-${x.id}`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            <Badge variant="outline" className="mr-2 text-[10px]">
                              {CAT_LABEL[x.category]}
                            </Badge>
                            {x.note || "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatTanggal(x.created_at)} · {x.created_by_name}
                          </p>
                        </div>
                        <span className="tabular shrink-0 font-semibold text-red-600">
                          −{rupiah(x.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="riwayat">
          <Card data-testid="kas-history-card">
            <CardHeader>
              <CardTitle className="font-heading text-base">Riwayat Sesi Kas</CardTitle>
            </CardHeader>
            <CardContent>
              {sessionsQuery.isLoading ? (
                <SkeletonRows rows={4} testId="kas-history-loading" />
              ) : (sessionsQuery.data?.length ?? 0) === 0 ? (
                <EmptyState title="Belum ada sesi kas" icon={Banknote} testId="kas-history-empty" />
              ) : (
                <ul className="space-y-2" data-testid="kas-history-list">
                  {sessionsQuery.data!.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-lg border border-border p-3"
                      data-testid={`kas-history-${s.id}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm">
                          <Badge
                            variant={s.status === "OPEN" ? "secondary" : "outline"}
                            className="mr-2 text-[10px]"
                          >
                            {s.status === "OPEN" ? "TERBUKA" : "DITUTUP"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatTanggal(s.opened_at)}
                            {s.closed_at ? ` → ${formatTanggal(s.closed_at)}` : ""}
                          </span>
                        </div>
                        {s.status === "CLOSED" && (
                          <span
                            className={cn(
                              "tabular text-sm font-semibold",
                              (s.difference ?? 0) === 0 ? "text-emerald-700" : "text-amber-700",
                            )}
                          >
                            Selisih {rupiah(s.difference ?? 0)}
                          </span>
                        )}
                      </div>
                      <p className="tabular mt-1 text-xs text-muted-foreground">
                        Modal {rupiah(s.opening_cash)}
                        {s.counted_cash != null ? ` · Fisik ${rupiah(s.counted_cash)}` : ""} · oleh{" "}
                        {s.opened_by_name}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {expensesQuery.isError && (
        <div className="mt-4">
          <ErrorNote
            message={pesanError(expensesQuery.error, "Pengeluaran belum bisa dimuat")}
            testId="expense-error"
          />
        </div>
      )}
    </div>
  );
}
