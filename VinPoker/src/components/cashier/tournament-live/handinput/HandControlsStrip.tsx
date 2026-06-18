// Persistent hand controls (engine mode) — Undo / Reset / Void. In engine mode
// the ActionDock footer no longer renders (its street-jump / Hoàn-tất buttons are
// gone, and the bottom panel changes per workflow state), so these always-present
// controls are lifted into their own strip and shown beneath the guided panel.
// Same handlers (handleUndo / resetHand / handleVoid) — no behaviour change.

import { Undo2, RotateCcw, Ban } from "lucide-react";

interface HandControlsStripProps {
  onUndo: () => void;
  canUndo: boolean;
  onReset: () => void;
  onVoid: () => void;
  hasVoidTarget: boolean;
  disabled?: boolean;
}

export function HandControlsStrip({ onUndo, canUndo, onReset, onVoid, hasVoidTarget, disabled }: HandControlsStripProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-popover">
      <button
        type="button"
        onClick={onUndo}
        disabled={disabled || !canUndo}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-300 border border-amber-500/50 rounded-lg px-3.5 py-2 hover:bg-amber-500/10 transition disabled:opacity-35"
        aria-label="Hoàn tác hành động cuối"
      >
        <Undo2 className="w-4 h-4" aria-hidden="true" /> Hoàn tác
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-lg px-3 py-2 hover:text-foreground transition disabled:opacity-40"
      >
        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reset
      </button>
      {hasVoidTarget && (
        <button
          type="button"
          onClick={onVoid}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive border border-destructive/40 rounded-lg px-3 py-2 hover:bg-destructive/10 transition disabled:opacity-40"
        >
          <Ban className="w-3.5 h-3.5" aria-hidden="true" /> Void
        </button>
      )}
    </div>
  );
}
