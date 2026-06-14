import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Search, UserPlus, Check, MapPin } from "lucide-react";
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
import { mockUnlinkedDealers } from "@/lib/dealerApp/mockDealerData";

/**
 * Staff "invite dealer to app" panel — search the club's dealer directory and
 * link a record to an auth account. Inc 8 = mock (preview toast + optimistic
 * "linked" state). The live staff RPC (link_dealer_to_user) wires in a later
 * owner-gated increment. NEVER touches the live Dealer Swing / attendance tables.
 */
export function StaffInviteDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [linkedIds, setLinkedIds] = useState<string[]>([]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return mockUnlinkedDealers().filter(
      (d) => !needle || d.fullName.toLowerCase().includes(needle) || d.phone.includes(needle)
    );
  }, [q]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-md mx-auto">
        <DrawerHeader className="text-left">
          <DrawerTitle>{t("dealer.onboarding.staffTitle", "Mời dealer vào app")}</DrawerTitle>
          <DrawerDescription>
            {t("dealer.onboarding.staffSub", "Liên kết hồ sơ dealer của CLB với tài khoản đăng nhập.")}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-2">
          <div className="relative mb-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("dealer.onboarding.searchDealer", "Tìm theo tên / SĐT")} className="pl-9" />
          </div>
          <div className="space-y-2 max-h-[46vh] overflow-auto">
            {rows.map((d) => {
              const linked = d.linked || linkedIds.includes(d.id);
              return (
                <div key={d.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-foreground truncate">{d.fullName}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                      <span>{d.phone}</span>
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" />
                        {d.region}
                      </span>
                    </div>
                  </div>
                  {linked ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary shrink-0">
                      <Check className="w-3.5 h-3.5" />
                      {t("dealer.onboarding.linked", "Đã liên kết")}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        setLinkedIds((prev) => [...prev, d.id]);
                        toast.success(t("dealer.onboarding.invited", "Đã gửi lời mời (demo)"));
                      }}
                      className="gradient-neon text-primary-foreground border-0 font-bold h-8 text-[12px] shrink-0"
                    >
                      <UserPlus className="w-3.5 h-3.5 mr-1" />
                      {t("dealer.onboarding.invite", "Mời")}
                    </Button>
                  )}
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="text-center text-[12px] text-muted-foreground py-6">
                {t("dealer.onboarding.noDealer", "Không tìm thấy dealer")}
              </div>
            )}
          </div>
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
