import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { apiGet } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "@/components/Chrome";
import { useScope } from "@/hooks/useScope";
import { angka, pesanError, rupiah } from "@/lib/format";
import type { GrossProfit } from "@/lib/types";
import { cn } from "@/lib/utils";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function Laporan() {
  const { branchId } = useScope();
  const [groupBy, setGroupBy] = useState<"branch" | "article">("branch");
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [allBranches, setAllBranches] = useState(true);

  const q = useQuery({
    queryKey: ["gross-profit", groupBy, from, to, allBranches ? "" : branchId],
    queryFn: () =>
      apiGet<GrossProfit>(
        `/reports/gross-profit?group_by=${groupBy}&from=${from}&to=${to}${
          allBranches ? "" : `&branch_id=${encodeURIComponent(branchId)}`
        }`,
      ),
  });

  const rows = q.data?.rows ?? [];
  const totals = q.data?.totals;
  const margin = totals && totals.revenue > 0
    ? ((totals.profit / (totals.revenue - totals.discount || 1)) * 100).toFixed(1)
    : "0.0";

  return (
    <div>
      <PageHeader
        title="Laporan Laba Kotor"
        description="Omzet − diskon − harga modal. Transaksi TUKAR tidak dihitung sebagai penjualan, jadi laporan tidak dobel."
        testId="laporan-header"
      >
        <Badge variant="secondary" data-testid="laporan-admin-badge">
          Khusus Admin
        </Badge>
      </PageHeader>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <div className="space-y-1.5">
            <Label htmlFor="from" className="text-xs font-semibold uppercase">Dari</Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="tabular w-[160px]"
              data-testid="laporan-from-input"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to" className="text-xs font-semibold uppercase">Sampai</Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="tabular w-[160px]"
              data-testid="laporan-to-input"
            />
          </div>
          <Tabs value={groupBy} onValueChange={(v: string) => setGroupBy(v as "branch" | "article")}>
            <TabsList data-testid="laporan-group-tabs">
              <TabsTrigger value="branch" data-testid="laporan-group-branch">Per Cabang</TabsTrigger>
              <TabsTrigger value="article" data-testid="laporan-group-article">Per Artikel</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant={allBranches ? "default" : "outline"}
            size="sm"
            onClick={() => setAllBranches((v) => !v)}
            data-testid="laporan-scope-toggle"
          >
            {allBranches ? "Semua Cabang" : "Cabang Terpilih"}
          </Button>
        </CardContent>
      </Card>

      {q.isError && (
        <div className="mb-4">
          <ErrorNote message={pesanError(q.error, "Laporan belum bisa dimuat")} testId="laporan-error" />
        </div>
      )}

      {totals && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { l: "Omzet", v: rupiah(totals.revenue), t: "laporan-total-revenue" },
            { l: "Diskon", v: rupiah(totals.discount), t: "laporan-total-discount" },
            { l: "Modal (HPP)", v: rupiah(totals.cost), t: "laporan-total-cost" },
            { l: "Laba Kotor", v: rupiah(totals.profit), t: "laporan-total-profit" },
            { l: "Laba Bersih", v: rupiah(totals.net_profit), t: "laporan-total-net-profit" },
          ].map((x, i) => (
            <Card
              key={x.l}
              className={cn(
                i === 3 && "border-amber-300 bg-amber-50/60",
                i === 4 && "border-emerald-300 bg-emerald-50/60",
              )}
            >
              <CardContent className="pt-5">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {x.l}
                </p>
                <p className="tabular mt-1.5 text-xl font-semibold" data-testid={x.t}>
                  {x.v}
                </p>
                {i === 3 && (
                  <p className="mt-0.5 text-xs text-amber-700" data-testid="laporan-margin">
                    Margin {margin}%
                  </p>
                )}
                {i === 4 && (
                  <p className="mt-0.5 text-xs text-emerald-700" data-testid="laporan-expense-note">
                    Laba kotor − pengeluaran {rupiah(totals.expense)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {q.isLoading ? (
        <SkeletonRows rows={5} testId="laporan-loading" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Belum ada penjualan pada periode ini"
          description="Ubah rentang tanggal atau lakukan transaksi terlebih dahulu."
          icon={TrendingUp}
          testId="laporan-empty"
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table data-testid="laporan-table">
            <TableHeader>
              <TableRow>
                <TableHead>{groupBy === "branch" ? "Cabang" : "Artikel"}</TableHead>
                <TableHead className="text-right">Terjual</TableHead>
                <TableHead className="text-right">Omzet</TableHead>
                <TableHead className="text-right">Diskon</TableHead>
                <TableHead className="text-right">Modal</TableHead>
                <TableHead className="text-right">Laba Kotor</TableHead>
                {q.data?.expense_included && (
                  <>
                    <TableHead className="text-right">Pengeluaran</TableHead>
                    <TableHead className="text-right">Laba Bersih</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key} data-testid={`laporan-row-${r.key}`}>
                  <TableCell>
                    <p className="font-medium">{r.label}</p>
                    {groupBy === "article" && r.sublabel && (
                      <p className="tabular text-xs text-muted-foreground">{r.sublabel}</p>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">{angka(r.qty)}</TableCell>
                  <TableCell className="tabular text-right">{rupiah(r.revenue)}</TableCell>
                  <TableCell className="tabular text-right text-amber-700">
                    {r.discount ? `−${rupiah(r.discount)}` : "—"}
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {rupiah(r.cost)}
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold text-emerald-700">
                    {rupiah(r.profit)}
                  </TableCell>
                  {q.data?.expense_included && (
                    <>
                      <TableCell className="tabular text-right text-red-600">
                        {r.expense ? `−${rupiah(r.expense)}` : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular text-right font-bold",
                          r.net_profit >= 0 ? "text-emerald-700" : "text-red-600",
                        )}
                        data-testid={`laporan-net-${r.key}`}
                      >
                        {rupiah(r.net_profit)}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
            {totals && (
              <TableFooter>
                <TableRow data-testid="laporan-footer-total">
                  <TableCell className="font-bold">TOTAL</TableCell>
                  <TableCell className="tabular text-right font-bold">{angka(totals.qty)}</TableCell>
                  <TableCell className="tabular text-right font-bold">{rupiah(totals.revenue)}</TableCell>
                  <TableCell className="tabular text-right font-bold">
                    {totals.discount ? `−${rupiah(totals.discount)}` : "—"}
                  </TableCell>
                  <TableCell className="tabular text-right font-bold">{rupiah(totals.cost)}</TableCell>
                  <TableCell className="tabular text-right font-bold text-emerald-700">
                    {rupiah(totals.profit)}
                  </TableCell>
                  {q.data?.expense_included && (
                    <>
                      <TableCell className="tabular text-right font-bold text-red-600">
                        {totals.expense ? `−${rupiah(totals.expense)}` : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular text-right font-bold",
                          totals.net_profit >= 0 ? "text-emerald-700" : "text-red-600",
                        )}
                        data-testid="laporan-footer-net"
                      >
                        {rupiah(totals.net_profit)}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}
    </div>
  );
}
