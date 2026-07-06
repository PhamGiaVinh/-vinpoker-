export interface CardBackData {
  clubName: string;
  clubLogoUrl?: string | null;
  rules: string[];
  hotline?: string;
  address?: string;
}

/**
 * CR80 (85.6 × 54 mm) member card — BACK: club rules + contact. Light back (contrast to the dark front),
 * gold accent to match brand. Print-safe (explicit hex + mm units).
 */
const INK = "#1a1420";
const GOLD = "#a6813c";
const LINE = "#e4ddd2";
const SUB = "#6b6270";

export default function MemberCardBackPreview({
  data,
  className = "",
}: {
  data: CardBackData;
  className?: string;
}) {
  const rules = data.rules.filter((r) => r.trim().length > 0);
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        width: "85.6mm",
        height: "54mm",
        padding: "3.2mm",
        boxSizing: "border-box",
        borderRadius: "3mm",
        background: "#faf7f2",
        color: INK,
        border: `0.3mm solid ${LINE}`,
        boxShadow: "0 6px 20px -8px rgba(0,0,0,0.35)",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      {/* top gold rule */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1.2mm", background: `linear-gradient(90deg, ${GOLD}, #d8bc85)` }} />

      {/* Header */}
      <div className="flex items-center gap-2" style={{ paddingTop: "1mm", paddingBottom: "1.2mm", marginBottom: "1.5mm", borderBottom: `0.3mm solid ${LINE}` }}>
        {data.clubLogoUrl ? (
          <img src={data.clubLogoUrl} alt="" style={{ width: "6mm", height: "6mm", objectFit: "contain", borderRadius: "0.8mm" }} />
        ) : null}
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: "5.6pt", lineHeight: 1.1, letterSpacing: "0.12em", color: GOLD }} className="uppercase font-semibold">
            Nội quy hội viên
          </div>
          <div style={{ fontSize: "8pt", lineHeight: 1.1, color: INK }} className="font-bold truncate">
            {data.clubName}
          </div>
        </div>
      </div>

      {/* Rules */}
      <ul style={{ fontSize: "6.4pt", lineHeight: 1.28, paddingLeft: "3.4mm", listStyleType: "disc" }}>
        {rules.length === 0 ? (
          <li style={{ color: SUB, fontStyle: "italic" }}>Chưa có nội quy</li>
        ) : (
          rules.slice(0, 6).map((r, i) => (
            <li key={i} style={{ color: "#3d3547", marginBottom: "0.35mm" }}>{r}</li>
          ))
        )}
      </ul>

      {/* Footer contact */}
      <div
        className="absolute left-0 right-0"
        style={{ bottom: 0, paddingLeft: "3.2mm", paddingRight: "3.2mm", paddingTop: "1mm", paddingBottom: "1.6mm", fontSize: "6pt", lineHeight: 1.3, borderTop: `0.3mm solid ${LINE}` }}
      >
        {data.hotline ? (
          <div className="truncate"><span style={{ color: SUB }}>Hotline: </span><span className="font-semibold" style={{ color: INK }}>{data.hotline}</span></div>
        ) : null}
        {data.address ? (
          <div className="truncate"><span style={{ color: SUB }}>Địa chỉ: </span><span style={{ color: "#3d3547" }}>{data.address}</span></div>
        ) : null}
      </div>
    </div>
  );
}
