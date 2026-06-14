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
    <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/70 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Search className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <span className="font-display text-sm tracking-wider">TÌM KIẾM</span>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Tên dealer / số bàn…"
          aria-label="Tìm bàn hoặc dealer"
          className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-800/50 pl-8 pr-8 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-primary/50"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Xoá tìm kiếm"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
