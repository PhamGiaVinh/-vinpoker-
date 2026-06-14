import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { formatDateTime, formatStack } from "@/lib/format";

export interface SeatReceiptData {
  tournamentName: string;
  tournamentDate?: string | null;
  playerName: string;
  tableNumber: number | null;
  seatNumber: number;
  receiptCode: string;
  startingStack?: number | null;
  /** Value encoded into the QR (the unique receipt_code). */
  qrValue: string;
}

/**
 * Pure presentational seat-assignment receipt ("phiếu xếp ghế").
 *
 * Uses self-contained INLINE styles (not Tailwind) on purpose: the node is both
 * captured by html2canvas and written verbatim into a fresh print window, where
 * Tailwind classes would not resolve. forwardRef exposes the root so the dialog
 * can capture/print it.
 */
export const SeatReceipt = forwardRef<HTMLDivElement, SeatReceiptData>(
  (
    { tournamentName, tournamentDate, playerName, tableNumber, seatNumber, receiptCode, startingStack, qrValue },
    ref,
  ) => {
    const { t } = useTranslation();
    const cells = [
      { label: t("seatReceipt.tableLabel"), value: tableNumber ?? "—" },
      { label: t("seatReceipt.seatLabel"), value: seatNumber },
    ];
    return (
      <div
        ref={ref}
        style={{
          width: 360,
          background: "#ffffff",
          color: "#0f172a",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 24,
          boxSizing: "border-box",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", borderBottom: "2px dashed #cbd5e1", paddingBottom: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#64748b" }}>
            {t("seatReceipt.title")}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, lineHeight: 1.25 }}>{tournamentName}</div>
          {tournamentDate ? (
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{formatDateTime(tournamentDate)}</div>
          ) : null}
        </div>

        {/* Table / Seat */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          {cells.map((cell) => (
            <div
              key={cell.label}
              style={{
                flex: 1,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                padding: "12px 8px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 11, letterSpacing: 2, color: "#64748b" }}>{cell.label}</div>
              <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, color: "#0f172a" }}>{cell.value}</div>
            </div>
          ))}
        </div>

        {/* Player */}
        <div style={{ textAlign: "center", marginBottom: startingStack != null ? 4 : 12 }}>
          <div style={{ fontSize: 11, letterSpacing: 1, color: "#64748b" }}>{t("seatReceipt.player")}</div>
          <div style={{ fontSize: 20, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>{playerName}</div>
        </div>

        {startingStack != null ? (
          <div style={{ textAlign: "center", fontSize: 13, color: "#475569", marginBottom: 12 }}>
            {t("seatReceipt.startingStack")} <strong>{formatStack(startingStack)}</strong>
          </div>
        ) : null}

        {/* QR + receipt code */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 8 }}>
          <div style={{ background: "#ffffff", padding: 8, border: "1px solid #e2e8f0", borderRadius: 8 }}>
            <QRCodeSVG value={qrValue} size={150} level="M" />
          </div>
          <div
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            {receiptCode}
          </div>
        </div>

        <div style={{ textAlign: "center", fontSize: 10, color: "#94a3b8", marginTop: 12, fontStyle: "italic" }}>
          {t("seatReceipt.footerNote")}
        </div>
      </div>
    );
  },
);
SeatReceipt.displayName = "SeatReceipt";
