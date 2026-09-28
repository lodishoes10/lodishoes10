import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Minus, Plus, Printer, Receipt, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "@/components/Chrome";
import ReceiptDialog from "@/components/ReceiptDialog";
import { branchQuery, useScope } from "@/hooks/useScope";
import {
  angka,
  formatTanggal,
  onlyDigits,
  parseUang,
  pesanError,
  rupiah,
  sisaHariTukar,
} from "@/lib/format";
import type { Paged, PaymentMethod, StockRow, Transaction, TxItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  "": "Semua Jenis",
  SALE: "Penjualan",
  TUKAR: "Tukar",
};

const PAYMENTS: PaymentMethod[] = ["TUNAI", "QRIS", "TRANSFER", "DEBIT"];

interface TargetRow {
  key: number;
  article_id: string;
  size: string;
  qty: number;
}

export default function Riwayat() {
  const { branchId, branchName } = useScope();
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [receipt, setReceipt] = useState<Transaction | null>(null);

  // --- State dialog tukar (berbasis qty, target boleh campur) ---
  const [exchangeTx, setExchangeTx] = useState<Transaction | null>(null);
  const [exchangeItem, setExchangeItem] = useState<TxItem | null>(null);
  const [qtyTukar, setQtyTukar] = useState(1);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("TUNAI");
  const [diffPaidText, setDiffPaidText] = useState("");
  const keyRef = useRef(1);

  const listQuery = useQuery({
    queryKey: ["transactions", branchId, typeFilter, term, fromDate, toDate, page],
    queryFn: () =>
      apiGet<Paged<Transaction>>(
        `/transactions${branchQuery(branchId)}${branchId ? "&" : "?"}page=${page}&page_size=20${
          typeFilter ? `&type=${typeFilter}` : ""
        }${term.trim() ? `&q=${encodeURIComponent(term.trim())}` : ""}${
          fromDate || toDate ? `&from=${fromDate || toDate}&to=${toDate || fromDate}` : ""
        }`,
      ),
    enabled: !!branchId,
  });

  // Stok cabang = daftar artikel & ukuran yang bisa dijadikan TARGET tukar (boleh artikel lain).
  const stockQuery = useQuery({
    queryKey: ["stock-matrix", branchId],
    queryFn: () => apiGet<StockRow[]>(`/stock/matrix${branchQuery(branchId)}`),
    enabled: !!exchangeItem && !!branchId,
  });

  const stockRows = useMemo(
    () => (stockQuery.data ?? []).filter((r) => r.sizes.some((s) => s.qty > 0)),
    [stockQuery.data],
  );

  const priceOf = (articleId: string, size: string) =>
    stockRows
      .find((r) => r.article_id === articleId)
      ?.sizes.find((s) => s.size === size)?.selling_price ?? null;

  const totalTargetQty = targets.reduce((s, t) => s + (t.qty || 0), 0);
  const diffTotal = exchangeItem
    ? targets.reduce((s, t) => {
        const p = t.size ? priceOf(t.article_id, t.size) : null;
        return p == null ? s : s + t.qty * (p - exchangeItem.price);
      }, 0)
    : 0;
  const diffPaid = parseUang(diffPaidText);

  const exchange = useMutation({
    mutationFn: () =>
      apiPost<Transaction>(`/transactions/${exchangeTx!.id}/exchange`, {
        branch_id: branchId,
        lines: [
          {
            item_id: exchangeItem!.id,
            targets: targets.map((t) => ({ article_id: t.article_id, size: t.size, qty: t.qty })),
          },
        ],
        payment_method: payMethod,
        diff_paid: diffTotal > 0 && payMethod === "TUNAI" ? diffPaid : 0,
      }),
    onSuccess: (tx) => {
      toast.success(`Tukar berhasil — ${tx.receipt_no}. Omset & stok sudah menyesuaikan.`);
      closeExchange();
      setReceipt(tx);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["stock-matrix", branchId] });
      qc.invalidateQueries({ queryKey: ["dashboard", branchId] });
    },
    onError: (e) => toast.error(pesanError(e, "Tukar gagal")),
  });

  const openExchange = (tx: Transaction, item: TxItem) => {
    setExchangeTx(tx);
    setExchangeItem(item);
    setQtyTukar(1);
    setTargets([{ key: keyRef.current++, article_id: "", size: "", qty: 1 }]);
    setPayMethod("TUNAI");
    setDiffPaidText("");
  };

  const closeExchange = () => {
    setExchangeTx(null);
    setExchangeItem(null);
    setTargets([]);
    setDiffPaidText("");
  };

  const patchTarget = (key: number, patch: Partial<TargetRow>) =>
    setTargets((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const targetsValid =
    targets.length > 0 &&
    targets.every((t) => t.article_id && t.size && t.qty > 0) &&
    totalTargetQty === qtyTukar;

  const canSubmit =
    !!exchangeItem &&
    qtyTukar >= 1 &&
    qtyTukar <= (exchangeItem?.qty ?? 0) &&
    targetsValid &&
    !exchange.isPending &&
    (diffTotal <= 0 || payMethod !== "TUNAI" || diffPaid >= diffTotal);

  const items = listQuery.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((listQuery.data?.total ?? 0) / 20));

  return (
    <div>
      <PageHeader
        title="Riwayat & Tukar"
        description={`Transaksi ${branchName}. Tukar artikel/ukuran berlaku maksimal 7 hari, boleh sebagian pasang dan target boleh campur.`}
        testId="riwayat-header"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari nomor struk…"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
            className="pl-9"
            data-testid="riwayat-search-input"
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v: string) => {
            setTypeFilter(v === "ALL" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[170px]" data-testid="riwayat-type-filter">
            <SelectValue>{(v) => TYPE_LABEL[(v as string) === "ALL" ? "" : (v as string)] ?? "Semua Jenis"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" data-testid="riwayat-type-all">Semua Jenis</SelectItem>
            <SelectItem value="SALE" data-testid="riwayat-type-sale">Penjualan</SelectItem>
            <SelectItem value="TUKAR" data-testid="riwayat-type-tukar">Tukar</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5" data-testid="riwayat-date-range">
          <Input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            className="tabular w-[150px]"
            title="Dari tanggal"
            data-testid="riwayat-date-from"
          />
          <span className="text-xs text-muted-foreground">s/d</span>
          <Input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            className="tabular w-[150px]"
            title="Sampai tanggal"
            data-testid="riwayat-date-to"
          />
          {(fromDate || toDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setPage(1);
              }}
              data-testid="riwayat-date-clear"
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {listQuery.isError && (
        <div className="mb-4">
          <ErrorNote
            message={pesanError(listQuery.error, "Riwayat belum bisa dimuat")}
            testId="riwayat-error"
          />
        </div>
      )}

      {listQuery.isLoading ? (
        <SkeletonRows rows={5} testId="riwayat-loading" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Belum ada transaksi"
          description="Transaksi akan muncul di sini setelah checkout pertama."
          icon={Receipt}
          testId="riwayat-empty"
        />
      ) : (
        <div className="space-y-3" data-testid="riwayat-list">
          {items.map((tx) => {
            const sisa = sisaHariTukar(tx.created_at);
            const bisaTukar = tx.type === "SALE" && sisa > 0;
            return (
              <Card key={tx.id} data-testid={`riwayat-row-${tx.receipt_no}`}>
                <CardContent className="pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tabular font-heading text-sm font-bold">
                          {tx.receipt_no}
                        </span>
                        <Badge
                          variant={tx.type === "TUKAR" ? "outline" : "secondary"}
                          className={cn(
                            "text-[10px]",
                            tx.type === "TUKAR" && "border-amber-300 bg-amber-50 text-amber-700",
                          )}
                          data-testid={`riwayat-type-${tx.receipt_no}`}
                        >
                          {tx.type === "TUKAR" ? "TUKAR" : "PENJUALAN"}
                        </Badge>
                        {tx.type === "SALE" && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              sisa > 0
                                ? "border-emerald-300 text-emerald-700"
                                : "border-slate-300 text-slate-500",
                            )}
                          >
                            {sisa > 0 ? `Bisa tukar ${sisa} hari lagi` : "Lewat 7 hari"}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatTanggal(tx.created_at)} · {tx.cashier_name} · {tx.branch_name}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {tx.items.map((it) => (
                          <li
                            key={it.id}
                            className="flex flex-wrap items-center gap-2 text-sm"
                            data-testid={`riwayat-item-${it.id}`}
                          >
                            <span className={cn("font-medium", it.qty < 1 && "line-through opacity-60")}>
                              {it.article_name}
                            </span>
                            <span className="tabular text-xs text-muted-foreground">
                              Uk. {it.size} × {angka(it.qty)} · {rupiah(it.price)}
                            </span>
                            {(it.exchanged_qty ?? 0) > 0 && (
                              <Badge
                                variant="outline"
                                className="border-rose-300 bg-rose-50 text-[10px] text-rose-700"
                                data-testid={`riwayat-exchanged-${it.id}`}
                              >
                                Ditukar {angka(it.exchanged_qty)} psg
                              </Badge>
                            )}
                            {it.from_exchange && (
                              <Badge
                                variant="outline"
                                className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700"
                              >
                                Hasil tukar
                              </Badge>
                            )}
                            {it.new_size && (
                              <Badge
                                variant="outline"
                                className="border-amber-300 bg-amber-50 text-[10px] text-amber-700"
                              >
                                {it.size} → {it.new_article_name ? `${it.new_article_name} ` : ""}uk. {it.new_size}
                              </Badge>
                            )}
                            {bisaTukar && it.qty > 0 && (
                              <Button
                                variant="outline"
                                size="xs"
                                className="gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                                onClick={() => openExchange(tx, it)}
                                data-testid={`tukar-button-${it.id}`}
                              >
                                <ArrowLeftRight className="size-3" /> Tukar
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="tabular text-lg font-bold" data-testid={`riwayat-total-${tx.receipt_no}`}>
                        {rupiah(tx.total)}
                      </span>
                      <span className="text-xs text-muted-foreground">{tx.payment_method}</span>
                      <Button
                        variant="outline"
                        size="xs"
                        className="gap-1"
                        onClick={() => setReceipt(tx)}
                        data-testid={`struk-button-${tx.receipt_no}`}
                      >
                        <Printer className="size-3" /> Struk
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                data-testid="riwayat-prev-page"
              >
                Sebelumnya
              </Button>
              <span className="tabular text-sm text-muted-foreground" data-testid="riwayat-page-info">
                Halaman {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                data-testid="riwayat-next-page"
              >
                Berikutnya
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Dialog Tukar — berbasis qty, target boleh campur antar artikel/ukuran */}
      <Dialog open={!!exchangeItem} onOpenChange={(o) => !o && closeExchange()}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg" data-testid="tukar-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Tukar Artikel / Ukuran</DialogTitle>
            <DialogDescription>
              Stok lama kembali (+), stok baru berkurang (−), dan omset artikel ikut menyesuaikan.
              Sisa pasang yang belum ditukar masih bisa ditukar lagi selama ≤ 7 hari.
            </DialogDescription>
          </DialogHeader>

          {exchangeItem && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="font-semibold">{exchangeItem.article_name}</p>
                <p className="tabular mt-0.5 text-xs text-muted-foreground">
                  Uk. {exchangeItem.size} · {rupiah(exchangeItem.price)}/psg · sisa bisa ditukar{" "}
                  {angka(exchangeItem.qty)} psg
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide">
                  Berapa pasang yang ditukar?
                </Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={qtyTukar <= 1}
                    onClick={() => setQtyTukar((q) => Math.max(1, q - 1))}
                    data-testid="tukar-qty-minus"
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <span className="tabular w-10 text-center text-base font-bold" data-testid="tukar-qty-value">
                    {qtyTukar}
                  </span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={qtyTukar >= exchangeItem.qty}
                    onClick={() => setQtyTukar((q) => Math.min(exchangeItem.qty, q + 1))}
                    data-testid="tukar-qty-plus"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground">dari {angka(exchangeItem.qty)} psg</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wide">
                    Diganti menjadi (boleh campur)
                  </Label>
                  <Button
                    variant="outline"
                    size="xs"
                    className="gap-1"
                    onClick={() =>
                      setTargets((p) => [...p, { key: keyRef.current++, article_id: "", size: "", qty: 1 }])
                    }
                    data-testid="tukar-add-target"
                  >
                    <Plus className="size-3" /> Target
                  </Button>
                </div>

                {stockQuery.isLoading ? (
                  <SkeletonRows rows={2} testId="tukar-target-loading" />
                ) : (
                  <div className="space-y-2" data-testid="tukar-targets">
                    {targets.map((t, idx) => {
                      const row = stockRows.find((r) => r.article_id === t.article_id);
                      const readySizes = (row?.sizes ?? []).filter((s) => s.qty > 0);
                      const price = t.size ? priceOf(t.article_id, t.size) : null;
                      return (
                        <div
                          key={t.key}
                          className="space-y-2 rounded-lg border border-border bg-card p-2.5"
                          data-testid={`tukar-target-${idx}`}
                        >
                          <div className="flex items-center gap-2">
                            <Select
                              value={t.article_id}
                              onValueChange={(v: string) => patchTarget(t.key, { article_id: v, size: "" })}
                            >
                              <SelectTrigger className="h-9 flex-1" data-testid={`tukar-target-article-${idx}`}>
                                <SelectValue>
                                  {(v) =>
                                    stockRows.find((r) => r.article_id === (v as string))?.name ??
                                    "Pilih artikel pengganti"
                                  }
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {stockRows.map((r) => (
                                  <SelectItem
                                    key={r.article_id}
                                    value={r.article_id}
                                    data-testid={`tukar-target-option-${idx}-${r.code}`}
                                  >
                                    {r.code} — {r.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {targets.length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => setTargets((p) => p.filter((x) => x.key !== t.key))}
                                data-testid={`tukar-target-remove-${idx}`}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            )}
                          </div>

                          {t.article_id && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {readySizes.length === 0 ? (
                                <p className="text-xs text-muted-foreground">Semua ukuran habis.</p>
                              ) : (
                                readySizes.map((s) => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => patchTarget(t.key, { size: s.size })}
                                    data-testid={`tukar-target-size-${idx}-${s.size}`}
                                    className={cn(
                                      "tabular min-h-9 min-w-9 rounded-lg border px-2 py-1 text-xs font-semibold transition-transform duration-100 active:scale-95",
                                      t.size === s.size
                                        ? "border-sky-500 bg-sky-500 text-white"
                                        : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                                    )}
                                  >
                                    {s.size}
                                    <span className="ml-1 text-[10px] font-normal opacity-70">{s.qty}</span>
                                  </button>
                                ))
                              )}
                              <span className="ml-auto flex items-center gap-1 text-xs">
                                <Input
                                  inputMode="numeric"
                                  className="tabular h-8 w-14 text-center"
                                  value={String(t.qty)}
                                  onChange={(e) =>
                                    patchTarget(t.key, { qty: Math.max(1, parseUang(e.target.value) || 1) })
                                  }
                                  data-testid={`tukar-target-qty-${idx}`}
                                />
                                psg
                              </span>
                            </div>
                          )}

                          {price != null && (
                            <p className="tabular text-xs text-muted-foreground" data-testid={`tukar-target-price-${idx}`}>
                              {rupiah(price)}/psg · selisih {rupiah(price - exchangeItem.price)}/psg
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p
                  className={cn(
                    "text-xs",
                    totalTargetQty === qtyTukar ? "text-emerald-700" : "text-amber-700",
                  )}
                  data-testid="tukar-qty-balance"
                >
                  Total target {angka(totalTargetQty)} psg dari {angka(qtyTukar)} psg yang ditukar
                  {totalTargetQty !== qtyTukar && " — harus sama persis"}
                </p>
              </div>

              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total selisih</span>
                  <span
                    className={cn(
                      "tabular font-semibold",
                      diffTotal > 0 ? "text-red-600" : diffTotal < 0 ? "text-emerald-700" : "",
                    )}
                    data-testid="tukar-diff"
                  >
                    {diffTotal === 0
                      ? "Rp 0 (sama)"
                      : diffTotal > 0
                        ? `Pelanggan menambah ${rupiah(diffTotal)}`
                        : `Kasir mengembalikan ${rupiah(-diffTotal)}`}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {PAYMENTS.map((p) => (
                    <Button
                      key={p}
                      variant={payMethod === p ? "default" : "outline"}
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => setPayMethod(p)}
                      data-testid={`tukar-payment-${p}`}
                    >
                      {p}
                    </Button>
                  ))}
                </div>

                {diffTotal > 0 && payMethod === "TUNAI" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="diff-paid" className="text-xs font-semibold uppercase">
                      Uang selisih diterima
                    </Label>
                    <Input
                      id="diff-paid"
                      inputMode="numeric"
                      placeholder="0"
                      value={diffPaidText ? diffPaid.toLocaleString("id-ID") : ""}
                      onChange={(e) => setDiffPaidText(onlyDigits(e.target.value))}
                      className="tabular"
                      data-testid="tukar-diff-paid-input"
                    />
                    {diffPaid > diffTotal && (
                      <p className="tabular text-xs text-emerald-700">
                        Kembalian {rupiah(diffPaid - diffTotal)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={closeExchange}
                  data-testid="tukar-cancel-button"
                >
                  Batal
                </Button>
                <Button
                  className="flex-1"
                  disabled={!canSubmit}
                  onClick={() => exchange.mutate()}
                  data-testid="tukar-confirm-button"
                >
                  {exchange.isPending ? "Memproses…" : "Proses Tukar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ReceiptDialog
        tx={receipt}
        open={!!receipt}
        onOpenChange={(o) => !o && setReceipt(null)}
        defaultPhone={receipt?.customer_phone ?? ""}
      />
    </div>
  );
}
