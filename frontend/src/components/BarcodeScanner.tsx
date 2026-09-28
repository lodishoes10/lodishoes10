import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Camera, ImageUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (code: string) => void;
  title?: string;
}

/** Scanner barcode dua mode: kamera live (real-time) & unggah foto. */
export default function BarcodeScanner({ open, onOpenChange, onDetected, title = "Scan Barcode" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const firedRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [tab, setTab] = useState("camera");
  const [cameraError, setCameraError] = useState("");
  const [decoding, setDecoding] = useState(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  });

  // Mode kamera live: mulai saat tab kamera aktif, berhenti total saat dialog tutup/ganti tab.
  useEffect(() => {
    if (!open || tab !== "camera") return;
    firedRef.current = false;
    setCameraError("");
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;
    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (result && !firedRef.current) {
          firedRef.current = true;
          onDetectedRef.current(result.getText());
        }
      })
      .then((controls) => {
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      })
      .catch(() => setCameraError("Kamera tidak bisa diakses — izinkan kamera di browser, atau pakai mode Unggah Foto."));
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, tab]);

  const handleFile = async (file: File) => {
    setDecoding(true);
    const url = URL.createObjectURL(file);
    try {
      const reader = new BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(url);
      onDetectedRef.current(result.getText());
    } catch {
      toast.error("Barcode tidak terbaca dari foto — coba foto lebih dekat dan terang");
    } finally {
      URL.revokeObjectURL(url);
      setDecoding(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="barcode-scanner-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
          <DialogDescription>
            Arahkan kamera ke barcode, atau unggah foto barcode yang sudah diambil.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList className="w-full" data-testid="scanner-tabs">
            <TabsTrigger value="camera" className="flex-1 gap-1.5" data-testid="scanner-tab-camera">
              <Camera className="size-4" /> Kamera Live
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex-1 gap-1.5" data-testid="scanner-tab-upload">
              <ImageUp className="size-4" /> Unggah Foto
            </TabsTrigger>
          </TabsList>

          <TabsContent value="camera" className="pt-3">
            <div className="overflow-hidden rounded-xl border border-border bg-black" data-testid="scanner-camera-box">
              <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
            </div>
            {cameraError ? (
              <p className="mt-2 text-xs text-red-600" data-testid="scanner-camera-error">
                {cameraError}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Barcode terbaca otomatis begitu terlihat jelas di kamera.
              </p>
            )}
          </TabsContent>

          <TabsContent value="upload" className="pt-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
              data-testid="scanner-file-input"
            />
            <Button
              variant="outline"
              className="h-24 w-full flex-col gap-2 border-dashed"
              disabled={decoding}
              onClick={() => fileRef.current?.click()}
              data-testid="scanner-upload-button"
            >
              {decoding ? <Loader2 className="size-6 animate-spin" /> : <ImageUp className="size-6" />}
              <span className="text-sm">{decoding ? "Membaca foto…" : "Pilih / ambil foto barcode"}</span>
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Di HP, tombol ini langsung membuka kamera untuk memotret label barcode.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
