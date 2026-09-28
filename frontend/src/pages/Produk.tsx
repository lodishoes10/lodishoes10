import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Store } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "@/components/Chrome";
import { PromptDialog, usePromptDialog } from "@/components/PromptDialog";
import { onlyDigits, parseUang, pesanError, rupiah } from "@/lib/format";
import type { Article, Paged } from "@/lib/types";

export default function Produk() {
  const qc = useQueryClient();
  const prompt = usePromptDialog();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("Lodi");
  const [category, setCategory] = useState("Sneakers");
  const [costText, setCostText] = useState("");

  const q = useQuery({
    queryKey: ["articles", "admin"],
    queryFn: () => apiGet<Paged<Article>>("/articles?page_size=200&include_inactive=true"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<Article>("/articles", {
        code,
        name,
        brand,
        category,
        cost_price: parseUang(costText),
      }),
    onSuccess: (a) => {
      toast.success(`Artikel ${a.code} dibuat`);
      setOpen(false);
      setCode("");
      setName("");
      setCostText("");
      qc.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: (e) => toast.error(pesanError(e, "Gagal membuat artikel")),
  });

  const patchCost = useMutation({
    mutationFn: (v: { id: string; cost_price: number }) =>
      apiPatch<Article>(`/articles/${v.id}`, { cost_price: v.cost_price }),
    onSuccess: () => {
      toast.success("Harga modal diperbarui");
      qc.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: (e) => toast.error(pesanError(e, "Gagal memperbarui modal")),
  });

  const items = q.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Master Produk"
        description="Kelola artikel dan harga modal (harga pokok). Hanya admin yang bisa melihat & mengisi modal."
        testId="produk-header"
      >
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2" data-testid="produk-add-open-button">
                <Plus className="size-4" /> Artikel Baru
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md" data-testid="produk-add-dialog">
            <DialogHeader>
              <DialogTitle className="font-heading">Artikel Baru</DialogTitle>
              <DialogDescription>
                Kode artikel harus unik. Stok per ukuran ditambahkan dari menu Stok.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="p-code" className="text-xs font-semibold uppercase">Kode</Label>
                  <Input
                    id="p-code"
                    placeholder="LS-007"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="tabular"
                    data-testid="produk-code-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-brand" className="text-xs font-semibold uppercase">Brand</Label>
                  <Input
                    id="p-brand"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    data-testid="produk-brand-input"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-name" className="text-xs font-semibold uppercase">Nama Artikel</Label>
                <Input
                  id="p-name"
                  placeholder="Lodi Runner Merah"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="produk-name-input"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="p-cat" className="text-xs font-semibold uppercase">Kategori</Label>
                  <Input
                    id="p-cat"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    data-testid="produk-category-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-cost" className="text-xs font-semibold uppercase">
                    Harga Modal
                  </Label>
                  <Input
                    id="p-cost"
                    inputMode="numeric"
                    placeholder="0"
                    value={costText ? parseUang(costText).toLocaleString("id-ID") : ""}
                    onChange={(e) => setCostText(onlyDigits(e.target.value))}
                    className="tabular"
                    data-testid="produk-cost-input"
                  />
                </div>
              </div>
              <Button
                className="w-full"
                disabled={code.length < 2 || name.length < 2 || create.isPending}
                onClick={() => create.mutate()}
                data-testid="produk-submit-button"
              >
                {create.isPending ? "Menyimpan…" : "Simpan Artikel"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {q.isError && (
        <div className="mb-4">
          <ErrorNote message={pesanError(q.error, "Daftar artikel belum bisa dimuat")} testId="produk-error" />
        </div>
      )}

      {q.isLoading ? (
        <SkeletonRows rows={5} testId="produk-loading" />
      ) : items.length === 0 ? (
        <EmptyState title="Belum ada artikel" icon={Store} testId="produk-empty" />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table data-testid="produk-table">
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead className="text-right">Harga Modal</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id} data-testid={`produk-row-${a.code}`}>
                  <TableCell className="tabular font-semibold">{a.code}</TableCell>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.brand || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.category || "—"}
                  </TableCell>
                  <TableCell data-testid={`produk-barcode-${a.code}`}>
                    <img
                      src={`/api/articles/${a.id}/barcode.png`}
                      alt={a.barcode || a.code}
                      loading="lazy"
                      className="h-10 w-auto max-w-[140px] rounded border border-border bg-white px-1"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={() =>
                        prompt.open({
                          title: "Ubah Harga Modal",
                          description: `${a.name} (${a.code}) — hanya admin yang melihat nilai ini.`,
                          label: "Harga modal (Rp)",
                          defaultValue: String(a.cost_price ?? 0),
                          numeric: true,
                          onSubmit: (v) => {
                            patchCost.mutate({ id: a.id, cost_price: parseUang(v) });
                          },
                        })
                      }
                      className="tabular text-sm font-semibold text-amber-700 underline-offset-2 hover:underline"
                      data-testid={`produk-cost-${a.code}`}
                    >
                      {rupiah(a.cost_price ?? 0)}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={a.is_active ? "secondary" : "outline"} className="text-[10px]">
                      {a.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PromptDialog control={prompt} />
    </div>
  );
}
