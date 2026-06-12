import { useRef, useState } from "react";
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
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const printReceipt = () => {
    if (!ref.current) return;
    const win = window.open("", "_blank", "width=420,height=680");
    if (!win) {
      toast.error("Không mở được cửa sổ in. Vui lòng cho phép pop-up.");
      return;
    }
    win.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${receipt?.receiptCode ?? "Receipt"}</title>` +
        `<style>html,body{margin:0;padding:0;background:#fff;}body{display:flex;justify-content:center;padding:16px;}</style>` +
        `</head><body>${ref.current.outerHTML}</body></html>`,
    );
    win.document.close();
    win.focus();
    // Let the browser lay out the inline SVG before printing.
    setTimeout(() => win.print(), 250);
  };

  const downloadPdf = async () => {
    if (!ref.current || !receipt) return;
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
      pdf.save(`receipt-${receipt.receiptCode}.pdf`);
    } catch {
      // Fall back to the print window if the PDF libs are unavailable.
      printReceipt();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Phiếu xếp ghế</DialogTitle>
          <DialogDescription className="text-xs">
            Player đã được xác nhận và xếp ghế. In hoặc tải phiếu cho người chơi.
          </DialogDescription>
        </DialogHeader>

        {receipt ? (
          <div className="flex justify-center py-2">
            <SeatReceipt ref={ref} {...receipt} />
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={printReceipt} disabled={!receipt}>
            <Printer className="w-4 h-4 mr-1" /> In
          </Button>
          <Button onClick={downloadPdf} disabled={!receipt || busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />} Tải PDF
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
