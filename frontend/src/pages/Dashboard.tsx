import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  PackageX,
  Receipt,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { angka, formatTanggalSingkat, pesanError, rupiah } from "@/lib/format";
import type { Dashboard as DashboardData } from "@/lib/types";

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  testId: string;
}) {
  return (
    <Card className="relative overflow-hidden" data-testid={testId}>
      <div className={`absolute inset-x-0 top-0 h-1 ${accent}`} />
      <CardContent className="flex items-start justify-between gap-3 pt-5">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="tabular mt-2 truncate text-2xl font-semibold">{value}</p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className="rounded-lg bg-muted p-2">
          <Icon className="size-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { branchId, branchName, isAdmin } = useScope();

  const q = useQuery({
    queryKey: ["dashboard", branchId],
    queryFn: () => apiGet<DashboardData>(`/reports/dashboard${branchQuery(branchId)}`),
    enabled: !!branchId,
  });

  const d = q.data;
  const chartData = (d?.trend ?? []).map((t) => ({
    label: formatTanggalSingkat(t.date),
    total: t.total,
  }));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Ringkasan penjualan hari ini — ${branchName}`}
        testId="dashboard-header"
      >
        <Badge variant="secondary" data-testid="dashboard-branch-badge">
          {branchName}
        </Badge>
      </PageHeader>

      {q.isError && (
        <div className="mb-4">
          <ErrorNote
            message={pesanError(q.error, "Data dashboard belum bisa dimuat")}
            testId="dashboard-error"
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Transaksi Hari Ini"
          value={angka(d?.today.count ?? 0)}
          sub={`${angka(d?.today.items ?? 0)} pasang terjual`}
          icon={Receipt}
          accent="bg-sky-500"
          testId="metric-transactions"
        />
        <MetricCard
          label="Omzet Hari Ini"
          value={rupiah(d?.today.revenue ?? 0)}
          sub="Penjualan saja (tukar tidak dihitung)"
          icon={Banknote}
          accent="bg-teal-500"
          testId="metric-revenue"
        />
        {isAdmin ? (
          <MetricCard
            label="Laba Kotor Hari Ini"
            value={rupiah(d?.today.profit ?? 0)}
            sub="Omzet − diskon − modal"
            icon={TrendingUp}
            accent="bg-amber-500"
            testId="metric-profit"
          />
        ) : (
          <MetricCard
            label="Pasang Terjual"
            value={angka(d?.today.items ?? 0)}
            sub="Hari ini di cabang Anda"
            icon={ShoppingBag}
            accent="bg-amber-500"
            testId="metric-items"
          />
        )}
        <MetricCard
          label="Ukuran Habis"
          value={angka(d?.out_of_stock ?? 0)}
          sub="Perlu restok segera"
          icon={PackageX}
          accent="bg-rose-500"
          testId="metric-out-of-stock"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" data-testid="trend-card">
          <CardHeader>
            <CardTitle className="font-heading text-base">Omzet 7 Hari Terakhir</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px]">
            {q.isLoading ? (
              <SkeletonRows rows={3} testId="trend-loading" />
            ) : chartData.length === 0 ? (
              <EmptyState title="Belum ada data penjualan" icon={Receipt} testId="trend-empty" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: -12, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748B" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(value: number) => [rupiah(value), "Omzet"]}
                    labelFormatter={(label: string) => `Tanggal ${label}`}
                    contentStyle={{ borderRadius: 10, fontSize: 12, borderColor: "#E2E8F0" }}
                  />
                  <Bar dataKey="total" fill="#0284C7" radius={[6, 6, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2" data-testid="best-sellers-card">
          <CardHeader>
            <CardTitle className="font-heading text-base">Produk Terlaris (30 Hari)</CardTitle>
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <SkeletonRows rows={4} testId="best-sellers-loading" />
            ) : (d?.best_sellers.length ?? 0) === 0 ? (
              <EmptyState
                title="Belum ada produk terjual"
                description="Data muncul setelah transaksi pertama."
                icon={ShoppingBag}
                testId="best-sellers-empty"
              />
            ) : (
              <ol className="space-y-2" data-testid="best-sellers-list">
                {d!.best_sellers.map((b, i) => (
                  <li
                    key={b.article_id}
                    className="flex items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2 transition-colors duration-150 hover:border-sky-300"
                    data-testid={`best-seller-${i}`}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sky-100 text-xs font-bold text-sky-700">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {b.article_name}
                    </span>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">
                      {angka(b.qty)} psg
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4" data-testid="low-stock-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading text-base">
            <AlertTriangle className="size-4 text-amber-500" /> Stok Menipis (≤ 5 pasang)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <SkeletonRows rows={4} testId="low-stock-loading" />
          ) : (d?.low_stock.length ?? 0) === 0 ? (
            <EmptyState
              title="Semua stok aman"
              description="Tidak ada ukuran di bawah 5 pasang."
              icon={PackageX}
              testId="low-stock-empty"
            />
          ) : (
            <Table data-testid="low-stock-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Artikel</TableHead>
                  <TableHead>Kode</TableHead>
                  <TableHead>Ukuran</TableHead>
                  <TableHead className="text-right">Sisa</TableHead>
                  <TableHead className="text-right">Harga Jual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d!.low_stock.map((s) => (
                  <TableRow key={s.id} data-testid={`low-stock-row-${s.id}`}>
                    <TableCell className="font-medium">{s.article_name}</TableCell>
                    <TableCell className="tabular text-xs text-muted-foreground">
                      {s.article_code}
                    </TableCell>
                    <TableCell className="tabular">{s.size}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={s.qty === 0 ? "destructive" : "secondary"}
                        className="tabular"
                        data-testid={`low-stock-qty-${s.id}`}
                      >
                        {s.qty === 0 ? "Habis" : `${s.qty} psg`}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular text-right text-sm">
                      {rupiah(s.selling_price)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
