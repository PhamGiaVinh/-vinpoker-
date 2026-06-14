/**
 * SwingTableActions — per-table action row for the redesigned Dealer Swing
 * card (UI Phase 4). Presentational only: the parent computes every guard /
 * disabled-reason and passes parameterless closures, so behavior is identical
 * to the previous inline row — only the layout changes:
 *   PRIMARY group (Chốt đổi dealer + Nghỉ)  →  "SỬA / ĐỐI SOÁT" divider
 *   →  CORRECTION group (Đổi dự kiến + Sửa nhầm bàn).
 * All buttons are ≥44px touch targets.
 */
import { Button } from "@/components/ui/button";
import { Clock, UserCog, RefreshCw, Loader2, AlertTriangle, Users } from "lucide-react";

export interface SwingTableActionsProps {
  /** "assigned" → full action set; "empty" → single Gán button. */
  mode: "assigned" | "empty";
  isOt: boolean;
  breakDisabled: boolean;
  swinging: boolean;
  swingDisabled: boolean;
  disabledReason?: string;
  changePredictedDisabled: boolean;
  changePredictedTitle: string;
  wrongTableEnabled: boolean;
  onBreak: () => void;
  onChangePredicted: () => void;
  onConfirmSwing: () => void;
  onCorrectWrongTable: () => void;
  onAssign: () => void;
}

const PRIMARY_H = "h-11"; // 44px touch target
const CORR_H = "h-11";

export default function SwingTableActions(p: SwingTableActionsProps) {
  if (p.mode === "empty") {
    return (
      <div className="pt-1">
        <Button size="sm" variant="outline" className={`w-full ${PRIMARY_H} text-sm text-primary`} onClick={p.onAssign}>
          <Users className="w-4 h-4 mr-1.5" /> Gán dealer
        </Button>
      </div>
    );
  }

  return (
    <div className="pt-1 space-y-2">
      {/* PRIMARY — final handoff + break */}
      <div className="flex gap-2">
        <span className="flex-[2]" title={p.disabledReason}>
          <Button size="sm" variant="outline"
            className={[
              `w-full ${PRIMARY_H} text-sm`,
              p.isOt
                ? "text-destructive border-destructive/40 hover:bg-destructive/10"
                : "text-warning border-warning/40 hover:bg-warning/10",
            ].join(" ")}
            onClick={p.onConfirmSwing}
            disabled={p.swingDisabled}>
            {p.swinging
              ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              : <RefreshCw className="w-4 h-4 mr-1.5" />}
            <span className="hidden sm:inline">{p.isOt ? "Chốt đổi khẩn cấp" : "Chốt đổi dealer"}</span>
            <span className="sm:hidden">{p.isOt ? "Chốt khẩn" : "Chốt"}</span>
          </Button>
        </span>
        <Button size="sm" variant="outline" className={`flex-1 ${PRIMARY_H} text-sm`}
          onClick={p.onBreak} disabled={p.breakDisabled}>
          <Clock className="w-4 h-4 mr-1.5" /> Nghỉ
        </Button>
      </div>

      {/* CORRECTION group — visually separated so it is never confused with the swing */}
      <div className="text-[11px] text-muted-foreground tracking-wider pt-0.5">SỬA / ĐỐI SOÁT</div>
      <div className="flex gap-2">
        <span className="flex-1" title={p.changePredictedTitle}>
          <Button size="sm" variant="outline"
            className={`w-full ${CORR_H} text-xs text-success border-success/40 hover:bg-success/10`}
            disabled={p.changePredictedDisabled}
            onClick={p.onChangePredicted}>
            <UserCog className="w-4 h-4 mr-1.5" />
            <span className="hidden sm:inline">Đổi dự kiến</span>
            <span className="sm:hidden">Dự kiến</span>
          </Button>
        </span>
        {p.wrongTableEnabled ? (
          <span className="flex-1" title="Sửa dealer nhầm bàn — ghi đúng dealer đang chia thực tế (có audit)">
            <Button size="sm" variant="outline"
              className={`w-full ${CORR_H} text-xs text-warning border-warning/40 hover:bg-warning/10`}
              onClick={p.onCorrectWrongTable}>
              <AlertTriangle className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Sửa nhầm bàn</span>
              <span className="sm:hidden">Nhầm bàn</span>
            </Button>
          </span>
        ) : (
          <span className="flex-1" title="Sắp ra mắt — cần bật Room Reconcile trước">
            <Button size="sm" variant="outline" className={`w-full ${CORR_H} text-xs text-muted-foreground border-border`} disabled>
              <AlertTriangle className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Sửa nhầm bàn</span>
              <span className="sm:hidden">Nhầm bàn</span>
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
