import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allowedClubIds: string[];
  onPicked: (clubId: string) => void;
}

function extractClubId(text: string): string | null {
  const t = text.trim();
  if (UUID_RE.test(t)) return t.toLowerCase();
  try {
    const u = new URL(t);
    const id = u.searchParams.get("club_id");
    if (id && UUID_RE.test(id)) return id.toLowerCase();
  } catch {
    // not a URL
  }
  return null;
}

export default function ClubQrScanDialog({ open, onOpenChange, allowedClubIds, onPicked }: Props) {
  const { t } = useTranslation();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const allowed = new Set(allowedClubIds);
  const bufRef = useRef<{ s: string; t: number }>({ s: "", t: 0 });
  const handleRef = useRef<(text: string) => void>(() => {});

  // USB QR scanner: fast keystrokes ending with Enter
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // ignore when typing in the manual input
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const now = Date.now();
      if (now - bufRef.current.t > 100) bufRef.current.s = "";
      bufRef.current.t = now;
      if (e.key === "Enter") {
        const txt = bufRef.current.s;
        bufRef.current.s = "";
        if (txt.length >= 6) handleRef.current(txt);
        return;
      }
      if (e.key.length === 1) bufRef.current.s += e.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setCameraError(null);
    let cancelled = false;
    const elId = "club-qr-reader";

    const handle = (text: string) => {
      const id = extractClubId(text);
      if (!id) {
        toast.error(t("clubQrScan.invalidQr"));
        return;
      }
      if (!allowed.has(id)) {
        toast.error(t("clubQrScan.notAssignedClub"));
        return;
      }
      onPicked(id);
      onOpenChange(false);
    };
    handleRef.current = handle;

    (async () => {
      try {
        const scanner = new Html5Qrcode(elId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decoded) => handle(decoded),
          () => {},
        );
        if (cancelled) {
          try { await scanner.stop(); } catch {}
          try { scanner.clear(); } catch {}
        }
      } catch (e: any) {
        setCameraError(e?.message || t("clubQrScan.cameraOpenFailed"));
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
    const id = extractClubId(manual);
    if (!id) { toast.error(t("clubQrScan.pasteValidUrlOrUuid")); return; }
    if (!allowed.has(id)) { toast.error(t("clubQrScan.notAssignedClub")); return; }
    onPicked(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("clubQrScan.title")}</DialogTitle>
          <DialogDescription>
            {t("clubQrScan.description")}
          </DialogDescription>
        </DialogHeader>

        <div id="club-qr-reader" className="w-full rounded-md overflow-hidden bg-black/40 min-h-[260px]" />

        {cameraError && (
          <p className="text-xs text-destructive">{t("clubQrScan.cameraErrorHint", { error: cameraError })}</p>
        )}

        <div className="space-y-2 pt-2 border-t">
          <label className="text-xs text-muted-foreground">{t("clubQrScan.manualLabel")}</label>
          <div className="flex gap-2">
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder={t("clubQrScan.manualPlaceholder")}
            />
            <Button onClick={submitManual}>{t("clubQrScan.apply")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
