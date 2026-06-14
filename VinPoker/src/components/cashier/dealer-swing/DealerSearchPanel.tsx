/**
 * DealerSearchPanel — quick "Tìm kiếm" box for the Dealer Control left column
 * (UI polish). PRESENTATION ONLY: a controlled text filter; the parent applies
 * it to the existing battle-map list (by table name / dealer name). No query.
 */

import { Search, X } from "lucide-react";

export interface DealerSearchPanelProps {
  value: string;
  onChange: (v: string) => void;
}

export default function DealerSearchPanel({ value, onChange }: DealerSearchPanelProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/70 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Search className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <span className="font-display text-sm tracking-wider">TÌM KIẾM</span>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Tên dealer / số bàn…"
          aria-label="Tìm bàn hoặc dealer"
          className="h-11 w-full rounded-lg border border-border bg-muted/50 pl-8 pr-8 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Xoá tìm kiếm"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
