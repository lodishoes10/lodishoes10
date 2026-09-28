import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, PackagePlus, Plus, ScanLine, Search } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiGet, apiPatch, apiPost } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "@/components/Chrome";
import BarcodeScanner from "@/components/BarcodeScanner";
import { PromptDialog, usePromptDialog } from "@/components/PromptDialog";
import { branchQuery, useScope } from "@/hooks/useScope";
import { angka, onlyDigits, parseUang, pesanError, rupiah } from "@/lib/format";
import type { Article, Paged, StockAddResult, StockRow } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function Stok() {
  const { branchId, branchName, isAdmin } = useScope();
  const qc = useQueryClient();
  const prompt = usePromptDialog();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [articleId, setArticleId] = useState("");
  const [size, setSize] = useState("");
  const [qtyText, setQtyText] = useState("1");
  const [priceText, setPriceText] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanOpen, setScanOpen] = useState(false);

  // Form artikel baru (kasir cabang boleh menulis artikelnya sendiri)
  const [newOpen, setNewOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nBrand, setNBrand] = useState("");
  const [nBarcode, setNBarcode] = useState("");

  const stockQuery = useQuery({
    queryKey: ["stock-matrix", branchId],
    queryFn: () => apiGet<StockRow[]>(`/stock/matrix${branchQuery(branchId)}`),
    enabled: !!branchId,
  });

  const articlesQuery = useQuery({
    queryKey: ["articles", "picker"],
    queryFn: () => apiGet<Paged<Article>>("/articles?page_size=500"),
    enabled: open || newOpen,
  });

  const rows = useMemo(() => {
    const all = stockQuery.data ?? [];
    const t = term.trim().toLowerCase();
    if (!t) return all;
    return all.filter(
      (r) => r.name.toLowerCase().includes(t) || r.code.toLowerCase().includes(t),
    );
  }, [stockQuery.data, term]);

  const existingRow = (stockQuery.data ?? []).find((r) => r.article_id === articleId);
  const existingSize = existingRow?.sizes.find((s) => s.size === size.trim());
  const selectedArticle = articlesQuery.data?.items.find((a) => a.id === articleId);

  // Ukuran yang sudah dipakai di cabang ini — jadi saran cepat, bukan daftar paksa.
  const sizeSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const r of stockQuery.data ?? []) for (const s of r.sizes) set.add(s.size);
    return Array.from(set).sort((a, b) => (a.length - b.length) || a.localeCompare(b, "id"));
  }, [stockQuery.data]);

  const pickArticle = (id: string) => {
    setArticleId(id);
    const row = (stockQuery.data ?? []).find((r) => r.article_id === id);
    const first = row?.sizes[0];
    if (first) setPriceText(String(first.selling_price));
  };

  /** Scan/ketik barcode -> artikel terisi otomatis (kasir tidak perlu mengetik nama). */
  const scanBarcode = useMutation({
    mutationFn: (code: string) => apiGet<Article>(`/articles/by-barcode/${encodeURIComponent(code)}`),
    onSuccess: (a) => {
      pickArticle(a.id);
      setBarcodeInput("");
      toast.success(`Barcode dikenali: ${a.name}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 404) {
        setNBarcode(barcodeInput.trim());
        setNName("");
        setNewOpen(true);
        toast.info("Barcode belum terdaftar — silakan tulis nama artikelnya");
      } else {
        toast.error(pesanError(e, "Gagal membaca barcode"));
      }
    },
  });

  const createArticle = useMutation({
    mutationFn: () =>
      apiPost<Article>("/articles", {
        name: nName.trim(),
        brand: nBrand.trim(),
        barcode: nBarcode.trim(),
      }),
    onSuccess: async (a) => {
      toast.success(`Artikel "${a.name}" (${a.code}) dibuat`);
      setNewOpen(false);
      setNName("");
      setNBrand("");
      setNBarcode("");
      await qc.invalidateQueries({ queryKey: ["articles"] });
      setArticleId(a.id);
      setOpen(true);
    },
    onError: (e) => toast.error(pesanError(e, "Gagal membuat artikel")),
  });

  const addStock = useMutation({
    mutationFn: () =>
      apiPost<StockAddResult>("/stock/add", {
        branch_id: branchId,
        article_id: articleId,
        size: size.trim(),
        qty: parseUang(qtyText) || 1,
        selling_price: parseUang(priceText),
      }),
    onSuccess: (r) => {
      toast.success(
        r.merged
          ? `Ukuran ${size.trim()} digabung ke artikel yang sama — total ${r.qty} pasang (tidak ada artikel dobel)`
          : `Ukuran ${size.trim()} baru ditambahkan — ${r.qty} pasang`,
      );
      setOpen(false);
      setSize("");
      setQtyText("1");
      qc.invalidateQueries({ queryKey: ["stock-matrix", branchId] });
      qc.invalidateQueries({ queryKey: ["dashboard", branchId] });
    },
    onError: (e) => toast.error(pesanError(e, "Gagal menambah stok")),
  });

  const updatePrice = useMutation({
    mutationFn: (v: { stock_id: string; selling_price: number }) =>
      apiPatch(`/stock/${v.stock_id}`, { selling_price: v.selling_price }),
    onSuccess: () => {
      toast.success("Harga jual diperbarui");
      qc.invalidateQueries({ queryKey: ["stock-matrix", branchId] });
    },
    onError: (e) => toast.error(pesanError(e, "Gagal memperbarui harga")),
  });

  const saveBarcode = useMutation({
    mutationFn: (v: { id: string; barcode: string }) =>
      apiPatch<Article>(`/articles/${v.id}`, { barcode: v.barcode }),
    onSuccess: () => {
      toast.success("Barcode artikel disimpan");
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["stock-matrix", branchId] });
    },
    onError: (e) => toast.error(pesanError(e, "Gagal menyimpan barcode")),
  });

  return (
    <div>
      <PageHeader
        title="Stok Cabang"
        description={`Stok per ukuran di ${branchName}. Scan barcode untuk mengisi artikel otomatis; ukuran boleh ditulis bebas (39, 40.5, XL).`}
        testId="stok-header"
      >
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => {
            setNBarcode("");
            setNName("");
            setNewOpen(true);
          }}
          data-testid="stok-new-article-button"
        >
          <Plus className="size-4" /> Artikel Baru
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2" data-testid="stok-add-open-button">
                <PackagePlus className="size-4" /> Tambah Stok
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md" data-testid="stok-add-dialog">
            <DialogHeader>
              <DialogTitle className="font-heading">Tambah Stok</DialogTitle>
              <DialogDescription>
                Scan barcode atau pilih artikel, lalu tulis ukurannya. Jika ukuran sudah ada,
                jumlahnya digabung ke artikel yang sama.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="stok-barcode" className="text-xs font-semibold uppercase tracking-wide">
                  Scan Barcode
                </Label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="stok-barcode"
                      autoFocus
                      placeholder="Tembak barcode di sini…"
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      onKeyDown={(e) => {
                        // Scanner barcode mengirim Enter di akhir — langsung dicari.
                        if (e.key === "Enter" && barcodeInput.trim()) {
                          e.preventDefault();
                          scanBarcode.mutate(barcodeInput.trim());
                        }
                      }}
                      className="tabular pl-9"
                      data-testid="stok-barcode-input"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    title="Scan lewat kamera HP"
                    onClick={() => setScanOpen(true)}
                    data-testid="stok-camera-scan-button"
                  >
                    <Camera className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide">Artikel</Label>
                <Select value={articleId} onValueChange={pickArticle}>
                  <SelectTrigger data-testid="stok-article-select">
                    <SelectValue>
                      {(v) =>
                        articlesQuery.data?.items.find((a) => a.id === (v as string))?.name ??
                        "Pilih artikel"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(articlesQuery.data?.items ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id} data-testid={`stok-article-option-${a.code}`}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedArticle && !selectedArticle.barcode && (
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto p-0 text-xs"
                    onClick={() =>
                      prompt.open({
                        title: "Pasang Barcode",
                        description: `Tembak/ketik barcode untuk ${selectedArticle.name}. Lain kali scan langsung mengisi artikel ini.`,
                        label: "Barcode",
                        onSubmit: (v) => {
                          if (!v.trim()) return "Barcode tidak boleh kosong";
                          saveBarcode.mutate({ id: selectedArticle.id, barcode: v.trim() });
                        },
                      })
                    }
                    data-testid="stok-attach-barcode-button"
                  >
                    + Pasang barcode untuk artikel ini
                  </Button>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="stok-size" className="text-xs font-semibold uppercase tracking-wide">
                  Ukuran (tulis bebas)
                </Label>
                <Input
                  id="stok-size"
                  placeholder="mis. 39, 40.5, XL"
                  value={size}
                  onChange={(e) => {
                    const v = e.target.value.slice(0, 8);
                    setSize(v);
                    const found = existingRow?.sizes.find((x) => x.size === v.trim());
                    if (found) setPriceText(String(found.selling_price));
                  }}
                  className="tabular"
                  data-testid="stok-size-input"
                />
                {sizeSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5" data-testid="stok-size-suggestions">
                    {sizeSuggestions.slice(0, 12).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setSize(s);
                          const found = existingRow?.sizes.find((x) => x.size === s);
                          if (found) setPriceText(String(found.selling_price));
                        }}
                        data-testid={`stok-size-chip-${s}`}
                        className={cn(
                          "tabular rounded-md border px-2 py-1 text-xs font-semibold transition-colors duration-150",
                          size.trim() === s
                            ? "border-sky-500 bg-sky-500 text-white"
                            : "border-border bg-card hover:bg-muted",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {existingSize && (
                  <p className="text-xs text-emerald-700" data-testid="stok-merge-hint">
                    Ukuran {size.trim()} sudah ada ({existingSize.qty} pasang) — jumlah akan
                    digabung, bukan membuat artikel baru.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="stok-qty" className="text-xs font-semibold uppercase">
                    Jumlah (pasang)
                  </Label>
                  <Input
                    id="stok-qty"
                    inputMode="numeric"
                    value={qtyText}
                    onChange={(e) => setQtyText(onlyDigits(e.target.value))}
                    className="tabular"
                    data-testid="stok-qty-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stok-price" className="text-xs font-semibold uppercase">
                    Harga Jual
                  </Label>
                  <Input
                    id="stok-price"
                    inputMode="numeric"
                    placeholder="0"
                    value={priceText ? parseUang(priceText).toLocaleString("id-ID") : ""}
                    onChange={(e) => setPriceText(onlyDigits(e.target.value))}
                    className="tabular"
                    data-testid="stok-price-input"
                  />
                </div>
              </div>

              {isAdmin && selectedArticle?.cost_price != null && (
                <p className="tabular text-xs text-muted-foreground" data-testid="stok-cost-hint">
                  Harga modal artikel ini: {rupiah(selectedArticle.cost_price)} (hanya admin)
                </p>
              )}

              <Button
                className="w-full"
                disabled={
                  !articleId || !size.trim() || parseUang(priceText) <= 0 || addStock.isPending
                }
                onClick={() => addStock.mutate()}
                data-testid="stok-add-submit-button"
              >
                {addStock.isPending ? "Menyimpan…" : "Simpan Stok"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {/* Dialog artikel baru — boleh dipakai kasir cabang */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md" data-testid="stok-new-article-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">Artikel Baru</DialogTitle>
            <DialogDescription>
              Kode artikel dibuat otomatis. Harga modal diisi admin belakangan — kasir cukup nama,
              barcode, dan harga jual saat menambah stok.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="n-name" className="text-xs font-semibold uppercase">Nama Artikel</Label>
              <Input
                id="n-name"
                autoFocus
                placeholder="mis. Sandal Lodi Jepit Hitam"
                value={nName}
                onChange={(e) => setNName(e.target.value)}
                data-testid="new-article-name-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="n-brand" className="text-xs font-semibold uppercase">Brand</Label>
                <Input
                  id="n-brand"
                  placeholder="opsional"
                  value={nBrand}
                  onChange={(e) => setNBrand(e.target.value)}
                  data-testid="new-article-brand-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-barcode" className="text-xs font-semibold uppercase">Barcode</Label>
                <Input
                  id="n-barcode"
                  placeholder="scan/ketik"
                  value={nBarcode}
                  onChange={(e) => setNBarcode(e.target.value)}
                  className="tabular"
                  data-testid="new-article-barcode-input"
                />
              </div>
            </div>
            <Button
              className="w-full"
              disabled={nName.trim().length < 2 || createArticle.isPending}
              onClick={() => createArticle.mutate()}
              data-testid="new-article-submit-button"
            >
              {createArticle.isPending ? "Menyimpan…" : "Simpan & Tambah Stok"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari artikel atau kode…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="pl-9"
          data-testid="stok-search-input"
        />
      </div>

      {stockQuery.isError && (
        <div className="mb-4">
          <ErrorNote message={pesanError(stockQuery.error, "Stok belum bisa dimuat")} testId="stok-error" />
        </div>
      )}

      {stockQuery.isLoading ? (
        <SkeletonRows rows={5} testId="stok-loading" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Belum ada stok"
          description="Tambah artikel lalu stok pertama Anda dengan tombol di atas."
          icon={PackagePlus}
          testId="stok-empty"
        />
      ) : (
        <div className="space-y-3" data-testid="stok-list">
          {rows.map((row) => {
            const totalQty = row.sizes.reduce((s, z) => s + z.qty, 0);
            return (
              <Card key={row.article_id} data-testid={`stok-row-${row.code}`}>
                <CardContent className="pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {row.image_url && (
                        <img
                          src={row.image_url}
                          alt={row.name}
                          loading="lazy"
                          decoding="async"
                          width={48}
                          height={48}
                          className="size-12 shrink-0 rounded-lg border border-border object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-heading text-sm font-bold">{row.name}</p>
                        <p className="tabular text-xs text-muted-foreground">
                          {row.code} · {row.brand || "—"}
                        </p>
                        {/* Modal hanya dirender untuk admin — backend pun tidak mengirimkannya ke kasir. */}
                        {isAdmin && row.cost_price != null && (
                          <p className="tabular mt-0.5 text-xs text-amber-700" data-testid={`stok-cost-${row.code}`}>
                            Modal {rupiah(row.cost_price)}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={totalQty > 0 ? "secondary" : "destructive"}
                      className="tabular"
                      data-testid={`stok-total-${row.code}`}
                    >
                      {totalQty > 0 ? `${angka(totalQty)} pasang` : "Habis"}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.sizes.map((z) => (
                      <div
                        key={z.id}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-center",
                          z.qty < 1
                            ? "border-rose-200 bg-rose-50"
                            : z.qty <= 2
                              ? "border-amber-200 bg-amber-50"
                              : "border-emerald-200 bg-emerald-50",
                        )}
                        data-testid={`stok-size-cell-${row.code}-${z.size}`}
                      >
                        <p className="tabular text-sm font-bold">{z.size}</p>
                        <p className="tabular text-[11px] text-muted-foreground">{z.qty} psg</p>
                        <button
                          type="button"
                          onClick={() =>
                            prompt.open({
                              title: "Ubah Harga Jual",
                              description: `${row.name} — ukuran ${z.size}`,
                              label: "Harga jual (Rp)",
                              defaultValue: String(z.selling_price),
                              numeric: true,
                              onSubmit: (v) => {
                                const val = parseUang(v);
                                if (val <= 0) return "Harga harus lebih dari 0";
                                updatePrice.mutate({ stock_id: z.id, selling_price: val });
                              },
                            })
                          }
                          className="tabular mt-0.5 text-[11px] font-semibold text-sky-700 underline-offset-2 hover:underline"
                          data-testid={`stok-price-edit-${row.code}-${z.size}`}
                        >
                          {rupiah(z.selling_price)}
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <BarcodeScanner
        open={scanOpen}
        onOpenChange={setScanOpen}
        onDetected={(code) => {
          setScanOpen(false);
          setBarcodeInput(code);
          scanBarcode.mutate(code);
        }}
      />
      <PromptDialog control={prompt} />
    </div>
  );
}
