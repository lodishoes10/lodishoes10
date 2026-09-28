import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "@/components/Chrome";
import { branchQuery, useScope } from "@/hooks/useScope";
import { formatTanggal, onlyDigits, pesanError } from "@/lib/format";
import type { Opname, StockRow } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function OpnamePage() {
  const { branchId, branchName } = useScope();
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const stockQuery = useQuery({
    queryKey: ["stock-matrix", branchId],
    queryFn: () => apiGet<StockRow[]>(`/stock/matrix${branchQuery(branchId)}`),
    enabled: !!branchId,
  });

  const listQuery = useQuery({
    queryKey: ["opnames", branchId],
    queryFn: () => apiGet<Opname[]>(`/opnames${branchQuery(branchId)}`),
    enabled: !!branchId,
  });

  const flat = useMemo(
    () =>
      (stockQuery.data ?? []).flatMap((r) =>
        r.sizes.map((s) => ({
          stock_id: s.id,
          name: r.name,
          code: r.code,
          size: s.size,
          qty: s.qty,
        })),
      ),
    [stockQuery.data],
  );

  const changed = flat.filter(
    (f) => counts[f.stock_id] !== undefined && counts[f.stock_id] !== "" && Number(counts[f.stock_id]) !== f.qty,
  );

  const submit = useMutation({
    mutationFn: () =>
      apiPost<Opname>("/opnames", {
        branch_id: branchId,
        items: changed.map((c) => ({
          stock_id: c.stock_id,
          counted_qty: Number(counts[c.stock_id]),
        })),
        note,
      }),
    onSuccess: () => {
      toast.success("Opname tersimpan & stok disesuaikan");
      setCounts({});
      setNote("");
      qc.invalidateQueries({ queryKey: ["opnames", branchId] });
      qc.invalidateQueries({ queryKey: ["stock-matrix", branchId] });
      qc.invalidateQueries({ queryKey: ["dashboard", branchId] });
    },
    onError: (e) => toast.error(pesanError(e, "Opname gagal disimpan")),
  });

  return (
    <div>
      <PageHeader
        title="Stock Opname"
        description={`Hitung fisik stok ${branchName}. Isi hanya ukuran yang selisih — sisanya dibiarkan kosong.`}
        testId="opname-header"
      >
        <Badge variant="secondary" data-testid="opname-changed-count">
          {changed.length} selisih
        </Badge>
      </PageHeader>

      {stockQuery.isError && (
        <div className="mb-4">
          <ErrorNote message={pesanError(stockQuery.error, "Stok belum bisa dimuat")} testId="opname-error" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="opname-form-card">
          <CardHeader>
            <CardTitle className="font-heading text-base">Hitung Fisik</CardTitle>
          </CardHeader>
          <CardContent>
            {stockQuery.isLoading ? (
              <SkeletonRows rows={5} testId="opname-loading" />
            ) : flat.length === 0 ? (
              <EmptyState title="Belum ada stok untuk dihitung" icon={ClipboardCheck} testId="opname-empty" />
            ) : (
              <>
                <div className="max-h-[52svh] overflow-y-auto">
                  <Table data-testid="opname-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Artikel</TableHead>
                        <TableHead>Uk.</TableHead>
                        <TableHead className="text-right">Sistem</TableHead>
                        <TableHead className="w-24 text-right">Fisik</TableHead>
                        <TableHead className="text-right">Selisih</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {flat.map((f) => {
                        const raw = counts[f.stock_id];
                        const diff = raw === undefined || raw === "" ? null : Number(raw) - f.qty;
                        return (
                          <TableRow key={f.stock_id} data-testid={`opname-row-${f.code}-${f.size}`}>
                            <TableCell className="text-sm font-medium">{f.name}</TableCell>
                            <TableCell className="tabular text-sm">{f.size}</TableCell>
                            <TableCell className="tabular text-right text-sm">{f.qty}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                inputMode="numeric"
                                placeholder="—"
                                value={raw ?? ""}
                                onChange={(e) =>
                                  setCounts((p) => ({
                                    ...p,
                                    [f.stock_id]: onlyDigits(e.target.value),
                                  }))
                                }
                                className="tabular h-9 w-20 text-right"
                                data-testid={`opname-input-${f.code}-${f.size}`}
                              />
                            </TableCell>
                            <TableCell
                              className={cn(
                                "tabular text-right text-sm font-semibold",
                                diff === null
                                  ? "text-muted-foreground"
                                  : diff === 0
                                    ? "text-muted-foreground"
                                    : diff > 0
                                      ? "text-emerald-700"
                                      : "text-red-600",
                              )}
                              data-testid={`opname-diff-${f.code}-${f.size}`}
                            >
                              {diff === null ? "—" : diff > 0 ? `+${diff}` : diff}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Input
                    placeholder="Catatan opname (opsional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="min-w-[200px] flex-1"
                    data-testid="opname-note-input"
                  />
                  <Button
                    disabled={changed.length === 0 || submit.isPending}
                    onClick={() => submit.mutate()}
                    data-testid="opname-submit-button"
                  >
                    {submit.isPending ? "Menyimpan…" : `Simpan ${changed.length} Selisih`}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="opname-history-card">
          <CardHeader>
            <CardTitle className="font-heading text-base">Riwayat Opname</CardTitle>
          </CardHeader>
          <CardContent>
            {listQuery.isLoading ? (
              <SkeletonRows rows={3} testId="opname-history-loading" />
            ) : (listQuery.data?.length ?? 0) === 0 ? (
              <EmptyState title="Belum ada opname" icon={ClipboardCheck} testId="opname-history-empty" />
            ) : (
              <ul className="space-y-2" data-testid="opname-history-list">
                {listQuery.data!.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-lg border border-border p-3"
                    data-testid={`opname-history-${o.id}`}
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatTanggal(o.created_at)}</span>
                      <span>{o.created_by_name}</span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {o.items.map((it, i) => (
                        <li key={i} className="tabular text-xs">
                          {it.article_name} uk.{it.size}: {it.system_qty} →{" "}
                          <span className="font-semibold">{it.counted_qty}</span>{" "}
                          <span className={it.diff > 0 ? "text-emerald-700" : "text-red-600"}>
                            ({it.diff > 0 ? `+${it.diff}` : it.diff})
                          </span>
                        </li>
                      ))}
                    </ul>
                    {o.note && <p className="mt-1 text-xs italic text-muted-foreground">{o.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
