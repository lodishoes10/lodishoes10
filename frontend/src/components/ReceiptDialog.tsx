import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Printer, Send, X } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onlyDigits, pesanError, rupiah } from "@/lib/format";
import type { Transaction, WaResult } from "@/lib/types";

const W = 32; // 80mm thermal ≈ 32 kolom monospace

const pad = (left: string, right: string) => {
  const l = left.slice(0, Math.max(0, W - right.length));
  return l.padEnd(W - right.length, " ") + right;
};

const center = (s: string) => {
  const t = s.slice(0, W);
  const space = Math.max(0, Math.floor((W - t.length) / 2));
  return " ".repeat(space) + t;
};

const wrap = (s: string): string[] => {
  const text = s.toUpperCase();
  if (text.length <= W) return [text];
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    if (cur && `${cur} ${word}`.length > W) {
      out.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) out.push(cur);
  return out;
};

/** Teks struk gaya Indomaret — sama persis dengan yang dikirim backend ke WhatsApp. */
export function receiptLines(tx: Transaction): string[] {
  const lines: string[] = [];
  // Kepala struk: hanya "LODISHOES" + nama cabang (BALARAJA / CILEDUG).
  // Alamat & nomor telepon toko sengaja tidak dicetak (permintaan pemilik).
  lines.push(center("LODISHOES"));
  lines.push(center(tx.branch_name.toUpperCase()));
  lines.push("=".repeat(W));
  lines.push(`NO : ${tx.receipt_no}`);
  // Format identik dengan struk WhatsApp dari backend: DD/MM/YYYY HH:MM WIB (tanpa koma).
  const d = new Date(tx.created_at);
  const p = (n: number) => String(n).padStart(2, "0");
  lines.push(
    `TGL: ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(
      d.getMinutes(),
    )} WIB`,
  );
  lines.push(`KASIR: ${tx.cashier_name.toUpperCase()}`);
  lines.push("-".repeat(W));
  const isTukar = tx.type === "TUKAR";
  for (const it of tx.items) {
    if (!isTukar && it.qty < 1) continue; // baris yang habis ditukar tidak dicetak ulang
    wrap(`${it.article_name} (${it.size})`).forEach((l) => lines.push(l));
    lines.push(pad(`${it.qty} x ${rupiah(it.price)}`, rupiah(it.line_revenue)));
    if (it.new_size) {
      if (it.new_article_name) {
        // Tukar artikel/ukuran berbasis qty — target boleh artikel yang berbeda.
        wrap(`> JADI: ${it.new_article_name} (${it.new_size})`).forEach((l) => lines.push(l));
        lines.push(
          pad(`@${rupiah(it.new_price ?? 0)}`, `SELISIH ${rupiah((it.new_price ?? 0) - it.price)}/PSG`),
        );
      } else {
        lines.push(`> TUKAR UKURAN: ${it.size} -> ${it.new_size}`);
      }
    }
  }
  lines.push("-".repeat(W));
  if (tx.type === "TUKAR") {
    lines.push(pad(`SELISIH TUKAR (${tx.payment_method})`, rupiah(tx.total)));
    if (tx.total < 0) {
      lines.push(pad("KEMBALI KE PELANGGAN", rupiah(tx.change)));
    } else {
      if (tx.payment_method === "TUNAI" && tx.paid) lines.push(pad("BAYAR TUNAI", rupiah(tx.paid)));
      if (tx.change) lines.push(pad("KEMBALIAN", rupiah(tx.change)));
    }
  } else {
    lines.push(pad("TOTAL", rupiah(tx.subtotal)));
    if (tx.discount > 0) lines.push(pad("DISKON", rupiah(-tx.discount)));
    lines.push(pad(tx.payment_method, rupiah(tx.total)));
    if (tx.payment_method === "TUNAI") {
      lines.push(pad("BAYAR TUNAI", rupiah(tx.paid)));
      lines.push(pad("KEMBALIAN", rupiah(tx.change)));
    }
  }
  lines.push("=".repeat(W));
  // Ketentuan tukar 7 hari tidak dicetak lagi (permintaan pemilik).
  lines.push(center("TERIMA KASIH ATAS KUNJUNGAN ANDA"));
  return lines;
}

interface Props {
  tx: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPhone?: string;
}

export default function ReceiptDialog({ tx, open, onOpenChange, defaultPhone = "" }: Props) {
  const [phone, setPhone] = useState(defaultPhone);

  const waMutation = useMutation({
    mutationFn: (p: string) => apiPost<WaResult>(`/transactions/${tx!.id}/whatsapp`, { phone: p }),
    onSuccess: (r) => toast.success(`Struk terkirim ke WhatsApp ${r.to} (${r.status})`),
    onError: (e) => toast.error(pesanError(e, "Gagal mengirim struk WhatsApp")),
  });

  if (!tx) return null;
  const text = receiptLines(tx).join("\n");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-[420px]"
        data-testid="receipt-dialog"
      >
        <div className="no-print flex items-center justify-between border-b border-border px-4 py-3">
          <DialogTitle className="font-heading text-base font-bold">
            {tx.type === "TUKAR" ? "Struk Penyesuaian Tukar" : "Struk Penjualan"}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onOpenChange(false)}
            data-testid="receipt-close-button"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Area yang dicetak: 80mm, satu halaman, rata tengah */}
        <div id="receipt-print" className="bg-white px-3 py-4">
          <pre className="receipt-paper" data-testid="receipt-body">
            {text}
          </pre>
        </div>

        <div className="no-print space-y-3 border-t border-border bg-muted/40 px-4 py-4">
          <Button
            className="w-full gap-2"
            onClick={() => window.print()}
            data-testid="receipt-print-button"
          >
            <Printer className="size-4" /> Cetak Struk Thermal 80mm
          </Button>

          <div className="space-y-1.5">
            <Label htmlFor="wa-phone" className="text-xs font-semibold uppercase tracking-wide">
              Kirim struk ke WhatsApp pelanggan
            </Label>
            <div className="flex gap-2">
              <Input
                id="wa-phone"
                inputMode="numeric"
                placeholder="08123456789"
                value={phone}
                onChange={(e) => setPhone(onlyDigits(e.target.value))}
                data-testid="receipt-wa-phone-input"
              />
              <Button
                variant="secondary"
                className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={phone.length < 9 || waMutation.isPending}
                onClick={() => waMutation.mutate(phone)}
                data-testid="receipt-wa-send-button"
              >
                <Send className="size-4" />
                {waMutation.isPending ? "Mengirim…" : "Kirim"}
              </Button>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Dikirim dari nomor WhatsApp toko via Twilio. Isi TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
              dan TWILIO_WHATSAPP_FROM di backend/.env untuk mengaktifkan.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
