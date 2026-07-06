import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * QrScanDialog — generic QR reader for the card-reissue flow. Camera (Html5Qrcode) + USB scanner
 * (fast keystrokes ending in Enter) + manual paste. Returns the RAW decoded text via onResult; the
 * caller parses it (vinpoker://user/…, ?user_id=, member_card_id, UUID, raw). Mirrors ClubQrScanDialog.
 */
interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onResult: (text: string) => void;
}

export default function QrScanDialog({ open, onOpenChange, onResult }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const bufRef = useRef<{ s: string; t: number }>({ s: "", t: 0 });
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  const emit = (text: string) => {
    const t = text.trim();
    if (t.length < 3) return;
    resultRef.current(t);
    onOpenChange(false);
  };

  // USB QR scanner: fast keystrokes ending with Enter (ignore when typing in the manual input)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const now = Date.now();
      if (now - bufRef.current.t > 100) bufRef.current.s = "";
      bufRef.current.t = now;
      if (e.key === "Enter") {
        const txt = bufRef.current.s;
        bufRef.current.s = "";
        if (txt.length >= 3) emit(txt);
        return;
      }
      if (e.key.length === 1) bufRef.current.s += e.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Camera
  useEffect(() => {
    if (!open) return;
    setCameraError(null);
    let cancelled = false;
    const elId = "card-reissue-qr-reader";
    (async () => {
      try {
        const scanner = new Html5Qrcode(elId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decoded) => emit(decoded),
          () => {},
        );
        if (cancelled) {
          try { await scanner.stop(); } catch { /* noop */ }
          try { scanner.clear(); } catch { /* noop */ }
        }
      } catch (e) {
        setCameraError(e instanceof Error ? e.message : "Không mở được camera");
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) s.stop().then(() => { try { s.clear(); } catch { /* noop */ } }).catch(() => {});
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Quét QR hội viên</DialogTitle>
          <DialogDescription>
            Đưa mã QR VBacker vào khung, hoặc dùng máy quét USB, hoặc dán mã bên dưới.
          </DialogDescription>
        </DialogHeader>

        <div id="card-reissue-qr-reader" className="w-full rounded-md overflow-hidden bg-black/40 min-h-[260px]" />

        {cameraError && (
          <p className="text-xs text-destructive">Không mở được camera: {cameraError}. Dùng máy quét USB hoặc dán mã.</p>
        )}

        <div className="space-y-2 pt-2 border-t">
          <label className="text-xs text-muted-foreground">Dán mã thủ công</label>
          <div className="flex gap-2">
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && manual.trim() && emit(manual)}
              placeholder="vinpoker://user/… hoặc mã thẻ"
            />
            <Button onClick={() => manual.trim() && emit(manual)} disabled={!manual.trim()}>Áp dụng</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
