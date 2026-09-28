import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Delete, Loader2, LockKeyhole, Store } from "lucide-react";
import { apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe } from "@/hooks/useAuth";
import { beginSession } from "@/lib/session";
import { pesanError } from "@/lib/format";
import type { CurrentUser } from "@/lib/types";
import { queryClient } from "@/lib/queryClient";
import { ME_KEY } from "@/hooks/useAuth";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

export default function Login() {
  const { user, isLoading } = useMe();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const login = useMutation({
    mutationFn: (body: { username: string; pin: string }) =>
      apiPost<CurrentUser>("/auth/login", body),
    onSuccess: (me) => {
      beginSession();
      queryClient.setQueryData(ME_KEY, me);
      navigate("/", { replace: true });
    },
    onError: (e) => {
      setError(pesanError(e, "Gagal masuk"));
      setPin("");
    },
  });

  // Auto-submit begitu PIN mencapai 4 digit tidak dilakukan: PIN bisa 4-6 digit.
  useEffect(() => {
    if (error) setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, pin]);

  if (!isLoading && user) return <Navigate to="/" replace />;

  const submit = () => {
    if (username.trim().length < 2) {
      setError("Isi username dulu");
      return;
    }
    if (pin.length < 4) {
      setError("PIN minimal 4 digit");
      return;
    }
    login.mutate({ username: username.trim().toLowerCase(), pin });
  };

  const tapKey = (k: string) => {
    if (k === "del") setPin((p) => p.slice(0, -1));
    else if (k && pin.length < 6) setPin((p) => p + k);
  };

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-slate-950 px-4 py-10">
      {/* Latar bertekstur — tidak bergantung pada fetch apa pun, jadi login selalu instan */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-sky-500/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 -right-32 size-[560px] rounded-full bg-teal-500/15 blur-3xl"
      />

      <div className="relative z-10 w-full max-w-sm animate-slide-up">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-sky-500/15 ring-1 ring-sky-400/40">
            <Store className="size-6 text-sky-400" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-white">
              LodiShoes POS
            </h1>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Kasir Multi Cabang
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl backdrop-blur-xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-4"
            data-testid="login-form"
          >
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                Username
              </Label>
              <Input
                id="username"
                autoFocus
                autoComplete="username"
                placeholder="username kasir / admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 border-white/15 bg-white/5 text-white placeholder:text-slate-500"
                data-testid="login-username-input"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pin" className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                PIN (4-6 digit)
              </Label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  placeholder="••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="h-11 border-white/15 bg-white/5 pl-9 tracking-[0.4em] text-white placeholder:tracking-normal placeholder:text-slate-500"
                  data-testid="login-pin-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              {KEYS.map((k, i) =>
                k === "" ? (
                  <span key={`sp-${i}`} />
                ) : (
                  <Button
                    key={k}
                    type="button"
                    variant="outline"
                    onClick={() => tapKey(k)}
                    data-testid={k === "del" ? "login-pad-delete" : `login-pad-${k}`}
                    className="h-11 border-white/10 bg-white/5 font-mono text-base text-white transition-transform duration-100 hover:bg-white/15 active:scale-95"
                  >
                    {k === "del" ? <Delete className="size-4" /> : k}
                  </Button>
                ),
              )}
            </div>

            {error && (
              <p
                className="rounded-lg bg-red-500/15 px-3 py-2 text-sm font-medium text-red-300"
                data-testid="login-error"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="h-11 w-full gap-2 bg-sky-500 text-white hover:bg-sky-400"
              disabled={login.isPending}
              data-testid="login-submit-button"
            >
              {login.isPending && <Loader2 className="size-4 animate-spin" />}
              {login.isPending ? "Masuk…" : "Masuk"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-500">
          Demi keamanan, daftar pengguna tidak ditampilkan di halaman ini.
          <br />
          PIN tersimpan dalam bentuk hash — hubungi admin jika lupa PIN.
        </p>
      </div>
    </div>
  );
}
