import { forwardRef, type CSSProperties } from "react";
import { formatVndShort } from "@/lib/clubFinance";
import type { ScheduleEvent } from "@/lib/series-intelligence/scheduleGenerator";
import { dayDateLabel, formatRegEndLabel, festivalDateRange, type SchedulePosterHeader } from "@/lib/series-intelligence/scheduleExport";

/**
 * Festival schedule poster — a self-contained, HARDCODED-HEX render (NO Tailwind theme tokens / CSS vars /
 * oklch) so html2canvas rasterizes it faithfully. Premium green-felt palette, consistent with the Monte Carlo
 * redesign. forwardRef so the panel can capture the natural-size node to PNG.
 *
 * The footer is CONDITIONAL: `published=false` (default) stamps a DRAFT banner — a safe default so an
 * unreviewed schedule is never published by accident; the owner flips `published` via an explicit confirmation
 * to produce a clean, publishable poster. Pure presentational — no state, no side effects.
 */

const MONO = '"JetBrains Mono","SF Mono","Consolas","Roboto Mono",ui-monospace,monospace';
const SANS = '"Inter","Segoe UI",system-ui,-apple-system,sans-serif';
const FELT = "#0B3D2E";
const FELT_DARK = "#072a20";
const GOLD = "#C8A24B";
const CREAM = "#F5ECD7";
const MUTED = "#9DB3A6";
const GOLD_BORDER = "rgba(200,162,75,0.30)";
const ROW_BORDER = "rgba(255,255,255,0.07)";
const POSTER_WIDTH = 960;

interface Props {
  events: ScheduleEvent[];
  header: SchedulePosterHeader;
  published?: boolean;
}

interface DayGroup {
  day: number;
  rows: ScheduleEvent[];
}

function groupByDay(events: ScheduleEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const idx = new Map<number, number>();
  for (const e of events) {
    let i = idx.get(e.day);
    if (i === undefined) {
      i = groups.length;
      idx.set(e.day, i);
      groups.push({ day: e.day, rows: [] });
    }
    groups[i].rows.push(e);
  }
  groups.sort((a, b) => a.day - b.day);
  return groups;
}

function formatStack(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}

const TH: CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${GOLD_BORDER}`, fontWeight: 600, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: GOLD };
const TH_R: CSSProperties = { ...TH, textAlign: "right" };
const TD: CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${ROW_BORDER}`, verticalAlign: "top" };
const TD_R: CSSProperties = { ...TD, textAlign: "right", whiteSpace: "nowrap", fontFamily: MONO };

export const SchedulePosterDocument = forwardRef<HTMLDivElement, Props>(function SchedulePosterDocument(
  { events, header, published = false },
  ref,
) {
  const days = groupByDay(events);
  const title = (header.title?.trim() || "LỊCH FESTIVAL").toUpperCase();
  const dateRange = festivalDateRange(days.map((d) => d.day), header.startDate);

  return (
    <div
      ref={ref}
      style={{
        width: POSTER_WIDTH,
        background: `linear-gradient(160deg, ${FELT} 0%, ${FELT_DARK} 100%)`,
        color: CREAM,
        fontFamily: SANS,
        boxSizing: "border-box",
      }}
    >
      {/* header band */}
      <div style={{ padding: "40px 44px 26px", borderBottom: `2px solid ${GOLD}` }}>
        <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: 3, color: GOLD, textTransform: "uppercase" }}>VinPoker · Series Intelligence</div>
        <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 1, color: CREAM, lineHeight: 1.05, marginTop: 8 }}>{title}</div>
        {header.subtitle?.trim() ? <div style={{ fontSize: 18, color: GOLD, marginTop: 6 }}>{header.subtitle.trim()}</div> : null}
        {(header.venue?.trim() || dateRange) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginTop: 14, fontSize: 14, color: MUTED }}>
            {header.venue?.trim() ? <span>{header.venue.trim()}</span> : null}
            {dateRange ? <span style={{ fontFamily: MONO }}>{dateRange}</span> : null}
          </div>
        )}
      </div>

      {/* per-day tables */}
      <div style={{ padding: "8px 44px 0" }}>
        {days.map(({ day, rows }) => (
          <div key={day} style={{ marginTop: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 6, height: 22, background: GOLD, borderRadius: 2 }} />
              <div style={{ fontSize: 19, fontWeight: 700, color: CREAM }}>{dayDateLabel(day, header.startDate)}</div>
              <div style={{ fontFamily: MONO, fontSize: 12, color: MUTED }}>· {rows.length} event</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, width: 60 }}>Giờ</th>
                  <th style={TH}>Event</th>
                  <th style={TH_R}>GTD</th>
                  <th style={TH_R}>Buy-in</th>
                  <th style={{ ...TH_R, width: 70 }}>Stack</th>
                  <th style={{ ...TH_R, width: 56 }}>Level</th>
                  <th style={{ ...TH_R, width: 116 }}>Reg-end</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e, i) => (
                  <tr key={i} style={{ background: i % 2 ? "rgba(255,255,255,0.03)" : "transparent", borderLeft: `3px solid ${e.isCustom ? GOLD : "transparent"}` }}>
                    <td style={{ ...TD, fontFamily: MONO, color: GOLD, fontWeight: 700 }}>{e.startTime}</td>
                    <td style={{ ...TD, color: CREAM }}>
                      {e.name}
                      {e.isCustom ? <span style={{ marginLeft: 8, fontFamily: MONO, fontSize: 10, color: GOLD, border: `1px solid ${GOLD_BORDER}`, borderRadius: 4, padding: "1px 5px" }}>+ tự thêm</span> : null}
                    </td>
                    <td style={{ ...TD_R, fontWeight: 700, color: e.GTD ? CREAM : MUTED }}>{e.GTD ? formatVndShort(e.GTD) : "—"}</td>
                    <td style={{ ...TD_R, color: MUTED }}>{formatVndShort(e.buy_in_prize)}</td>
                    <td style={{ ...TD_R, color: MUTED }}>{formatStack(e.startingStack)}</td>
                    <td style={{ ...TD_R, color: MUTED }}>{e.minutesPerLevel}'</td>
                    <td style={{ ...TD_R, color: e.regEndNextDay ? GOLD : MUTED }}>{formatRegEndLabel(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* conditional footer */}
      <div style={{ marginTop: 26 }}>
        {published ? (
          <div style={{ padding: "18px 44px 30px", borderTop: `2px solid ${GOLD}`, display: "flex", justifyContent: "space-between", alignItems: "center", color: MUTED, fontSize: 13 }}>
            <span>{header.footer?.trim() || header.venue?.trim() || "VinPoker Poker Series"}</span>
            <span style={{ fontFamily: MONO, color: GOLD, letterSpacing: 2 }}>VinPoker</span>
          </div>
        ) : (
          <div style={{ padding: "16px 44px 30px" }}>
            <div style={{ background: "rgba(202,86,40,0.14)", border: "1px solid rgba(202,86,40,0.5)", borderRadius: 8, padding: "12px 16px", color: "#F0C9B5", fontSize: 13 }}>
              <strong style={{ color: "#E6794D", letterSpacing: 1 }}>DRAFT — cần TD review trước khi dùng thật.</strong>{" "}
              Lịch ước lượng (giờ &amp; cấu trúc là DRAFT), KHÔNG phải lịch chốt. Bật "đã TD review" để xuất bản chính thức.
            </div>
            {header.footer?.trim() ? <div style={{ marginTop: 10, color: MUTED, fontSize: 12 }}>{header.footer.trim()}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
});
