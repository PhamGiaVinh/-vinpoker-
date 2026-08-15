import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { formatDateTime, formatStack } from "@/lib/format";

export interface SeatReceiptData {
  tournamentName: string;
  /** Kept for call-site compatibility. It is never shown as a buy-in completion time. */
  tournamentDate?: string | null;
  playerName: string;
  tableNumber: number | null;
  seatNumber: number | null;
  receiptCode: string;
  /** Value encoded into the QR; this remains the server-issued receipt_code. */
  qrValue: string;
  startingStack?: number | null;
  status?: string | null;
  clubName?: string | null;
  clubAddress?: string | null;
  clubLogoUrl?: string | null;
  totalPay?: number | null;
  completedAt?: string | null;
  completedAtSource?: "confirmed_at" | "issued_at" | null;
  /** The registration reference_code shown to the player; it is not the QR payload. */
  confirmationCode?: string | null;
}

const receiptVnd = (amount: number) => `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)} VND`;

const clubInitials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((word) => word[0])
  .join("")
  .toUpperCase();

type RowProps = { label: string; value: string; strong?: boolean };

function ReceiptRow({ label, value, strong = false }: RowProps) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid #e7e3dc" }}>
      <span style={{ color: "#625d57", fontSize: 12, lineHeight: 1.35 }}>{label}</span>
      <span style={{ color: "#161310", fontSize: 13, lineHeight: 1.35, fontWeight: strong ? 800 : 600, textAlign: "right", overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

/**
 * Print-safe buy-in receipt. Its styles are deliberately self-contained because
 * the same node is captured by html2canvas and inserted into a fresh print window.
 */
export const SeatReceipt = forwardRef<HTMLDivElement, SeatReceiptData>(
  (
    {
      tournamentName,
      playerName,
      tableNumber,
      seatNumber,
      receiptCode,
      startingStack,
      qrValue,
      status = "confirmed",
      clubName,
      clubAddress,
      clubLogoUrl,
      totalPay,
      completedAt,
      completedAtSource,
      confirmationCode,
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const hasSeat = tableNumber != null && seatNumber != null;
    const isConfirmed = status === "confirmed";
    const completionLabel = completedAtSource === "issued_at"
      ? t("seatReceipt.issuedAt")
      : t("seatReceipt.completedAt");

    return (
      <section
        ref={ref}
        aria-label={t("seatReceipt.title")}
        style={{
          width: 302,
          maxWidth: "100%",
          boxSizing: "border-box",
          background: "#ffffff",
          color: "#161310",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          border: "1px solid #d8d1c7",
          borderRadius: 2,
          padding: "20px 18px 18px",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 14, borderBottom: "2px solid #161310" }}>
          {clubLogoUrl ? (
            <img
              src={clubLogoUrl}
              alt={clubName ? t("seatReceipt.clubLogoAlt", { club: clubName }) : ""}
              crossOrigin="anonymous"
              style={{ width: 38, height: 38, objectFit: "contain", flex: "0 0 auto" }}
            />
          ) : clubName ? (
            <div aria-hidden="true" style={{ width: 38, height: 38, display: "grid", placeItems: "center", boxSizing: "border-box", border: "1px solid #161310", color: "#161310", fontSize: 12, fontWeight: 800, letterSpacing: 0.5, flex: "0 0 auto" }}>
              {clubInitials(clubName)}
            </div>
          ) : null}
          <div style={{ minWidth: 0 }}>
            {clubName ? <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.25, overflowWrap: "anywhere" }}>{clubName}</div> : null}
            {clubAddress ? <div style={{ marginTop: 2, color: "#625d57", fontSize: 10, lineHeight: 1.4, overflowWrap: "anywhere" }}>{clubAddress}</div> : null}
          </div>
        </header>

        <div style={{ textAlign: "center", padding: "17px 0 15px" }}>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 0.7 }}>{t("seatReceipt.titleVi")}</div>
          <div style={{ marginTop: 2, color: "#625d57", fontSize: 10, fontWeight: 700, letterSpacing: 1.15 }}>{t("seatReceipt.titleEn")}</div>
          {isConfirmed ? (
            <div style={{ display: "inline-block", marginTop: 9, border: "1px solid #1f6f43", color: "#1f6f43", padding: "3px 7px", fontSize: 10, fontWeight: 800, letterSpacing: 0.45, textTransform: "uppercase" }}>
              {t("seatReceipt.confirmed")}
            </div>
          ) : null}
        </div>

        <div style={{ borderTop: "1px solid #e7e3dc" }}>
          {playerName ? <ReceiptRow label={t("seatReceipt.player")} value={playerName} strong /> : null}
          {completedAt ? <ReceiptRow label={completionLabel} value={formatDateTime(completedAt)} /> : null}
          {tournamentName ? <ReceiptRow label={t("seatReceipt.tournament")} value={tournamentName} /> : null}
          {totalPay != null ? <ReceiptRow label={t("seatReceipt.totalPay")} value={receiptVnd(totalPay)} strong /> : null}
          {startingStack != null ? <ReceiptRow label={t("seatReceipt.startingStack")} value={formatStack(startingStack)} /> : null}
        </div>

        <div style={{ marginTop: 14, padding: "12px 10px", border: "1px solid #d8d1c7", textAlign: "center" }}>
          {hasSeat ? (
            <>
              <div style={{ color: "#625d57", fontSize: 10, fontWeight: 700, letterSpacing: 0.8 }}>{t("seatReceipt.seatAssignment")}</div>
              <div style={{ marginTop: 5, fontSize: 20, fontWeight: 900, lineHeight: 1.1 }}>{t("seatReceipt.tableSeat", { table: tableNumber, seat: seatNumber })}</div>
            </>
          ) : (
            <div style={{ color: "#625d57", fontSize: 13, fontWeight: 700 }}>{t("seatReceipt.unassigned")}</div>
          )}
        </div>

        {qrValue ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 17 }}>
            <div style={{ display: "grid", placeItems: "center", width: 170, height: 170, boxSizing: "border-box", border: "1px solid #d8d1c7", background: "#ffffff" }}>
              <QRCodeSVG value={qrValue} size={150} level="M" includeMargin />
            </div>
            {confirmationCode ? (
              <div style={{ marginTop: 10, textAlign: "center" }}>
                <div style={{ color: "#625d57", fontSize: 9, fontWeight: 700, letterSpacing: 0.85 }}>{t("seatReceipt.confirmationCode")}</div>
                <div style={{ marginTop: 3, color: "#161310", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12, fontWeight: 800, letterSpacing: 0.45, overflowWrap: "anywhere" }}>{confirmationCode}</div>
              </div>
            ) : null}
            {!confirmationCode && receiptCode ? (
              <div style={{ marginTop: 9, color: "#625d57", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 10, overflowWrap: "anywhere", textAlign: "center" }}>{receiptCode}</div>
            ) : null}
          </div>
        ) : null}

        <footer style={{ marginTop: 17, paddingTop: 12, borderTop: "1px solid #e7e3dc", textAlign: "center" }}>
          <p style={{ margin: 0, color: "#4f4943", fontSize: 10, lineHeight: 1.45 }}>{t("seatReceipt.legalNotice")}</p>
          <p style={{ margin: "8px 0 0", color: "#625d57", fontSize: 10, lineHeight: 1.45 }}>{t("seatReceipt.footerNote")}</p>
          <p style={{ margin: "9px 0 0", color: "#161310", fontSize: 10, fontWeight: 900, letterSpacing: 0.7 }}>{t("seatReceipt.goodLuck")}</p>
        </footer>
      </section>
    );
  },
);
SeatReceipt.displayName = "SeatReceipt";
