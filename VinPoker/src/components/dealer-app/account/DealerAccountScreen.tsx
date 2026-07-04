import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, BadgeCheck, Building2, Award, Link2, UserPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useAuth } from "@/hooks/useAuth";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";
import { VerificationStatusCard } from "../onboarding/VerificationStatusCard";
import { DealerClaimDrawer } from "../onboarding/DealerClaimDrawer";
import { StaffInviteDrawer } from "../onboarding/StaffInviteDrawer";
import { PushNotificationOptIn } from "./PushNotificationOptIn";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase() || "VB";
}

export function DealerAccountScreen() {
  const { t } = useTranslation();
  const { signOut, isAdmin, isClubOwner } = useAuth();
  const { dealer, memberships, setSelectedDealerId } = useDealerLink();
  const [claimOpen, setClaimOpen] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);

  const rows = [
    { Icon: Award, label: t("dealer.account.tier", "Hạng dealer"), value: dealer?.tier ? `Tier ${dealer.tier}` : "—" },
  ];

  return (
    <div>
      <h1 className="text-xl font-display font-bold text-foreground mb-3">{t("dealer.account.title", "Tài khoản")}</h1>

      <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3 mb-3">
        <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/30 grid place-items-center text-primary font-display font-bold">
          {initials(dealer?.fullName ?? "VB")}
        </div>
        <div className="min-w-0">
          <div className="text-base font-bold text-foreground truncate">{dealer?.fullName ?? "—"}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[12px] text-muted-foreground">{t("dealer.account.role", "Dealer")}</span>
            {dealer?.isVerified && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                <BadgeCheck className="w-3.5 h-3.5" />
                {t("dealer.account.verified", "Đã xác minh")}
              </span>
            )}
          </div>
        </div>
      </div>

      <VerificationStatusCard />

      <PushNotificationOptIn />

      <div className="rounded-2xl border border-border bg-card divide-y divide-border mb-3">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <r.Icon className="w-4 h-4 text-muted-foreground" />
            <span className="text-[13px] text-muted-foreground flex-1">{r.label}</span>
            <span className="text-[13px] font-bold text-foreground">{r.value}</span>
          </div>
        ))}
      </div>

      {memberships.length > 0 && (
        <div className="mb-3">
          <div className="text-[12px] text-muted-foreground mb-1.5 px-1">
            {t("dealer.club.linkedTitle", "Câu lạc bộ đã liên kết")}
          </div>
          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            {memberships.map((m) => {
              const active = m.dealerId === dealer?.dealerId;
              return (
                <button
                  key={m.dealerId}
                  onClick={() => setSelectedDealerId(m.dealerId)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  <Building2 className={active ? "w-4 h-4 text-primary" : "w-4 h-4 text-muted-foreground"} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-foreground truncate">{m.clubName}</div>
                    <div className="text-[11px] text-muted-foreground">Tier {m.tier}</div>
                  </div>
                  {active ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                      <Check className="w-3.5 h-3.5" />
                      {t("dealer.club.active", "Đang xem")}
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{t("dealer.club.switchTo", "Chọn")}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={() => setClaimOpen(true)}
        className="w-full flex items-center justify-between rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3.5 font-bold text-primary mb-2"
      >
        <span className="flex items-center gap-2">
          <Link2 className="w-4 h-4" />
          {t("dealer.onboarding.claimEntry", "Liên kết tài khoản dealer")}
        </span>
        <span>›</span>
      </button>

      {(isAdmin || isClubOwner) && (
        <button
          onClick={() => setStaffOpen(true)}
          className="w-full flex items-center justify-between rounded-2xl border border-[#E6B84C]/30 bg-card px-4 py-3.5 font-bold mb-3"
          style={{ color: "#E6B84C" }}
        >
          <span className="flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            {t("dealer.onboarding.staffEntry", "Mời dealer vào app (Staff)")}
          </span>
          <span>›</span>
        </button>
      )}

      <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 mb-3">
        <span className="text-[13px] text-muted-foreground">{t("dealer.account.language", "Ngôn ngữ")}</span>
        <LanguageSwitcher />
      </div>

      <Button
        variant="outline"
        onClick={() => signOut()}
        className="w-full text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut className="w-4 h-4 mr-1.5" />
        {t("dealer.account.signOut", "Đăng xuất")}
      </Button>

      <DealerClaimDrawer open={claimOpen} onOpenChange={setClaimOpen} />
      <StaffInviteDrawer open={staffOpen} onOpenChange={setStaffOpen} />
    </div>
  );
}
