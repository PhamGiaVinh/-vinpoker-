import type React from "react";
import { BadgeCheck, Building2, Check, LogOut, Phone, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { formatVND } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { useStaffLink } from "@/hooks/staff/useStaffLink";
import { STAFF_DEPARTMENT_LABELS } from "@/types/staffApp";
import { StaffNotLinkedScreen } from "../StaffNotLinkedScreen";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase() || "NV";
}

export function StaffAccountScreen() {
  const { signOut } = useAuth();
  const { staff, memberships, setSelectedStaffId, isStaff, loading } = useStaffLink();

  if (loading) return null;
  if (!isStaff || !staff) return <StaffNotLinkedScreen />;

  const payLabel =
    staff.employmentType === "part_time"
      ? staff.hourlyRateVnd
        ? `${formatVND(staff.hourlyRateVnd)}/giờ`
        : "Theo giờ"
      : staff.monthlySalaryVnd
        ? `${formatVND(staff.monthlySalaryVnd)}/tháng`
        : "Theo tháng";

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-display font-bold text-foreground">Tài khoản</h1>

      <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/30 grid place-items-center text-primary font-display font-bold">
          {initials(staff.fullName)}
        </div>
        <div className="min-w-0">
          <div className="text-base font-bold text-foreground truncate">{staff.fullName}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[12px] text-muted-foreground">{STAFF_DEPARTMENT_LABELS[staff.department]}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
              <BadgeCheck className="w-3.5 h-3.5" />
              {staff.status}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card divide-y divide-border">
        <InfoRow Icon={Building2} label="CLB hiện tại" value={staff.clubName} />
        <InfoRow Icon={Phone} label="Điện thoại" value={staff.phone || "-"} />
        <InfoRow Icon={WalletCards} label="Cấu hình lương" value={payLabel} />
      </div>

      {memberships.length > 0 && (
        <div>
          <div className="text-[12px] text-muted-foreground mb-1.5 px-1">Hồ sơ đã liên kết</div>
          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            {memberships.map((m) => {
              const active = m.staffId === staff.staffId;
              return (
                <button key={m.staffId} onClick={() => setSelectedStaffId(m.staffId)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <Building2 className={active ? "w-4 h-4 text-primary" : "w-4 h-4 text-muted-foreground"} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-foreground truncate">{m.clubName}</div>
                    <div className="text-[11px] text-muted-foreground">{STAFF_DEPARTMENT_LABELS[m.department]}</div>
                  </div>
                  {active ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                      <Check className="w-3.5 h-3.5" />
                      Đang xem
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Chọn</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
        <span className="text-[13px] text-muted-foreground">Ngôn ngữ</span>
        <LanguageSwitcher />
      </div>

      <Button variant="outline" onClick={() => signOut()} className="w-full text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive">
        <LogOut className="w-4 h-4 mr-1.5" />
        Đăng xuất
      </Button>
    </div>
  );
}

function InfoRow({ Icon, label, value }: { Icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className="w-4 h-4 text-muted-foreground" />
      <span className="text-[13px] text-muted-foreground flex-1">{label}</span>
      <span className="text-[13px] font-bold text-foreground text-right">{value}</span>
    </div>
  );
}
