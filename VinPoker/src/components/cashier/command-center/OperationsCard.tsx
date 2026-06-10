import { Loader2, Zap, LayoutDashboard, UserCheck, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface Props {
  autoSwingEnabled: boolean;
  exceptionsCount: number;
  totalTables: number;
  tablesCovered: number;
  onToggleAutoSwing: () => void;
  onAutoSwingAll: () => void;
  onMassAssign: () => void;
  swingAllBusy: boolean;
  massAssignBusy: boolean;
  onPreAssign?: () => void;
  preAssignBusy?: boolean;
}

function HealthBadge({ enabled, coverageRatio, exceptions }: {
  enabled: boolean; coverageRatio: number; exceptions: number;
}) {
  if (!enabled) {
    return (
      <div className="flex items-center gap-1.5">
        <XCircle className="w-3.5 h-3.5 text-red-500" />
        <span className="text-[11px] font-semibold text-red-500">Đã tắt</span>
      </div>
    );
  }
  if (exceptions > 0 || coverageRatio < 0.8) {
    return (
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-[11px] font-semibold text-amber-500">Cảnh báo</span>
        <span className="text-[10px] text-muted-foreground">{exceptions} vấn đề</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
      <span className="text-[11px] font-semibold text-emerald-500">Đang chạy</span>
    </div>
  );
}

export default function OperationsCard({
  autoSwingEnabled, exceptionsCount, totalTables, tablesCovered,
  onToggleAutoSwing, onAutoSwingAll, onMassAssign, onPreAssign,
  swingAllBusy, massAssignBusy, preAssignBusy,
}: Props) {
  const coverageRatio = totalTables > 0 ? tablesCovered / totalTables : 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Zap className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Vận hành
        </span>
      </div>

      {/* Auto-Swing health + toggle */}
      <div className="flex items-center justify-between px-3 py-2 border border-border rounded-sm">
        <HealthBadge
          enabled={autoSwingEnabled}
          coverageRatio={coverageRatio}
          exceptions={exceptionsCount}
        />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">Tự động</span>
          <Switch checked={autoSwingEnabled} onCheckedChange={onToggleAutoSwing} className="scale-75" />
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-3 gap-1">
        <Button
          size="sm"
          variant={swingAllBusy ? "default" : "outline"}
          className="text-[11px] h-7"
          onClick={onAutoSwingAll}
          disabled={swingAllBusy}
        >
          {swingAllBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}
          Swing All
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-[11px] h-7"
          onClick={onMassAssign}
          disabled={massAssignBusy}
        >
          {massAssignBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <LayoutDashboard className="w-3 h-3 mr-1" />}
          Gán loạt
        </Button>
        {onPreAssign ? (
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7"
            onClick={onPreAssign}
            disabled={preAssignBusy}
          >
            {preAssignBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <UserCheck className="w-3 h-3 mr-1" />}
            Pre-assign
          </Button>
        ) : null}
      </div>
    </div>
  );
}
