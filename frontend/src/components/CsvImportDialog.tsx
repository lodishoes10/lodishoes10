import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, FileUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { pesanError } from "@/lib/format";

interface ImportResult {
  ok: boolean;
  created?: number;
  updated?: number;
  applied?: number;
  errors?: string[];
}

interface Props {
  endpoint: string;
  title: string;
  description: string;
  templateName: string;
  templateContent: string;
  columnsHint: string;
  extraBody?: Record<string, unknown>;
  onDone: () => void;
  triggerTestId: string;
}

export default function CsvImportDialog({
  endpoint,
  title,
  description,
  templateName,
  templateContent,
  columnsHint,
  extraBody,
  onDone,
  triggerTestId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const blob = new Blob([templateContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = templateName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(f);
  };

  const upload = useMutation({
    mutationFn: () => apiPost<ImportResult>(endpoint, { csv: csvText, ...extraBody }),
    onSuccess: (r) => {
      setResult(r);
      const done = (r.created ?? 0) + (r.updated ?? 0) + (r.applied ?? 0);
      const errs = r.errors?.length ?? 0;
      if (done > 0) {
        toast.success(`Impor selesai: ${done} baris diproses${errs ? `, ${errs} dilewati` : ""}`);
        onDone();
      } else {
        toast.warning("Tidak ada baris yang berhasil diimpor — cek format & pesan di bawah");
      }
    },
    onError: (e) => toast.error(pesanError(e, "Impor gagal")),
  });

  const reset = () => {
    setFileName("");
    setCsvText("");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" className="gap-2" data-testid={triggerTestId}>
            <FileUp className="size-4" /> Impor CSV
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg" data-testid={`${triggerTestId}-dialog`}>
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">
              Kolom yang didukung: <span className="font-semibold text-foreground">{columnsHint}</span>
            </p>
            <Button
              variant="link"
              size="sm"
              className="h-auto gap-1.5 p-0 text-xs"
              onClick={downloadTemplate}
              data-testid={`${triggerTestId}-template`}
            >
              <Download className="size-3.5" /> Unduh template + contoh
            </Button>
          </div>

          <div className="space-y-1.5">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onPickFile}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-sky-700"
              data-testid={`${triggerTestId}-file`}
            />
            {fileName && (
              <p className="text-xs text-muted-foreground" data-testid={`${triggerTestId}-filename`}>
                Berkas: {fileName}
              </p>
            )}
          </div>

          {result && (
            <div className="space-y-1.5 rounded-lg border border-border bg-card p-3" data-testid={`${triggerTestId}-result`}>
              <p className="text-sm font-semibold text-emerald-700">
                {(result.created ?? 0) + (result.updated ?? 0) + (result.applied ?? 0)} baris berhasil
                {result.created != null && ` (baru ${result.created}, diperbarui ${result.updated ?? 0})`}
              </p>
              {result.errors && result.errors.length > 0 && (
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-600">
                  {result.errors.map((er, i) => (
                    <li key={i}>• {er}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Button
            className="w-full gap-2"
            disabled={!csvText.trim() || upload.isPending}
            onClick={() => upload.mutate()}
            data-testid={`${triggerTestId}-submit`}
          >
            <Upload className="size-4" />
            {upload.isPending ? "Mengunggah…" : "Unggah & Impor"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
