import { useMemo } from "react";
import { useLiveClock } from "@/hooks/useLiveClock";

interface Props {
  minutesLeft: number;
  dealerName: string;
  telegramUsername?: string | null;
  confidence: "confirmed" | "predicted";
}

export function NextDealerPreview({
  minutesLeft,
  dealerName,
  telegramUsername,
  confidence,
}: Props) {
  const now = useLiveClock();

  const secs = useMemo(() => {
    const totalSeconds = Math.floor(minutesLeft * 60);
    return totalSeconds % 60;
  }, [minutesLeft, now]);

  const mins = Math.floor(minutesLeft);
  const isUrgent = mins <= 1;
  const confirmed = confidence === "confirmed";

  const borderColor = confirmed
    ? "border-l-emerald-500"
    : "border-l-amber-500";

  const bgColor = confirmed
    ? "bg-emerald-500/5"
    : "bg-amber-500/5";

  return (
    <div
      className={`mt-2 px-3 py-2 border-l-4 ${borderColor} ${bgColor} ${isUrgent ? "animate-pulse" : ""}`}
    >
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-bold tracking-wider uppercase">
          {confirmed ? "✅ Next Dealer" : "🔮 Predicted"}
        </span>
        <span className="font-mono text-xs font-bold tabular-nums">
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </span>
      </div>
      <div className="text-sm font-semibold mt-1 truncate">
        {dealerName}
      </div>
      {telegramUsername && (
        <div className="text-[11px] text-muted-foreground">
          @{telegramUsername}
        </div>
      )}
    </div>
  );
}
