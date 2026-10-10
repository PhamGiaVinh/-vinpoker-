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
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { Printer, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SeatReceipt, type SeatReceiptData } from "./SeatReceipt";
import { fetchBuyinReceiptWithClient, toSeatReceiptData } from "./buyinReceiptCore";
import { fetchFloorSeatTicketWithClient } from "./floorSeatTicketCore";

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
  const supabase = useSupabaseClient();
  const ref = useRef<HTMLDivElement>(null);
  const receiptRef = useRef<SeatReceiptData | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydratedReceipt, setHydratedReceipt] = useState<SeatReceiptData | null>(null);
  const [proofScope, setProofScope] = useState<string | null>(null);
  const [proofError, setProofError] = useState<{ scope: string; message: string } | null>(null);
  const [readRetry, setReadRetry] = useState(0);
  const exportRun = useRef<object | null>(null);
  const dialogLifetime = useRef<object | null>(null);
  const floorContext = receipt?.floorSeatContext;
  const scope = `${floorContext?.actorId ?? ""}:${floorContext?.tournamentId ?? ""}:${floorContext?.entryId ?? ""}:${receipt?.receiptCode ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = open ? scope : "";
  receiptRef.current = receipt;

  useEffect(() => {
    let current = true;
    const lifetime = {};
    dialogLifetime.current = lifetime;
    const dispose = () => {
      current = false;
      if (dialogLifetime.current === lifetime) dialogLifetime.current = null;
    };
    exportRun.current = null;
    setBusy(false);
    setHydratedReceipt(null);
    setProofScope(null);
    setProofError(null);
    const receiptCode = receiptRef.current?.receiptCode;
    if (!open || !receiptCode) return dispose;

    if (floorContext) {
      void fetchFloorSeatTicketWithClient(supabase, floorContext, receiptCode).then((snapshot) => {
        if (current && currentScope.current === scope) {
          setHydratedReceipt(snapshot); setProofScope(scope);
        }
      }).catch((cause) => {
        if (current && currentScope.current === scope) setProofError({ scope,
          message: `Phiếu chưa được xác minh hoặc không còn hiệu lực (${cause instanceof Error ? cause.message : "lỗi tải dữ liệu"}).` });
      });
      return dispose;
    }
    void fetchBuyinReceiptWithClient(supabase, { receiptCode }).then((snapshot) => {
      if (current && snapshot) setHydratedReceipt(toSeatReceiptData(snapshot, receiptRef.current));
    });
    return dispose;
  }, [open, receipt?.receiptCode, supabase, scope, readRetry]);

  const displayReceipt = useMemo(() => floorContext
    ? proofScope === scope ? hydratedReceipt : null
    : hydratedReceipt ?? receipt, [hydratedReceipt, receipt, proofScope, scope, floorContext]);

  const verifyForExport = async (lifetime: object | null) => {
    if (!floorContext || !receipt || !displayReceipt) return;
    const latest = await fetchFloorSeatTicketWithClient(supabase, floorContext, receipt.receiptCode);
    if (currentScope.current !== scope || dialogLifetime.current !== lifetime) throw new Error("Phạm vi phiếu đã thay đổi.");
    if (["receiptCode", "tableNumber", "seatNumber", "startingStack", "playerName", "tournamentName"].some((field) =>
      latest[field as keyof SeatReceiptData] !== displayReceipt[field as keyof SeatReceiptData])) {
      throw new Error("Nội dung phiếu đã thay đổi. Hãy xác minh lại trước khi in.");
    }
  };
  const failProof = (cause: unknown, lifetime: object | null) => {
    if (currentScope.current !== scope || dialogLifetime.current !== lifetime) return;
    setProofScope(null);
    setProofError({ scope, message: `Chưa thể xuất phiếu (${cause instanceof Error ? cause.message : "lỗi xác minh"}).` });
  };

  const printReceipt = async () => {
    if (!ref.current || !displayReceipt || exportRun.current) return;
    const lifetime = dialogLifetime.current;
    const win = window.open("", "_blank", "width=420,height=680");
    if (!win) {
      toast.error(t("seatReceipt.printError"));
      return;
    }
    if (floorContext) {
      const operation = {};
      exportRun.current = operation;
      setBusy(true);
      try {
        await verifyForExport(lifetime);
        if (currentScope.current !== scope || dialogLifetime.current !== lifetime || exportRun.current !== operation) { win.close(); return; }
      } catch (cause) {
        win.close(); failProof(cause, lifetime); return;
      } finally {
        if (exportRun.current === operation) { exportRun.current = null; setBusy(false); }
      }
      if (!ref.current) { win.close(); return; }
    }
    win.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${floorContext ? "Seat Transfer Receipt" : "Buy-in Receipt"}</title>` +
        `<style>@page{size:80mm auto;margin:0}html,body{width:80mm;margin:0;padding:0;background:#fff}body{display:block}section{margin:0!important;border:0!important;border-radius:0!important;max-width:80mm!important;break-inside:avoid}</style>` +
        `</head><body>${ref.current.outerHTML}</body></html>`,
    );
    win.document.close();
    win.document.title = displayReceipt?.confirmationCode ?? displayReceipt?.receiptCode ?? "Receipt";
    win.focus();
    // Let the browser lay out the inline SVG before printing.
    setTimeout(() => currentScope.current === scope && dialogLifetime.current === lifetime ? win.print() : win.close(), 250);
  };

  const downloadPdf = async () => {
    if (!ref.current || !displayReceipt || exportRun.current) return;
    const lifetime = dialogLifetime.current;
    const operation = {};
    exportRun.current = operation;
    setBusy(true);
    if (floorContext) {
      try { await verifyForExport(lifetime); }
      catch (cause) {
        failProof(cause, lifetime);
        if (exportRun.current === operation) { exportRun.current = null; setBusy(false); }
        return;
      }
      if (currentScope.current !== scope || dialogLifetime.current !== lifetime || exportRun.current !== operation) return;
    }
    try {
      const html2canvasMod = await import("html2canvas").catch(() => null);
      const jspdfMod = await import("jspdf").catch(() => null);
      if (currentScope.current !== scope || dialogLifetime.current !== lifetime || exportRun.current !== operation || !ref.current) return;
      if (!html2canvasMod || !jspdfMod) throw new Error("pdf-libs-missing");

      const html2canvas = html2canvasMod.default;
      const jsPDF = jspdfMod.jsPDF ?? (jspdfMod as { default?: typeof jspdfMod.jsPDF }).default;
      if (!jsPDF) throw new Error("jspdf-missing");

      const canvas = await html2canvas(ref.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      if (currentScope.current !== scope || dialogLifetime.current !== lifetime || exportRun.current !== operation) return;
      const imgData = canvas.toDataURL("image/png");

      // Captured at scale 2 → divide back to CSS px, then convert to mm.
      const wMm = (canvas.width / 2) * PX_TO_MM;
      const hMm = (canvas.height / 2) * PX_TO_MM;
      const pdf = new jsPDF({ orientation: wMm > hMm ? "l" : "p", unit: "mm", format: [wMm, hMm] });
      pdf.addImage(imgData, "PNG", 0, 0, wMm, hMm);
      const filenameCode = (displayReceipt.confirmationCode ?? displayReceipt.receiptCode ?? "buyin")
        .replace(/[^A-Za-z0-9_-]/g, "_");
      pdf.save(`receipt-${filenameCode}.pdf`);
    } catch {
      // Fall back to the print window if the PDF libs are unavailable.
      if (currentScope.current === scope && dialogLifetime.current === lifetime && exportRun.current === operation) {
        exportRun.current = null;
        setBusy(false);
        void printReceipt();
      }
    } finally {
      if (exportRun.current === operation) { exportRun.current = null; setBusy(false); }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mb-[env(safe-area-inset-bottom)] grid max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-[420px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-4 sm:max-h-[90vh] sm:p-6">
        <DialogHeader>
          <DialogTitle>{floorContext ? "Phiếu chuyển ghế" : t("seatReceipt.title")}</DialogTitle>
          <DialogDescription className="text-xs">
            {floorContext ? "Xác minh đúng entry và phiên bàn trước khi in. Không phải chứng từ thu tiền." : t("seatReceipt.dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        {floorContext && proofError?.scope === scope ? <div role="alert" className="text-sm text-destructive">{proofError.message}
          <Button variant="outline" onClick={() => setReadRetry((value) => value + 1)}>Xác minh lại</Button></div>
          : floorContext && !displayReceipt ? <div role="status" className="text-sm text-muted-foreground">Đang xác minh phiếu chuyển ghế…</div> : null}
        {displayReceipt ? (
          <div className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain py-2">
            <div className="flex justify-center">
              <SeatReceipt ref={ref} {...displayReceipt} />
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={printReceipt} disabled={!displayReceipt || busy}>
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
