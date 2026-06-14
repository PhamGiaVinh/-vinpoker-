import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function extractUserId(text: string): string | null {
  const t = text.trim();
  if (UUID_RE.test(t)) return t.toLowerCase();
  // vinpoker://user/{uuid}
  const m1 = t.match(/(?:vinpoker|vbacker):\/\/user\/([0-9a-f-]{36})/i);
  if (m1) return m1[1].toLowerCase();
  // URL with /player/:id or /u/:id
  try {
    const u = new URL(t);
    const m2 = u.pathname.match(/\/(?:player|u)\/([0-9a-f-]{36})/i);
    if (m2) return m2[1].toLowerCase();
  } catch {
    // not a URL
  }
  return null;
}

export default function ScanQrDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const handleRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    if (!open) return;
    setCameraError(null);
    let cancelled = false;
    const elId = "friend-qr-reader";

    const handle = (text: string) => {
      const id = extractUserId(text);
      if (!id) {
        toast.error(t("scanQr.invalidQr"));
        return;
      }
      onOpenChange(false);
      toast.success(t("scanQr.scannedOpenChat"));
      navigate(`/chat/${id}?hello=1`);
    };
    handleRef.current = handle;

    (async () => {
      try {
        const scanner = new Html5Qrcode(elId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 240 },
          (decoded) => handle(decoded),
          () => {},
        );
        if (cancelled) {
          try { await scanner.stop(); } catch {}
          try { scanner.clear(); } catch {}
        }
      } catch (e: any) {
        setCameraError(e?.message || t("scanQr.cameraOpenFailed"));
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        s.stop().then(() => { try { s.clear(); } catch {} }).catch(() => {});
      }
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitManual = () => {
    const id = extractUserId(manual);
    if (!id) { toast.error(t("scanQr.pasteValidUrlUuid")); return; }
    onOpenChange(false);
    navigate(`/player/${id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("scanQr.title")}</DialogTitle>
          <DialogDescription>
            {t("scanQr.description")}
          </DialogDescription>
        </DialogHeader>

        <div id="friend-qr-reader" className="w-full rounded-md overflow-hidden bg-black/40 min-h-[260px]" />

        {cameraError && (
          <p className="text-xs text-destructive">
            {t("scanQr.cameraErrorHint", { error: cameraError })}
          </p>
        )}

        <div className="space-y-2 pt-2 border-t">
          <label className="text-xs text-muted-foreground">{t("scanQr.orPasteLabel")}</label>
          <div className="flex gap-2">
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder={t("scanQr.pastePlaceholder")}
            />
            <Button onClick={submitManual}>{t("scanQr.open")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
