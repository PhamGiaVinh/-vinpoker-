import { Radio, Users, Layers, Coins } from "lucide-react";

type LiveStatus = "registering" | "playing" | "finished";

interface Props {
  current_players?: number | null;
  current_level?: number | null;
  current_blinds?: string | null;
  live_status?: LiveStatus | null;
}

const STATUS_LABEL: Record<LiveStatus, string> = {
  registering: "Registering",
  playing: "Playing",
  finished: "Finished",
};

const STATUS_CLS: Record<LiveStatus, string> = {
  registering: "bg-warning/15 text-warning border-warning/40",
  playing: "bg-success/15 text-success border-success/40 animate-pulse",
  finished: "bg-muted/30 text-muted-foreground border-border",
};

const LiveStateBanner = ({ current_players, current_level, current_blinds, live_status }: Props) => {
  const status = (live_status ?? "registering") as LiveStatus;
  return (
    <div className="rounded-lg border border-neon/40 bg-gradient-to-br from-neon/5 to-transparent p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-neon">
          <Radio className="w-3.5 h-3.5" /> LIVE
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_CLS[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat icon={Users} label="Players" value={current_players ?? 0} />
        <Stat icon={Layers} label="Level" value={current_level ? `Lv ${current_level}` : "—"} />
        <Stat icon={Coins} label="Blind" value={current_blinds || "—"} />
      </div>
    </div>
  );
};

const Stat = ({ icon: Icon, label, value }: any) => (
  <div className="rounded-md bg-muted/30 px-2 py-1.5">
    <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase">
      <Icon className="w-3 h-3" />{label}
    </div>
    <div className="text-sm font-semibold mt-0.5">{value}</div>
  </div>
);
