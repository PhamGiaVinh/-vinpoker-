// Orientation toggle (Viewer Event Hub — Increment C). UI-ONLY segmented control
// (Ngang / Dọc) shown in the featured-table card header. Holds local selection
// state only — it does NOT re-orient the felt yet (the felt's portrait/landscape
// is decided inside TournamentLiveView via useIsMobile; wiring a real override is
// a future increment that would need a TV prop). Purely a visual affordance here.

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";

type Orientation = "landscape" | "portrait";

export interface OrientationToggleProps {
  defaultValue?: Orientation;
  /** Optional callback (unused for now — kept for the future wiring increment). */
  onChange?: (value: Orientation) => void;
}

export function OrientationToggle({ defaultValue = "landscape", onChange }: OrientationToggleProps) {
  const [value, setValue] = useState<Orientation>(defaultValue);
  const pick = (o: Orientation) => {
    setValue(o);
    onChange?.(o);
  };
  const Opt = ({ o, Icon, label }: { o: Orientation; Icon: typeof Monitor; label: string }) => (
    <button
      type="button"
      aria-pressed={value === o}
      aria-label={label}
      onClick={() => pick(o)}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition ${
        value === o ? "bg-warning/20 text-warning" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="w-3 h-3" aria-hidden="true" /> {label}
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/50 bg-card/60 p-0.5 shrink-0">
      <Opt o="landscape" Icon={Monitor} label="Ngang" />
      <Opt o="portrait" Icon={Smartphone} label="Dọc" />
    </div>
  );
}
