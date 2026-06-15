// Orientation toggle (Viewer Event Hub). Segmented control (Ngang / Dọc) shown in
// the featured-table card header. Now WIRED: the selected orientation is lifted to
// LiveHub, which passes it to TournamentLiveView as a presentational override so
// the felt actually re-orients (landscape ⇄ portrait) on phone AND desktop.
// Supports both controlled (`value` + `onChange`) and uncontrolled use.

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";

type Orientation = "landscape" | "portrait";

export interface OrientationToggleProps {
  /** Controlled value. When provided, the toggle reflects it and defers state to the parent. */
  value?: Orientation;
  defaultValue?: Orientation;
  onChange?: (value: Orientation) => void;
}

export function OrientationToggle({ value: controlled, defaultValue = "landscape", onChange }: OrientationToggleProps) {
  const [internal, setInternal] = useState<Orientation>(defaultValue);
  const value = controlled ?? internal;
  const pick = (o: Orientation) => {
    if (controlled === undefined) setInternal(o);
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
