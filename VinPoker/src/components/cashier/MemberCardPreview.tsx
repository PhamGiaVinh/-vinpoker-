import { QRCodeCanvas } from "qrcode.react";

export interface CardData {
  clubName: string;
  clubLogoUrl?: string | null;
  fullName: string;
  memberCardId: string;
  reissueCode: string;
  issuedAt: Date;
}

/**
 * CR80 (85.6 × 54 mm) member card — FRONT. Premium Midnight Sakura look (dark plum + aged gold),
 * print-safe (explicit hex colors + mm units, never theme tokens, so it prints identically regardless
 * of app theme). The big avatar slot always shows the CLUB LOGO (not the player avatar).
 */
const PLUM = "#140c1e";
const PLUM_2 = "#0a0610";
const GOLD = "#c9a86a";
const GOLD_HI = "#e6cf9c";
const IVORY = "#f2ece6";
const MUTED = "#9b8e97";

export default function MemberCardPreview({ data, className = "" }: { data: CardData; className?: string }) {
  const dateStr = data.issuedAt.toLocaleDateString("vi-VN");
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        width: "85.6mm",
        height: "54mm",
        padding: "3.2mm",
        boxSizing: "border-box",
        borderRadius: "3mm",
        color: IVORY,
        background: `radial-gradient(120% 90% at 78% 0%, rgba(201,168,106,0.22), transparent 55%), linear-gradient(155deg, ${PLUM} 0%, ${PLUM_2} 100%)`,
        boxShadow: "0 6px 20px -8px rgba(0,0,0,0.6)",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      {/* gold hairline frame */}
      <div
        style={{
          position: "absolute", inset: "1mm", borderRadius: "2.2mm",
          border: `0.3mm solid rgba(201,168,106,0.45)`, pointerEvents: "none",
        }}
      />
      {/* Header */}
      <div className="flex items-center gap-2" style={{ position: "relative", marginBottom: "1.5mm" }}>
        {data.clubLogoUrl ? (
          <img
            src={data.clubLogoUrl}
            alt=""
            style={{ width: "8.5mm", height: "8.5mm", objectFit: "cover", borderRadius: "1.4mm", border: `0.3mm solid ${GOLD}` }}
          />
        ) : (
          <div style={{ width: "8.5mm", height: "8.5mm", borderRadius: "1.4mm", border: `0.3mm solid ${GOLD}`, display: "grid", placeItems: "center", fontSize: "9pt", color: GOLD }}>♠</div>
        )}
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: "5.6pt", lineHeight: 1.1, letterSpacing: "0.18em", color: GOLD }} className="uppercase font-semibold">
            Member Card
          </div>
          <div style={{ fontSize: "9.5pt", lineHeight: 1.1, color: IVORY }} className="font-bold truncate">
            {data.clubName}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex gap-2" style={{ position: "relative", marginTop: "1.8mm" }}>
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <div style={{ fontSize: "5.6pt", color: MUTED }} className="uppercase tracking-wider">Họ và tên</div>
            <div style={{ fontSize: "11.5pt", lineHeight: 1.1, color: IVORY }} className="font-bold truncate">
              {data.fullName}
            </div>
          </div>
          <div style={{ marginTop: "1.5mm" }}>
            <div style={{ fontSize: "5.6pt", color: MUTED }} className="uppercase tracking-wider">Mã thẻ</div>
            <div style={{ fontSize: "10.5pt", lineHeight: 1.1, color: GOLD_HI, letterSpacing: "0.06em" }} className="font-mono font-semibold">
              {data.memberCardId}
            </div>
          </div>
        </div>

        <div style={{ background: "#ffffff", borderRadius: "1.4mm", padding: "1mm", alignSelf: "flex-start" }} className="flex items-center justify-center">
          <QRCodeCanvas value={data.memberCardId} size={512} level="H" includeMargin={false} style={{ width: "19mm", height: "19mm" }} />
        </div>
      </div>

      {/* Footer */}
      <div
        className="absolute left-0 right-0 flex items-center justify-between"
        style={{ bottom: "1.8mm", paddingLeft: "3.2mm", paddingRight: "3.2mm", fontSize: "5.6pt", color: MUTED }}
      >
        <span>Cấp ngày {dateStr}</span>
        {data.reissueCode ? <span className="font-mono" style={{ color: GOLD }}>{data.reissueCode}</span> : <span />}
      </div>
    </div>
  );
}
