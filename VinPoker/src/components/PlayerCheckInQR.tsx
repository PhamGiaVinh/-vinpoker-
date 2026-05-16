import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { QrCode, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface Props {
  userId: string;
  displayName?: string | null;
  variant?: "card" | "button";
}

/**
 * QR chứa user_id (UUID) — Cashier dùng camera phone quét để tra cứu Player tại quầy.
 * Nội dung QR: vinpoker://user/{user_id}
 */
export function PlayerCheckInQR({ userId, displayName, variant = "card" }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const payload = `vinpoker://user/${userId}`;

  const copy = async () => {
    await navigator.clipboard.writeText(userId);
    setCopied(true);
    toast.success("Đã copy ID");
    setTimeout(() => setCopied(false), 1500);
  };

  const QrModal = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>QR Check-in tại CLB</DialogTitle>
          <DialogDescription>
            Đưa mã này cho Cashier quét để xác minh tại quầy.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="bg-white p-4 rounded-lg">
            <QRCodeSVG value={payload} size={220} level="M" />
          </div>
          {displayName && (
            <div className="font-semibold text-center">{displayName}</div>
          )}
          <button
            onClick={copy}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1 break-all px-2"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {userId}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (variant === "button") {
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <QrCode className="w-3.5 h-3.5 mr-1.5" /> QR Check-in
        </Button>
        {QrModal}
      </>
    );
  }

  return (
    <>
      <Card className="p-4 flex items-center gap-4 border-gold/40 bg-gradient-to-br from-card to-primary/5">
        <button
          onClick={() => setOpen(true)}
          className="bg-white p-2 rounded-md hover:scale-105 transition shrink-0"
          aria-label="Mở QR lớn"
        >
          <QRCodeSVG value={payload} size={72} level="M" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider">
            <QrCode className="w-3 h-3" /> Mã check-in CLB
          </div>
          <div className="text-sm font-semibold mt-0.5">Đưa cho Cashier quét</div>
          <button
            onClick={copy}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {userId.slice(0, 8)}…{userId.slice(-4)}
          </button>
        </div>
      </Card>
      {QrModal}
    </>
  );
}
