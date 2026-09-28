import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useBranches } from "@/hooks/useAuth";
import { useScope } from "@/hooks/useScope";
import { onlyDigits, pesanError } from "@/lib/format";
import type { CurrentUser, OkResult, Role } from "@/lib/types";

export default function Pengguna() {
  const qc = useQueryClient();
  const { user: me } = useScope();
  const prompt = usePromptDialog();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("kasir");
  const [pin, setPin] = useState("");
  const [branch, setBranch] = useState("");

  const { data: branches } = useBranches();

  const q = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<CurrentUser[]>("/users"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<CurrentUser>("/users", {
        username,
        name,
        role,
        pin,
        branch_id: role === "kasir" ? branch : "",
      }),
    onSuccess: (u) => {
      toast.success(`Akun ${u.username} dibuat`);
      setOpen(false);
      setUsername("");
      setName("");
      setPin("");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(pesanError(e, "Gagal membuat akun")),
  });

  const resetPin = useMutation({
    mutationFn: (v: { id: string; pin: string }) =>
      apiPatch<OkResult>(`/users/${v.id}/pin`, { pin: v.pin }),
    onSuccess: () => toast.success("PIN diganti — sesi lama otomatis dicabut"),
    onError: (e) => toast.error(pesanError(e, "Gagal mengganti PIN")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<OkResult>(`/users/${id}`),
    onSuccess: () => {
      toast.success("Akun dihapus");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(pesanError(e, "Gagal menghapus akun")),
  });

  const users = q.data ?? [];

  return (
    <div>
      <PageHeader
        title="Pengguna"
        description="Kelola akun admin & kasir. PIN disimpan sebagai hash — tidak bisa dibaca siapa pun, termasuk admin."
        testId="pengguna-header"
      >
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2" data-testid="pengguna-add-open-button">
                <UserPlus className="size-4" /> Akun Baru
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md" data-testid="pengguna-add-dialog">
            <DialogHeader>
              <DialogTitle className="font-heading">Akun Baru</DialogTitle>
              <DialogDescription>
                Kasir wajib terhubung ke satu cabang dan tidak akan pernah melihat harga modal.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="u-username" className="text-xs font-semibold uppercase">Username</Label>
                <Input
                  id="u-username"
                  placeholder="kasirbaru"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  data-testid="pengguna-username-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-name" className="text-xs font-semibold uppercase">Nama Lengkap</Label>
                <Input
                  id="u-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="pengguna-name-input"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase">Peran</Label>
                  <Select value={role} onValueChange={(v: string) => setRole(v as Role)}>
                    <SelectTrigger data-testid="pengguna-role-select">
                      <SelectValue>{(v) => ((v as string) === "admin" ? "Admin" : "Kasir")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kasir" data-testid="pengguna-role-kasir">Kasir</SelectItem>
                      <SelectItem value="admin" data-testid="pengguna-role-admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="u-pin" className="text-xs font-semibold uppercase">PIN (4-6 digit)</Label>
                  <Input
                    id="u-pin"
                    inputMode="numeric"
                    value={pin}
                    onChange={(e) => setPin(onlyDigits(e.target.value).slice(0, 6))}
                    className="tabular"
                    data-testid="pengguna-pin-input"
                  />
                </div>
              </div>
              {role === "kasir" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase">Cabang</Label>
                  <Select value={branch} onValueChange={setBranch}>
                    <SelectTrigger data-testid="pengguna-branch-select">
                      <SelectValue>
                        {(v) => branches?.find((b) => b.id === (v as string))?.name ?? "Pilih cabang"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(branches ?? []).map((b) => (
                        <SelectItem key={b.id} value={b.id} data-testid={`pengguna-branch-${b.code}`}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                className="w-full"
                disabled={
                  username.length < 3 ||
                  name.length < 2 ||
                  pin.length < 4 ||
                  (role === "kasir" && !branch) ||
                  create.isPending
                }
                onClick={() => create.mutate()}
                data-testid="pengguna-submit-button"
              >
                {create.isPending ? "Menyimpan…" : "Buat Akun"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {q.isError && (
        <div className="mb-4">
          <ErrorNote message={pesanError(q.error, "Daftar pengguna belum bisa dimuat")} testId="pengguna-error" />
        </div>
      )}

      {q.isLoading ? (
        <SkeletonRows rows={3} testId="pengguna-loading" />
      ) : users.length === 0 ? (
        <EmptyState title="Belum ada pengguna" icon={Users} testId="pengguna-empty" />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table data-testid="pengguna-table">
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Peran</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} data-testid={`pengguna-row-${u.username}`}>
                  <TableCell className="tabular font-semibold">{u.username}</TableCell>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={u.role === "admin" ? "default" : "secondary"}
                      className="text-[10px]"
                    >
                      {u.role.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.branch_name ?? "Semua cabang"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Ganti PIN"
                        onClick={() =>
                          prompt.open({
                            title: "Ganti PIN",
                            description: `PIN baru untuk ${u.username}. Sesi lama otomatis dicabut.`,
                            label: "PIN (4-6 digit)",
                            numeric: true,
                            onSubmit: (v) => {
                              const p = onlyDigits(v);
                              if (p.length < 4 || p.length > 6) return "PIN harus 4-6 digit";
                              resetPin.mutate({ id: u.id, pin: p });
                            },
                          })
                        }
                        data-testid={`pengguna-reset-pin-${u.username}`}
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Hapus akun"
                        disabled={u.id === me.id}
                        onClick={() =>
                          prompt.open({
                            title: "Hapus Akun",
                            description: `Akun ${u.username} (${u.name}) akan dihapus permanen.`,
                            confirmText: "Hapus",
                            destructive: true,
                            onSubmit: () => {
                              remove.mutate(u.id);
                            },
                          })
                        }
                        className="text-red-600 hover:bg-red-50"
                        data-testid={`pengguna-delete-${u.username}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
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
