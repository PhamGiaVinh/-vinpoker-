import { Lock, Monitor } from "lucide-react";

/**
 * RoleLockedAction — hiện hành động nhưng KHOÁ (theo vai trò) hoặc desktop-only, nêu lý do (không phải
 * nút disabled câm). Cốt lõi để floor KHÔNG thao tác tiền. docs/design/ios-operations-components.md §12.
 */
export function RoleLockedAction({
  label,
  reason,
  mode = "roleLocked",
}: {
  label: string;
  reason?: string;
  mode?: "roleLocked" | "desktopOnly";
}) {
  return (
    <div className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 py-2 text-[13px] text-muted-foreground">
      {mode === "desktopOnly" ? <Monitor className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
      {label}
      {reason && <span className="text-[11px]">· {reason}</span>}
    </div>
  );
}
