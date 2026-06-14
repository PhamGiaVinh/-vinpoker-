import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Phone, Mail, MessageCircle, Headphones, Send } from "lucide-react";
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

export function HrContactSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const rows = [
    { Icon: Phone, label: t("dealer.careers.hr.phone", "Điện thoại"), value: "1900 8386" },
    { Icon: Mail, label: t("dealer.careers.hr.email", "Email"), value: "hr@vbacker.vn" },
    { Icon: MessageCircle, label: t("dealer.careers.hr.zalo", "Zalo"), value: "VBacker HR" },
  ];
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-md mx-auto">
        <DrawerHeader className="text-left">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-primary/10 border border-primary/30 text-primary">
            <Headphones className="w-5 h-5" />
          </span>
          <DrawerTitle>{t("dealer.careers.hr.title", "Phòng Nhân sự VBacker")}</DrawerTitle>
          <DrawerDescription>{t("dealer.careers.hr.subtitle", "Hỗ trợ tuyển dụng & đào tạo dealer")}</DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-2 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
              <r.Icon className="w-4 h-4 text-primary" />
              <span className="text-[12px] text-muted-foreground flex-1">{r.label}</span>
              <span className="text-[13px] font-bold text-foreground">{r.value}</span>
            </div>
          ))}
        </div>
        <DrawerFooter>
          <Button
            onClick={() => toast.info(t("dealer.toast.previewOnly", "Bản xem trước — thao tác sẽ bật khi triển khai"))}
            className="gradient-neon text-primary-foreground border-0 font-bold"
          >
            <Send className="w-4 h-4 mr-1.5" />
            {t("dealer.careers.hr.message", "Gửi tin nhắn")}
          </Button>
          <DrawerClose asChild>
            <Button variant="outline">{t("dealer.careers.detail.close", "Đóng")}</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
