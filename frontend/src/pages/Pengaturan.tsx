import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DatabaseBackup, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, ErrorNote, PageHeader, SkeletonRows } from "@/components/Chrome";
import { formatTanggal, pesanError } from "@/lib/format";
import type { BackupList, ResetResult } from "@/lib/types";

export default function Pengaturan() {
  const qc = useQueryClient();
  const [confirmText, setConfirmText] = useState("");
  const [wipeMaster, setWipeMaster] = useState(true);

  const backups = useQuery({
    queryKey: ["backups"],
    queryFn: () => apiGet<BackupList>("/admin/backups"),
  });

  const reset = useMutation({
    mutationFn: () =>
      apiPost<ResetResult>("/admin/reset-demo", { confirm: "HAPUS", wipe_master: wipeMaster }),
    onSuccess: (r) => {
      toast.success(r.message);
      setConfirmText("");
      qc.clear();
    },
    onError: (e) => toast.error(pesanError(e, "Gagal menghapus data")),
  });

  return (
    <div>
      <PageHeader
        title="Pengaturan"
        description="Bersihkan data demo sebelum mulai transaksi real, dan pantau backup harian."
        testId="pengaturan-header"
      >
        <Badge variant="secondary" data-testid="pengaturan-admin-badge">
          Khusus Admin
        </Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-red-200" data-testid="reset-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-base text-red-700">
              <ShieldAlert className="size-4" /> Bersihkan Data Demo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Jalankan ini sekali saat aplikasi siap dipakai, sebelum input transaksi real. Akun
              login dan kedua cabang (Balaraja & Ciledug) <strong>tidak</strong> akan terhapus.
            </p>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
              <Checkbox
                checked={wipeMaster}
                onCheckedChange={(v: boolean) => setWipeMaster(!!v)}
                data-testid="reset-wipe-master-checkbox"
              />
              <span className="text-sm">
                <span className="font-semibold">Hapus juga artikel & stok contoh</span>
                <span className="block text-xs text-muted-foreground">
                  Disarankan: mulai benar-benar kosong, lalu input artikel & stok real Anda
                  (bisa lewat scan barcode). Jika tidak dicentang, artikel tetap ada dan stok
                  hanya di-nol-kan.
                </span>
              </span>
            </label>

            <div className="space-y-1.5">
              <Label htmlFor="confirm" className="text-xs font-semibold uppercase tracking-wide">
                Ketik <span className="font-mono">HAPUS</span> untuk mengonfirmasi
              </Label>
              <Input
                id="confirm"
                placeholder="HAPUS"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                data-testid="reset-confirm-input"
              />
            </div>

            <Button
              variant="destructive"
              className="w-full gap-2"
              disabled={confirmText !== "HAPUS" || reset.isPending}
              onClick={() => reset.mutate()}
              data-testid="reset-submit-button"
            >
              <Trash2 className="size-4" />
              {reset.isPending ? "Menghapus…" : "Hapus Data Demo Sekarang"}
            </Button>

            {reset.data && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800" data-testid="reset-result">
                {reset.data.message}
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="backup-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-base">
              <DatabaseBackup className="size-4 text-sky-600" /> Backup Otomatis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
              Backup database berjalan <strong>otomatis setiap hari jam 03:00 WIB</strong>. Arsip
              disimpan {backups.data?.keep_days ?? 7} hari terakhir, yang lebih tua dihapus
              sendiri.
            </div>

            {backups.isError && (
              <ErrorNote
                message={pesanError(backups.error, "Daftar backup belum bisa dimuat")}
                testId="backup-error"
              />
            )}

            {backups.isLoading ? (
              <SkeletonRows rows={3} testId="backup-loading" />
            ) : (backups.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                title="Belum ada arsip backup"
                description="Arsip pertama muncul setelah jadwal 03:00 WIB berjalan."
                icon={DatabaseBackup}
                testId="backup-empty"
              />
            ) : (
              <ul className="space-y-2" data-testid="backup-list">
                {backups.data!.items.map((b) => (
                  <li
                    key={b.name}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                    data-testid={`backup-row-${b.name}`}
                  >
                    <div className="min-w-0">
                      <p className="tabular truncate text-sm font-medium">{b.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTanggal(b.created_at)}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">
                      {b.size_kb} KB
                    </span>
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
