import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Barcode, Printer } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "@/components/Chrome";
import { onlyDigits, parseUang, pesanError } from "@/lib/format";
import type { Article, Paged } from "@/lib/types";
import { cn } from "@/lib/utils";

const COL_OPTIONS = [1, 2, 3];

/** Halaman label barcode siap cetak — pilih artikel, jumlah per label, dan layout 1/2/3 kolom. */
export default function Label() {
  const qc = useQueryClient();
  const [cols, setCols] = useState(2);
  const [selected, setSelected] = useState<Record<string, number>>({});

  const q = useQuery({
    queryKey: ["articles", "label"],
    queryFn: () => apiGet<Paged<Article>>("/articles?page_size=500"),
  });

  // Artikel tanpa barcode otomatis diberi nomor barcode unik oleh server saat dipilih.
  const ensure = useMutation({
    mutationFn: (id: string) => apiPost<{ barcode: string }>(`/articles/${id}/barcode`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["articles"] }),
    onError: (e) => toast.error(pesanError(e, "Gagal membuat barcode")),
  });

  const items = q.data?.items ?? [];
  const labels = items.flatMap((a) => {
    const n = selected[a.id] ?? 0;
    return n > 0 ? Array.from({ length: n }, (_, i) => ({ article: a, key: `${a.id}-${i}` })) : [];
  });

  const toggle = (a: Article, on: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (on) next[a.id] = next[a.id] ?? 1;
      else delete next[a.id];
      return next;
    });
    if (on && !a.barcode) ensure.mutate(a.id);
  };

  const setCopies = (id: string, text: string) => {
    const n = Math.max(1, Math.min(60, parseUang(text) || 1));
    setSelected((prev) => (prev[id] ? { ...prev, [id]: n } : prev));
  };

  return (
    <div>
      <PageHeader
        title="Label Barcode"
        description="Pilih artikel & jumlah stiker, atur kolom, lalu cetak. Barcode dibuat otomatis untuk artikel yang belum punya."
        testId="label-header"
      >
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card p-1" data-testid="label-cols-picker">
          {COL_OPTIONS.map((c) => (
            <Button
              key={c}
              variant={cols === c ? "default" : "ghost"}
              size="xs"
              className="tabular"
              onClick={() => setCols(c)}
              data-testid={`label-cols-${c}`}
            >
              {c} kolom
            </Button>
          ))}
        </div>
        <Button
          className="gap-2"
          disabled={labels.length === 0}
          onClick={() => window.print()}
          data-testid="label-print-button"
        >
          <Printer className="size-4" /> Cetak {labels.length > 0 ? `${labels.length} Label` : "Label"}
        </Button>
      </PageHeader>

      {q.isError && (
        <div className="mb-4">
          <ErrorNote message={pesanError(q.error, "Daftar artikel belum bisa dimuat")} testId="label-error" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="no-print lg:col-span-2" data-testid="label-picker-card">
          <CardContent className="pt-4">
            {q.isLoading ? (
              <SkeletonRows rows={4} testId="label-loading" />
            ) : items.length === 0 ? (
              <EmptyState title="Belum ada artikel" icon={Barcode} testId="label-empty" />
            ) : (
              <ul className="space-y-2" data-testid="label-article-list">
                {items.map((a) => {
                  const on = !!selected[a.id];
                  return (
                    <li
                      key={a.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-2.5 transition-colors duration-150",
                        on ? "border-sky-400 bg-sky-50" : "border-border bg-card",
                      )}
                      data-testid={`label-article-${a.code}`}
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={(c) => toggle(a, c === true)}
                        data-testid={`label-check-${a.code}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{a.name}</p>
                        <p className="tabular text-xs text-muted-foreground">
                          {a.code} · {a.barcode || "barcode dibuat otomatis"}
                        </p>
                      </div>
                      {on && (
                        <Input
                          inputMode="numeric"
                          className="tabular h-8 w-16 text-center"
                          value={String(selected[a.id])}
                          onChange={(e) => setCopies(a.id, onlyDigits(e.target.value))}
                          title="Jumlah stiker"
                          data-testid={`label-copies-${a.code}`}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3" data-testid="label-preview-card">
          <CardContent className="pt-4">
            <div className="no-print mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Pratinjau Cetak (A4)</p>
              <Badge variant="secondary" className="tabular" data-testid="label-total-badge">
                {labels.length} label · {cols} kolom
              </Badge>
            </div>
            {labels.length === 0 ? (
              <div className="no-print">
                <EmptyState
                  title="Belum ada label dipilih"
                  description="Centang artikel di sebelah kiri untuk menambah stiker ke halaman cetak."
                  icon={Barcode}
                  testId="label-preview-empty"
                />
              </div>
            ) : (
              <div
                id="label-print"
                style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "3mm" }}
                data-testid="label-print-area"
              >
                {labels.map(({ article: a, key }) => (
                  <div
                    key={key}
                    className="label-cell"
                    style={{
                      border: "1px dashed #94A3B8",
                      borderRadius: "2mm",
                      padding: "2.5mm 2mm",
                      textAlign: "center",
                      breakInside: "avoid",
                      background: "#fff",
                      color: "#0F172A",
                    }}
                  >
                    <p style={{ fontSize: "8pt", fontWeight: 700, lineHeight: 1.2 }}>{a.name}</p>
                    <p style={{ fontSize: "7pt", color: "#64748B" }}>{a.code}</p>
                    <img
                      src={`/api/articles/${a.id}/barcode.png`}
                      alt={a.barcode || a.code}
                      loading="lazy"
                      style={{ width: "100%", maxWidth: "52mm", height: "auto", margin: "1mm auto 0" }}
                    />
                    <p className="tabular" style={{ fontSize: "7pt", letterSpacing: "1.5px" }}>
                      {a.barcode}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
