import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SeatReceipt, type SeatReceiptData } from "./SeatReceipt";
import { fetchBuyinReceipt, toSeatReceiptData } from "./buyinReceipt";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: SeatReceiptData | null;
}

const PX_TO_MM = 25.4 / 96;

/**
 * Dialog that shows a SeatReceipt and lets the cashier print it or download a
 * single-page PDF. Mirrors the html2canvas + jspdf approach from
 * src/lib/exportPayrollPdf.ts, but captures the on-screen receipt node directly.
 * Reusable for the initial draw and (later) for reprints.
 */
export function SeatReceiptDialog({ open, onOpenChange, receipt }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const receiptRef = useRef<SeatReceiptData | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydratedReceipt, setHydratedReceipt] = useState<SeatReceiptData | null>(null);
  receiptRef.current = receipt;

  useEffect(() => {
    let current = true;
    setHydratedReceipt(null);
    const receiptCode = receiptRef.current?.receiptCode;
    if (!open || !receiptCode) return () => { current = false; };

    void fetchBuyinReceipt({ receiptCode }).then((snapshot) => {
      if (current && snapshot) setHydratedReceipt(toSeatReceiptData(snapshot, receiptRef.current));
    });
    return () => { current = false; };
  }, [open, receipt?.receiptCode]);

  const displayReceipt = useMemo(() => hydratedReceipt ?? receipt, [hydratedReceipt, receipt]);

  const printReceipt = () => {
    if (!ref.current) return;
    const win = window.open("", "_blank", "width=420,height=680");
    if (!win) {
      toast.error(t("seatReceipt.printError"));
      return;
    }
    win.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${displayReceipt?.confirmationCode ?? displayReceipt?.receiptCode ?? "Receipt"}</title>` +
        `<style>@page{size:80mm auto;margin:0}html,body{width:80mm;margin:0;padding:0;background:#fff}body{display:block}section{margin:0!important;border:0!important;border-radius:0!important;max-width:80mm!important;break-inside:avoid}</style>` +
        `</head><body>${ref.current.outerHTML}</body></html>`,
    );
    win.document.close();
    win.focus();
    // Let the browser lay out the inline SVG before printing.
    setTimeout(() => win.print(), 250);
  };

  const downloadPdf = async () => {
    if (!ref.current || !displayReceipt) return;
    setBusy(true);
    try {
      const html2canvasMod = await import("html2canvas").catch(() => null);
      const jspdfMod = await import("jspdf").catch(() => null);
      if (!html2canvasMod || !jspdfMod) throw new Error("pdf-libs-missing");

      const html2canvas = html2canvasMod.default;
      const jsPDF = jspdfMod.jsPDF ?? (jspdfMod as { default?: typeof jspdfMod.jsPDF }).default;
      if (!jsPDF) throw new Error("jspdf-missing");

      const canvas = await html2canvas(ref.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/png");

      // Captured at scale 2 → divide back to CSS px, then convert to mm.
      const wMm = (canvas.width / 2) * PX_TO_MM;
      const hMm = (canvas.height / 2) * PX_TO_MM;
      const pdf = new jsPDF({ orientation: wMm > hMm ? "l" : "p", unit: "mm", format: [wMm, hMm] });
      pdf.addImage(imgData, "PNG", 0, 0, wMm, hMm);
      pdf.save(`receipt-${displayReceipt.confirmationCode ?? displayReceipt.receiptCode ?? "buyin"}.pdf`);
    } catch {
      // Fall back to the print window if the PDF libs are unavailable.
      printReceipt();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mb-[env(safe-area-inset-bottom)] grid max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-[420px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-4 sm:max-h-[90vh] sm:p-6">
        <DialogHeader>
          <DialogTitle>{t("seatReceipt.title")}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("seatReceipt.dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        {displayReceipt ? (
          <div className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain py-2">
            <div className="flex justify-center">
              <SeatReceipt ref={ref} {...displayReceipt} />
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={printReceipt} disabled={!displayReceipt}>
            <Printer className="w-4 h-4 mr-1" /> {t("seatReceipt.print")}
          </Button>
          <Button onClick={downloadPdf} disabled={!displayReceipt || busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />} {t("seatReceipt.downloadPdf")}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("seatReceipt.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
