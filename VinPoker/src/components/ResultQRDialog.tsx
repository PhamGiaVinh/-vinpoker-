import { QRCodeSVG } from "qrcode.react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  dealId: string | null;
  onClose: () => void;
}

/**
 * QR shown to the Player after submitting tournament result.
 * Cashier scans this at the counter to verify identity before approving the result.
 * Payload: vinpoker://result/{deal_id}
 */
export function ResultQRDialog({ dealId, onClose }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!dealId) return null;
  const payload = `vinpoker://result/${dealId}`;
  const shortId = dealId.slice(0, 8).toUpperCase();

  const copy = async () => {
    await navigator.clipboard.writeText(dealId);
    setCopied(true);
    toast.success(t("resultQR.copiedDealId"));
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={!!dealId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("resultQR.title")}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("resultQR.desc")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="bg-white p-4 rounded-lg shadow-lg">
            <QRCodeSVG value={payload} size={240} level="M" />
          </div>
          <div className="text-center">
            <div className="text-xs uppercase text-muted-foreground tracking-wider">Deal ID</div>
            <button
              onClick={copy}
              className="font-mono text-xl font-bold tracking-widest text-primary hover:underline inline-flex items-center gap-2 mt-1"
            >
              #{shortId}
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground italic text-center">
            {t("resultQR.scanHint", { shortId })}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose} className="w-full">{t("resultQR.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
