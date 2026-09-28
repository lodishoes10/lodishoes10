import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Check, X } from "lucide-react";
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
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "@/components/Chrome";
import { PromptDialog, usePromptDialog } from "@/components/PromptDialog";
import { branchQuery, useScope } from "@/hooks/useScope";
import { useBranches } from "@/hooks/useAuth";
import { formatTanggal, onlyDigits, parseUang, pesanError } from "@/lib/format";
import type { StockRow, Transfer, TransferStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<TransferStatus, string> = {
  MENUNGGU: "Menunggu Persetujuan",
  DISETUJUI: "Disetujui",
  DITOLAK: "Ditolak",
};

const STATUS_STYLE: Record<TransferStatus, string> = {
  MENUNGGU: "border-amber-300 bg-amber-50 text-amber-700",
  DISETUJUI: "border-emerald-300 bg-emerald-50 text-emerald-700",
  DITOLAK: "border-rose-300 bg-rose-50 text-rose-700",
};

export default function TransferStok() {
  const { branchId, branchName, isAdmin } = useScope();
  const qc = useQueryClient();
  const prompt = usePromptDialog();
  const [toBranch, setToBranch] = useState("");
  const [articleId, setArticleId] = useState("");
  const [size, setSize] = useState("");
  const [qtyText, setQtyText] = useState("1");
  const [note, setNote] = useState("");

  const { data: branches } = useBranches();
  const targets = (branches ?? []).filter((b) => b.id !== branchId);

  const stockQuery = useQuery({
    queryKey: ["stock-matrix", branchId],
    queryFn: () => apiGet<StockRow[]>(`/stock/matrix${branchQuery(branchId)}`),
    enabled: !!branchId,
  });

  const listQuery = useQuery({
    queryKey: ["transfers", branchId],
    queryFn: () => apiGet<Transfer[]>(`/transfers${branchQuery(branchId)}`),
    enabled: !!branchId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["transfers", branchId] });
    qc.invalidateQueries({ queryKey: ["stock-matrix", branchId] });
    qc.invalidateQueries({ queryKey: ["dashboard", branchId] });
  };

  const rows = stockQuery.data ?? [];
  const selectedRow = rows.find((r) => r.article_id === articleId);
  const sizes = useMemo(() => (selectedRow?.sizes ?? []).filter((s) => s.qty > 0), [selectedRow]);
  const selectedSize = sizes.find((s) => s.size === size);
  const qty = parseUang(qtyText) || 0;

  const create = useMutation({
    mutationFn: () =>
      apiPost<Transfer>("/transfers", {
        from_branch_id: branchId,
        to_branch_id: toBranch,
        items: [{ article_id: articleId, size, qty }],
        note,
      }),
    onSuccess: (t) => {
      toast.success(`Pengajuan transfer ke ${t.to_branch_name} terkirim — menunggu persetujuan admin`);
      setArticleId("");
      setSize("");
      setQtyText("1");
      setNote("");
      invalidate();
    },
    onError: (e) => toast.error(pesanError(e, "Pengajuan transfer gagal")),
  });

  const approve = useMutation({
    mutationFn: (id: string) => apiPost<Transfer>(`/transfers/${id}/approve`),
    onSuccess: (t) => {
      toast.success(`Transfer ke ${t.to_branch_name} disetujui — stok sudah berpindah`);
      invalidate();
    },
    onError: (e) => toast.error(pesanError(e, "Gagal menyetujui transfer")),
  });

  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      apiPost<Transfer>(`/transfers/${v.id}/reject`, { reason: v.reason }),
    onSuccess: () => {
      toast.success("Transfer ditolak — stok tidak berubah");
      invalidate();
    },
    onError: (e) => toast.error(pesanError(e, "Gagal menolak transfer")),
  });

  const valid =
    !!toBranch && !!articleId && !!size && qty > 0 && qty <= (selectedSize?.qty ?? 0);

  return (
    <div>
      <PageHeader
        title="Transfer Stok"
        description={`Ajukan pemindahan stok dari ${branchName} ke cabang lain. Stok baru berpindah setelah admin menyetujui.`}
        testId="transfer-header"
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" data-testid="transfer-form-card">
          <CardHeader>
            <CardTitle className="font-heading text-base">Ajukan Transfer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide">Cabang Tujuan</Label>
              <Select value={toBranch} onValueChange={setToBranch}>
                <SelectTrigger data-testid="transfer-target-select">
                  <SelectValue>
                    {(v) => targets.find((b) => b.id === (v as string))?.name ?? "Pilih cabang tujuan"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {targets.map((b) => (
                    <SelectItem key={b.id} value={b.id} data-testid={`transfer-target-${b.code}`}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide">Artikel</Label>
              <Select
                value={articleId}
                onValueChange={(v: string) => {
                  setArticleId(v);
                  setSize("");
                }}
              >
                <SelectTrigger data-testid="transfer-article-select">
                  <SelectValue>
                    {(v) => rows.find((r) => r.article_id === (v as string))?.name ?? "Pilih artikel"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {rows.map((r) => (
                    <SelectItem key={r.article_id} value={r.article_id} data-testid={`transfer-article-${r.code}`}>
                      {r.code} — {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedRow && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide">
                  Ukuran (hanya yang tersedia)
                </Label>
                {sizes.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="transfer-no-size">
                    Tidak ada ukuran bersisa untuk artikel ini.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5" data-testid="transfer-size-options">
                    {sizes.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSize(s.size)}
                        data-testid={`transfer-size-${s.size}`}
                        className={cn(
                          "tabular min-h-11 min-w-11 rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition-transform duration-100 active:scale-95",
                          size === s.size
                            ? "border-sky-500 bg-sky-500 text-white"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                        )}
                      >
                        {s.size}
                        <span className="ml-1 text-[10px] font-normal opacity-70">{s.qty}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="t-qty" className="text-xs font-semibold uppercase">
                Jumlah {selectedSize ? `(maks ${selectedSize.qty})` : ""}
              </Label>
              <Input
                id="t-qty"
                inputMode="numeric"
                value={qtyText}
                onChange={(e) => setQtyText(onlyDigits(e.target.value))}
                className="tabular"
                data-testid="transfer-qty-input"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="t-note" className="text-xs font-semibold uppercase">Catatan</Label>
              <Input
                id="t-note"
                placeholder="opsional"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="transfer-note-input"
              />
            </div>

            <Button
              className="w-full"
              disabled={!valid || create.isPending}
              onClick={() => create.mutate()}
              data-testid="transfer-submit-button"
            >
              {create.isPending ? "Memproses…" : "Ajukan Transfer"}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3" data-testid="transfer-history-card">
          <CardHeader>
            <CardTitle className="font-heading text-base">Daftar Transfer</CardTitle>
          </CardHeader>
          <CardContent>
            {listQuery.isError && (
              <div className="mb-3">
                <ErrorNote
                  message={pesanError(listQuery.error, "Riwayat transfer belum bisa dimuat")}
                  testId="transfer-error"
                />
              </div>
            )}
            {listQuery.isLoading ? (
              <SkeletonRows rows={4} testId="transfer-loading" />
            ) : (listQuery.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="Belum ada transfer"
                icon={ArrowLeftRight}
                testId="transfer-empty"
              />
            ) : (
              <ul className="space-y-2" data-testid="transfer-list">
                {listQuery.data!.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-border bg-card p-3"
                    data-testid={`transfer-row-${t.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary" className="text-[10px]">
                        {t.from_branch_name}
                      </Badge>
                      <ArrowLeftRight className="size-3.5 text-muted-foreground" />
                      <Badge variant="secondary" className="text-[10px]">
                        {t.to_branch_name}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", STATUS_STYLE[t.status])}
                        data-testid={`transfer-status-${t.id}`}
                      >
                        {STATUS_LABEL[t.status]}
                      </Badge>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatTanggal(t.created_at)}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-0.5">
                      {t.items.map((it, i) => (
                        <li key={i} className="tabular text-xs text-muted-foreground">
                          {it.article_name} · Uk. {it.size} × {it.qty}
                        </li>
                      ))}
                    </ul>
                    {t.note && <p className="mt-1 text-xs italic text-muted-foreground">{t.note}</p>}
                    {t.status === "DITOLAK" && t.reject_reason && (
                      <p className="mt-1 text-xs text-rose-600" data-testid={`transfer-reason-${t.id}`}>
                        Alasan: {t.reject_reason}
                      </p>
                    )}
                    {t.status !== "MENUNGGU" && t.decided_by_name && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        oleh {t.decided_by_name}
                        {t.decided_at ? ` · ${formatTanggal(t.decided_at)}` : ""}
                      </p>
                    )}
                    {isAdmin && t.status === "MENUNGGU" && (
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="xs"
                          className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
                          disabled={approve.isPending || reject.isPending}
                          onClick={() => approve.mutate(t.id)}
                          data-testid={`transfer-approve-${t.id}`}
                        >
                          <Check className="size-3" /> Setujui
                        </Button>
                        <Button
                          variant="outline"
                          size="xs"
                          className="gap-1 border-rose-300 text-rose-700 hover:bg-rose-50"
                          disabled={approve.isPending || reject.isPending}
                          onClick={() =>
                            prompt.open({
                              title: "Tolak Transfer",
                              description: `${t.from_branch_name} → ${t.to_branch_name}. Stok tidak akan berpindah.`,
                              label: "Alasan penolakan (opsional)",
                              onSubmit: (v) => reject.mutate({ id: t.id, reason: v.trim() }),
                            })
                          }
                          data-testid={`transfer-reject-${t.id}`}
                        >
                          <X className="size-3" /> Tolak
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <PromptDialog control={prompt} />
    </div>
  );
}
