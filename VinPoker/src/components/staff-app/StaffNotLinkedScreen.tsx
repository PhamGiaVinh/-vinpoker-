import { Link2, UserRoundCheck } from "lucide-react";
import { Card } from "@/components/ui/card";

export function StaffNotLinkedScreen() {
  return (
    <Card className="p-5 border-border text-center space-y-3">
      <span className="mx-auto grid place-items-center w-12 h-12 rounded-xl bg-muted text-muted-foreground">
        <UserRoundCheck className="w-6 h-6" />
      </span>
      <div>
        <h1 className="text-base font-bold text-foreground">Chưa liên kết hồ sơ nhân viên</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Tài khoản này chưa được gắn với bảng staff của CLB. Chủ CLB hoặc thu ngân cần tạo hồ sơ và liên kết auth user.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-left text-[12px] text-muted-foreground">
        <div className="flex items-center gap-2 font-bold text-foreground mb-1">
          <Link2 className="w-3.5 h-3.5 text-primary" />
          MVP liên kết
        </div>
        Owner gán user có sẵn bằng RPC <span className="font-mono text-[11px]">staff_link_user</span>. Self-link bằng mã mời để sau.
      </div>
    </Card>
  );
}
