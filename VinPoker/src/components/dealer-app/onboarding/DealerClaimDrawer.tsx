import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { Phone, MessageSquare, Send } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DealerLinkMethod } from "@/types/dealerApp";

/**
 * Dealer self-claim: link an auth account to a dealer record by phone (match the
 * phone on file) or by a Telegram/club link code. Inc 8 = mock (preview toast);
 * the live RPCs (dealer_self_link_by_phone / dealer_self_link_by_code) wire in a
 * later owner-gated increment.
 */
export function DealerClaimDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<DealerLinkMethod>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");
  const preview = () => toast.info(t("dealer.toast.previewOnly", "Bản xem trước — thao tác sẽ bật khi triển khai"));

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-md mx-auto">
        <DrawerHeader className="text-left">
          <DrawerTitle>{t("dealer.onboarding.claimTitle", "Liên kết tài khoản dealer")}</DrawerTitle>
          <DrawerDescription>
            {t("dealer.onboarding.claimSub", "Liên kết tài khoản đăng nhập với hồ sơ dealer của bạn.")}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-2">
          <div className="grid grid-cols-2 gap-1 bg-card border border-border rounded-xl p-1 mb-3">
            <SegBtn active={method === "phone"} onClick={() => setMethod("phone")} icon={Phone} label={t("dealer.onboarding.byPhone", "Số điện thoại")} />
            <SegBtn active={method === "telegram"} onClick={() => setMethod("telegram")} icon={MessageSquare} label={t("dealer.onboarding.byCode", "Mã liên kết")} />
          </div>

          {method === "phone" ? (
            <div className="space-y-2">
              <label className="text-[12px] text-muted-foreground">{t("dealer.onboarding.phoneLabel", "Số điện thoại đã đăng ký")}</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="09xx xxx xxx" />
              {!otpSent ? (
                <Button onClick={() => { setOtpSent(true); preview(); }} className="w-full gradient-neon text-primary-foreground border-0 font-bold">
                  {t("dealer.onboarding.sendOtp", "Gửi mã xác minh")}
                </Button>
              ) : (
                <>
                  <label className="text-[12px] text-muted-foreground">{t("dealer.onboarding.otpLabel", "Mã OTP")}</label>
                  <Input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" placeholder="••••••" />
                  <Button onClick={preview} className="w-full gradient-neon text-primary-foreground border-0 font-bold">
                    {t("dealer.onboarding.confirmLink", "Xác nhận liên kết")}
                  </Button>
                </>
              )}
              <p className="text-[11px] text-muted-foreground">
                {t("dealer.onboarding.phoneHint", "Hệ thống sẽ khớp số này với hồ sơ dealer do CLB tạo.")}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-[12px] text-muted-foreground">{t("dealer.onboarding.codeLabel", "Mã liên kết từ CLB / Telegram")}</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="VBK-XXXX" />
              <Button onClick={preview} className="w-full gradient-neon text-primary-foreground border-0 font-bold">
                <Send className="w-4 h-4 mr-1.5" />
                {t("dealer.onboarding.linkNow", "Liên kết ngay")}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {t("dealer.onboarding.codeHint", "Nhận mã từ quản lý CLB hoặc lệnh /setup trên Telegram.")}
              </p>
            </div>
          )}
        </div>

        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">{t("dealer.careers.detail.close", "Đóng")}</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function SegBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-bold transition-colors",
        active ? "bg-primary/15 text-primary border border-primary/35" : "text-muted-foreground"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
