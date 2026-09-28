import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onlyDigits, parseUang } from "@/lib/format";

/**
 * Dialog input & konfirmasi seragam — menggantikan window.prompt/confirm bawaan browser
 * supaya SEMUA pemberitahuan di aplikasi punya tampilan yang sama.
 */
export interface PromptConfig {
  title: string;
  description?: string;
  label?: string;
  defaultValue?: string;
  numeric?: boolean;
  confirmText?: string;
  destructive?: boolean;
  /** Kembalikan string = pesan error (dialog tetap terbuka); void/undefined = sukses & tutup. */
  onSubmit: (value: string) => string | void;
}

export interface PromptControl {
  config: PromptConfig | null;
  open: (config: PromptConfig) => void;
  close: () => void;
}

export function usePromptDialog(): PromptControl {
  const [config, setConfig] = useState<PromptConfig | null>(null);
  const open = useCallback((c: PromptConfig) => setConfig(c), []);
  const close = useCallback(() => setConfig(null), []);
  return { config, open, close };
}

export function PromptDialog({ control }: { control: PromptControl }) {
  const { config, close } = control;
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Reset isi field setiap dialog dibuka untuk konfigurasi berbeda.
  const key = config ? config.title + (config.description ?? "") : null;
  if (config && key !== lastKey) {
    setLastKey(key);
    setValue(config.defaultValue ?? "");
    setError("");
  }

  const submit = () => {
    if (!config) return;
    const res = config.onSubmit(value);
    if (typeof res === "string") {
      setError(res);
      return;
    }
    close();
  };

  const isConfirmOnly = config ? !config.label : false;

  return (
    <Dialog open={!!config} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-sm" data-testid="prompt-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">{config?.title}</DialogTitle>
          {config?.description && <DialogDescription>{config.description}</DialogDescription>}
        </DialogHeader>

        {!isConfirmOnly && (
          <div className="space-y-1.5">
            <Label htmlFor="prompt-value" className="text-xs font-semibold uppercase tracking-wide">
              {config?.label}
            </Label>
            <Input
              id="prompt-value"
              autoFocus
              inputMode={config?.numeric ? "numeric" : undefined}
              value={
                config?.numeric && value ? parseUang(value).toLocaleString("id-ID") : value
              }
              onChange={(e) =>
                setValue(config?.numeric ? onlyDigits(e.target.value) : e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              className={config?.numeric ? "tabular" : undefined}
              data-testid="prompt-input"
            />
          </div>
        )}

        {error && (
          <p className="text-sm font-medium text-red-600" data-testid="prompt-error">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={close}
            data-testid="prompt-cancel-button"
          >
            Batal
          </Button>
          <Button
            variant={config?.destructive ? "destructive" : "default"}
            className="flex-1"
            onClick={submit}
            data-testid="prompt-confirm-button"
          >
            {config?.confirmText ?? "Simpan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
