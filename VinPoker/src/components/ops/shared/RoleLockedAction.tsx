import { Lock, Monitor } from "lucide-react";

/**
 * RoleLockedAction — hành động khoá (theo vai trò) hoặc desktop-only, nêu lý do (không phải nút disabled câm).
 * Cốt lõi để floor KHÔNG thao tác tiền. docs/design/ios-operations-components.md §12.
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
    <div className="ios-fill flex items-center justify-center gap-1.5 rounded-2xl py-3 text-[14px] text-[#9b8e97]">
      {mode === "desktopOnly" ? <Monitor className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
      {label}
      {reason && <span className="text-[12px] text-[#7c7079]">· {reason}</span>}
    </div>
  );
}
