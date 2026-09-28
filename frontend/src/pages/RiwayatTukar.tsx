import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Repeat } from "lucide-react";
import { apiGet } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "@/components/Chrome";
import { branchQuery, useScope } from "@/hooks/useScope";
import { angka, formatTanggal, pesanError, rupiah } from "@/lib/format";
import type { ExchangeLine, ExchangeRecord, Paged } from "@/lib/types";
import { cn } from "@/lib/utils";

function lineDiff(l: ExchangeLine): number {
  return l.targets.reduce((s, t) => s + t.qty * (t.price - l.price), 0);
}

export default function RiwayatTukar() {
  const { branchId, branchName } = useScope();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ["exchanges", branchId, fromDate, toDate, page],
    queryFn: () =>
      apiGet<Paged<ExchangeRecord>>(
        `/exchanges${branchQuery(branchId)}${branchId ? "&" : "?"}page=${page}&page_size=20${
          fromDate || toDate ? `&from=${fromDate || toDate}&to=${toDate || fromDate}` : ""
        }`,
      ),
    enabled: !!branchId,
    refetchInterval: 10_000,
  });

  const items = q.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 20));

  return (
    <div>
      <PageHeader
        title="Riwayat Tukar"
        description={`Ringkasan setiap penukaran di ${branchName} — dari artikel/ukuran apa, jadi apa, dan selisih uangnya.`}
        testId="riwayat-tukar-header"
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5" data-testid="riwayat-tukar-filter">
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
          data-testid="riwayat-tukar-date-from"
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
          data-testid="riwayat-tukar-date-to"
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
            data-testid="riwayat-tukar-date-clear"
          >
            Reset
          </Button>
        )}
      </div>

      {q.isError && (
        <div className="mb-4">
          <ErrorNote
            message={pesanError(q.error, "Riwayat tukar belum bisa dimuat")}
            testId="riwayat-tukar-error"
          />
        </div>
      )}

      {q.isLoading ? (
        <SkeletonRows rows={4} testId="riwayat-tukar-loading" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Belum ada penukaran"
          description="Setiap kali kasir memproses tukar barang, ringkasannya muncul di sini."
          icon={Repeat}
          testId="riwayat-tukar-empty"
        />
      ) : (
        <div className="space-y-3" data-testid="riwayat-tukar-list">
          {items.map((ex) => {
            const totalPasang = ex.lines.reduce((s, l) => s + l.qty, 0);
            return (
              <Card key={ex.id} data-testid={`riwayat-tukar-row-${ex.id}`}>
                <CardContent className="pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Repeat className="size-4 text-amber-600" />
                        <span className="tabular font-heading text-sm font-bold">
                          {ex.receipt_no}
                        </span>
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-50 text-[10px] text-amber-700"
                        >
                          {angka(totalPasang)} pasang
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatTanggal(ex.created_at)} · {ex.by_name} · {ex.branch_name} ·{" "}
                        {ex.payment_method}
                      </p>
                    </div>
                    <div className="text-right">
                      <span
                        className={cn(
                          "tabular block text-base font-bold",
                          ex.total_diff > 0
                            ? "text-red-600"
                            : ex.total_diff < 0
                              ? "text-emerald-700"
                              : "text-muted-foreground",
                        )}
                        data-testid={`riwayat-tukar-diff-${ex.id}`}
                      >
                        {ex.total_diff === 0
                          ? "Rp 0"
                          : ex.total_diff > 0
                            ? `+${rupiah(ex.total_diff)}`
                            : `-${rupiah(-ex.total_diff)}`}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {ex.total_diff > 0
                          ? "pelanggan menambah"
                          : ex.total_diff < 0
                            ? "kasir mengembalikan"
                            : "tanpa selisih"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    {ex.lines.map((l, li) => {
                      const d = lineDiff(l);
                      return (
                        <div
                          key={`${ex.id}-${li}`}
                          className="rounded-lg bg-muted/40 p-2.5"
                          data-testid={`riwayat-tukar-line-${ex.id}-${li}`}
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                            <span className="rounded-md bg-rose-50 px-2 py-0.5 text-rose-700">
                              <span className="font-medium">{l.article_name}</span>{" "}
                              <span className="tabular text-xs">
                                uk. {l.size} · {rupiah(l.price)}
                              </span>
                            </span>
                            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                            <span className="flex flex-wrap gap-1">
                              {l.targets.map((t, ti) => (
                                <span
                                  key={`${ex.id}-${li}-${ti}`}
                                  className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-700"
                                  data-testid={`riwayat-tukar-target-${ex.id}-${li}-${ti}`}
                                >
                                  <span className="font-medium">{t.article_name}</span>{" "}
                                  <span className="tabular text-xs">
                                    uk. {t.size} × {angka(t.qty)} · {rupiah(t.price)}
                                  </span>
                                </span>
                              ))}
                            </span>
                            <span
                              className={cn(
                                "tabular ml-auto text-xs font-semibold",
                                d > 0 ? "text-red-600" : d < 0 ? "text-emerald-700" : "text-muted-foreground",
                              )}
                            >
                              selisih {d >= 0 ? "+" : "-"}
                              {rupiah(Math.abs(d))}
                            </span>
                          </div>
                        </div>
                      );
                    })}
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
                data-testid="riwayat-tukar-prev"
              >
                Sebelumnya
              </Button>
              <span
                className="tabular text-sm text-muted-foreground"
                data-testid="riwayat-tukar-page-info"
              >
                Halaman {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                data-testid="riwayat-tukar-next"
              >
                Berikutnya
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
