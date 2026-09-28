import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Minus,
  Plus,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { EmptyState, ErrorNote, SkeletonRows } from "@/components/Chrome";
import BarcodeScanner from "@/components/BarcodeScanner";
import ReceiptDialog from "@/components/ReceiptDialog";
import { branchQuery, useScope } from "@/hooks/useScope";
import { useBranches } from "@/hooks/useAuth";
import { angka, onlyDigits, parseUang, pesanError, rupiah } from "@/lib/format";
import type { Article, PaymentMethod, StockRow, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CartLine {
  article_id: string;
  article_name: string;
  code: string;
  size: string;
  price: number;
  qty: number;
  available: number;
}

const PAYMENTS: PaymentMethod[] = ["TUNAI", "QRIS", "TRANSFER", "DEBIT"];
const PRESETS = [50_000, 100_000, 200_000, 500_000];

export default function POS() {
  const { branchId, branchName } = useScope();
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountText, setDiscountText] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("TUNAI");
  const [paidText, setPaidText] = useState("");
  const [phone, setPhone] = useState("");
  const [receipt, setReceipt] = useState<Transaction | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [scanOpen, setScanOpen] = useState(false);

  const { data: branches } = useBranches();
  const branch = branches?.find((b) => b.id === branchId);

  const stockQuery = useQuery({
    queryKey: ["stock-matrix", branchId],
    queryFn: () => apiGet<StockRow[]>(`/stock/matrix${branchQuery(branchId)}`),
    enabled: !!branchId,
  });

  /**
   * Scan barcode di layar kasir: artikel langsung ditemukan. Jika artikel itu hanya punya
   * SATU ukuran yang ready, langsung masuk keranjang; kalau lebih dari satu, kasir tinggal
   * memilih ukuran pada kartu yang sudah tersaring.
   */
  const scan = useMutation({
    mutationFn: (code: string) => apiGet<Article>(`/articles/by-barcode/${encodeURIComponent(code)}`),
    onSuccess: (a) => {
      setBarcode("");
      const row = (stockQuery.data ?? []).find((r) => r.article_id === a.id);
      if (!row) {
        toast.warning(`${a.name} belum punya stok di ${branchName}`);
        return;
      }
      const ready = row.sizes.filter((s) => s.qty > 0);
      if (ready.length === 1) {
        addToCart(row, ready[0].size, ready[0].selling_price, ready[0].qty);
        toast.success(`${a.name} ukuran ${ready[0].size} masuk keranjang`);
        return;
      }
      setTerm(a.code);
      toast.info(
        ready.length === 0
          ? `${a.name} stoknya habis di ${branchName}`
          : `${a.name} — pilih ukuran (${ready.length} ukuran ready)`,
      );
    },
    onError: (e) => {
      setBarcode("");
      toast.error(
        e instanceof ApiError && e.status === 404
          ? "Barcode belum terdaftar — daftarkan lewat menu Stok"
          : pesanError(e, "Gagal membaca barcode"),
      );
    },
  });

  // Filter di sisi klien — pencarian artikel terasa instan (< 100ms), tanpa request baru.
  const rows = useMemo(() => {
    const all = stockQuery.data ?? [];
    const t = term.trim().toLowerCase();
    if (!t) return all;
    return all.filter(
      (r) =>
        r.name.toLowerCase().includes(t) ||
        r.code.toLowerCase().includes(t) ||
        r.brand.toLowerCase().includes(t),
    );
  }, [stockQuery.data, term]);

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = Math.min(parseUang(discountText), subtotal);
  const total = subtotal - discount;
  const paid = payment === "TUNAI" ? parseUang(paidText) : total;
  const change = paid - total;

  const addToCart = (row: StockRow, size: string, price: number, available: number) => {
    if (available < 1) return;
    setCart((prev) => {
      const i = prev.findIndex((l) => l.article_id === row.article_id && l.size === size);
      if (i >= 0) {
        const line = prev[i];
        if (line.qty >= available) {
          toast.warning(`Stok ${row.name} ukuran ${size} hanya ${available} pasang`);
          return prev;
        }
        const next = [...prev];
        next[i] = { ...line, qty: line.qty + 1 };
        return next;
      }
      return [
        ...prev,
        {
          article_id: row.article_id,
          article_name: row.name,
          code: row.code,
          size,
          price,
          qty: 1,
          available,
        },
      ];
    });
  };

  const bumpQty = (idx: number, delta: number) => {
    setCart((prev) => {
      const next = [...prev];
      const line = next[idx];
      const q = line.qty + delta;
      if (q <= 0) return next.filter((_, i) => i !== idx);
      if (q > line.available) {
        toast.warning(`Stok ukuran ${line.size} hanya ${line.available} pasang`);
        return next;
      }
      next[idx] = { ...line, qty: q };
      return next;
    });
  };

  const resetCart = () => {
    setCart([]);
    setDiscountText("");
    setPaidText("");
    setPhone("");
    setPayment("TUNAI");
  };

  const checkout = useMutation({
    mutationFn: () =>
      apiPost<Transaction>("/transactions", {
        branch_id: branchId,
        items: cart.map((l) => ({ article_id: l.article_id, size: l.size, qty: l.qty })),
        discount,
        payment_method: payment,
        paid: payment === "TUNAI" ? paid : 0,
        customer_phone: phone,
      }),
    onSuccess: (tx) => {
      const waPhone = phone;
      resetCart();
      setCartOpen(false);
      setReceipt(tx);
      setPhone(waPhone);
      toast.success(`Transaksi ${tx.receipt_no} berhasil`);
      qc.invalidateQueries({ queryKey: ["stock-matrix", branchId] });
      qc.invalidateQueries({ queryKey: ["dashboard", branchId] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e) => toast.error(pesanError(e, "Checkout gagal")),
  });

  const canCheckout =
    cart.length > 0 && !checkout.isPending && (payment !== "TUNAI" || paid >= total);

  const cartPanel = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="size-4 text-sky-600" />
          <span className="font-heading text-sm font-bold">Keranjang</span>
          <Badge variant="secondary" className="tabular" data-testid="cart-count">
            {cart.length}
          </Badge>
        </div>
        {cart.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={resetCart}
            className="gap-1 text-muted-foreground hover:text-red-600"
            data-testid="cart-clear-button"
          >
            <Trash2 className="size-3.5" /> Kosongkan
          </Button>
        )}
      </div>

      {/* Satu area yang bisa di-scroll: daftar item + semua input.
          Hanya ringkasan total & tombol Bayar yang dipatok di bawah, supaya tombol
          Bayar SELALU terlihat walau layar pendek. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {cart.length === 0 ? (
          <EmptyState
            title="Keranjang kosong"
            description="Pilih artikel lalu klik ukuran yang ready."
            icon={ShoppingCart}
            testId="cart-empty"
            className="border-none bg-transparent"
          />
        ) : (
          <ul className="space-y-2" data-testid="cart-lines">
            {cart.map((l, i) => (
              <li
                key={`${l.article_id}-${l.size}`}
                className="animate-pop-in rounded-lg border border-border bg-card p-2.5"
                data-testid={`cart-line-${l.article_id}-${l.size}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{l.article_name}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      Uk. {l.size} · {rupiah(l.price)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setCart((p) => p.filter((_, idx) => idx !== i))}
                    data-testid={`cart-remove-${l.article_id}-${l.size}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="icon-xs"
                      onClick={() => bumpQty(i, -1)}
                      data-testid={`cart-minus-${l.article_id}-${l.size}`}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="tabular w-7 text-center text-sm font-semibold">{l.qty}</span>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      onClick={() => bumpQty(i, 1)}
                      data-testid={`cart-plus-${l.article_id}-${l.size}`}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                  <span className="tabular text-sm font-semibold">
                    {rupiah(l.price * l.qty)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 space-y-3 border-t border-border pt-3">
        <div className="space-y-1.5">
          <Label htmlFor="diskon" className="text-xs font-semibold uppercase tracking-wide">
            Diskon (Rp)
          </Label>
          <Input
            id="diskon"
            inputMode="numeric"
            placeholder="0"
            value={discountText ? parseUang(discountText).toLocaleString("id-ID") : ""}
            onChange={(e) => setDiscountText(onlyDigits(e.target.value))}
            className="tabular h-9"
            data-testid="discount-input"
          />
        </div>

        <div className="flex gap-1.5">
          {PAYMENTS.map((p) => (
            <Button
              key={p}
              variant={payment === p ? "default" : "outline"}
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setPayment(p)}
              data-testid={`payment-${p}`}
            >
              {p}
            </Button>
          ))}
        </div>

        {payment === "TUNAI" && (
          <div className="space-y-1.5">
            <Label htmlFor="bayar" className="text-xs font-semibold uppercase tracking-wide">
              Uang Diterima
            </Label>
            <Input
              id="bayar"
              inputMode="numeric"
              placeholder="0"
              value={paidText ? parseUang(paidText).toLocaleString("id-ID") : ""}
              onChange={(e) => setPaidText(onlyDigits(e.target.value))}
              className="tabular h-9"
              data-testid="paid-input"
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setPaidText(String(total))}
                data-testid="preset-exact"
              >
                Uang Pas
              </Button>
              {PRESETS.map((v) => (
                <Button
                  key={v}
                  variant="secondary"
                  size="xs"
                  className="tabular"
                  onClick={() => setPaidText(String(v))}
                  data-testid={`preset-${v}`}
                >
                  {v / 1000}k
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="wa" className="text-xs font-semibold uppercase tracking-wide">
            No. WhatsApp Pelanggan (opsional)
          </Label>
          <Input
            id="wa"
            inputMode="numeric"
            placeholder="08123456789"
            value={phone}
            onChange={(e) => setPhone(onlyDigits(e.target.value))}
            className="tabular h-9"
            data-testid="customer-phone-input"
          />
        </div>
        </div>
      </div>

      {/* Footer dipatok: ringkasan + tombol Bayar selalu terlihat */}
      <div className="space-y-3 border-t border-border bg-muted/40 px-4 py-4">
        <div className="space-y-1 rounded-lg bg-card p-3 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular" data-testid="cart-subtotal">
              {rupiah(subtotal)}
            </span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-amber-700">
              <span>Diskon</span>
              <span className="tabular" data-testid="cart-discount">
                −{rupiah(discount)}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1.5 text-base font-bold">
            <span>Total</span>
            <span className="tabular" data-testid="cart-total">
              {rupiah(total)}
            </span>
          </div>
          {payment === "TUNAI" && paid > 0 && (
            <div
              className={cn(
                "flex justify-between text-sm font-semibold",
                change < 0 ? "text-red-600" : "text-emerald-700",
              )}
            >
              <span>{change < 0 ? "Kurang" : "Kembalian"}</span>
              <span className="tabular" data-testid="cart-change">
                {rupiah(Math.abs(change))}
              </span>
            </div>
          )}
        </div>

        <Button
          className="h-11 w-full text-base"
          disabled={!canCheckout}
          onClick={() => checkout.mutate()}
          data-testid="checkout-button"
        >
          {checkout.isPending ? "Memproses…" : `Bayar ${rupiah(total)}`}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
              Transaksi
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Kasir {branchName} — klik ukuran yang ready untuk menambah ke keranjang
            </p>
          </div>
          <Badge variant="secondary" data-testid="pos-branch-badge">
            {branchName}
          </Badge>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sky-600" />
            <Input
              autoFocus
              placeholder="Tembak barcode di sini…"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                // Scanner barcode selalu mengirim Enter di akhir → langsung diproses.
                if (e.key === "Enter" && barcode.trim()) {
                  e.preventDefault();
                  scan.mutate(barcode.trim());
                }
              }}
              className="tabular h-11 border-sky-300 pl-9"
              data-testid="pos-barcode-input"
            />
          </div>
          <Button
            variant="outline"
            className="h-11 gap-2 border-sky-300 text-sky-700 hover:bg-sky-50"
            onClick={() => setScanOpen(true)}
            data-testid="pos-camera-scan-button"
          >
            <Camera className="size-4" /> Scan Kamera
          </Button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="atau cari nama/kode artikel…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="h-11 pl-9"
              data-testid="pos-search-input"
            />
          </div>
        </div>

        {stockQuery.isError && (
          <div className="mb-4">
            <ErrorNote
              message={pesanError(stockQuery.error, "Daftar artikel belum bisa dimuat")}
              testId="pos-stock-error"
            />
          </div>
        )}

        {stockQuery.isLoading ? (
          <SkeletonRows rows={5} testId="pos-loading" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={term ? "Artikel tidak ditemukan" : "Belum ada stok di cabang ini"}
            description={
              term ? "Coba kata kunci lain." : "Tambah stok lewat menu Stok terlebih dahulu."
            }
            icon={Search}
            testId="pos-empty"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="pos-article-grid">
            {rows.map((row) => {
              const ready = row.sizes.reduce((s, z) => s + z.qty, 0);
              return (
                <Card
                  key={row.article_id}
                  className="overflow-hidden transition-shadow duration-150 hover:shadow-md"
                  data-testid={`pos-article-${row.code}`}
                >
                  <CardContent className="space-y-3 pt-4">
                    <div className="flex items-start gap-3">
                      {row.image_url ? (
                        <img
                          src={row.image_url}
                          alt={row.name}
                          loading="lazy"
                          decoding="async"
                          width={56}
                          height={56}
                          className="size-14 shrink-0 rounded-lg border border-border object-cover"
                        />
                      ) : (
                        <div className="size-14 shrink-0 rounded-lg bg-muted" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-heading text-sm font-bold">{row.name}</p>
                        <p className="tabular text-xs text-muted-foreground">{row.code}</p>
                        <p className="tabular mt-0.5 text-sm font-semibold text-sky-700">
                          {rupiah(row.sizes[0]?.selling_price ?? 0)}
                        </p>
                      </div>
                      <Badge
                        variant={ready > 0 ? "secondary" : "destructive"}
                        className="tabular shrink-0 text-[10px]"
                      >
                        {ready > 0 ? `${angka(ready)} psg` : "Habis"}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {row.sizes.map((z) => {
                        const habis = z.qty < 1;
                        return (
                          <button
                            key={z.id}
                            type="button"
                            disabled={habis}
                            onClick={() => addToCart(row, z.size, z.selling_price, z.qty)}
                            title={habis ? `Ukuran ${z.size} habis` : `Sisa ${z.qty} pasang`}
                            data-testid={`size-${row.code}-${z.size}`}
                            className={cn(
                              "tabular min-h-11 min-w-11 rounded-lg border px-2.5 py-1.5 text-sm font-semibold transition-transform duration-100",
                              habis
                                ? "cursor-not-allowed border-rose-200 bg-rose-50 text-rose-400 line-through opacity-70"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100 active:scale-95",
                            )}
                          >
                            {z.size}
                            <span className="ml-1 text-[10px] font-normal opacity-70">
                              {habis ? "0" : z.qty}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop: panel keranjang menempel; Mobile: bottom bar + sheet */}
      <aside className="no-print hidden w-[340px] shrink-0 lg:block">
        <Card className="sticky top-20 overflow-hidden p-0">
          <div className="h-[calc(100svh-7rem)]">{cartPanel}</div>
        </Card>
      </aside>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 p-3 backdrop-blur lg:hidden">
        <Sheet open={cartOpen} onOpenChange={setCartOpen}>
          <SheetTrigger
            render={
              <Button className="h-12 w-full justify-between text-base" data-testid="mobile-cart-button">
                <span className="flex items-center gap-2">
                  <ShoppingCart className="size-4" /> {cart.length} item
                </span>
                <span className="tabular">{rupiah(total)}</span>
              </Button>
            }
          />
          <SheetContent side="bottom" className="h-[88svh] p-0">
            {cartPanel}
          </SheetContent>
        </Sheet>
      </div>
      <div className="h-16 lg:hidden" />

      <BarcodeScanner
        open={scanOpen}
        onOpenChange={setScanOpen}
        onDetected={(code) => {
          setScanOpen(false);
          scan.mutate(code);
        }}
      />
      <ReceiptDialog
        tx={receipt}
        open={!!receipt}
        onOpenChange={(o) => !o && setReceipt(null)}
        defaultPhone={phone}
      />
    </div>
  );
}
