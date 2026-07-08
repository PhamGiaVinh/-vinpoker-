import { Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";

export function StaffSalaryScreen() {
  return (
    <Card className="p-5 border-border text-center space-y-2">
      <span className="mx-auto grid place-items-center w-12 h-12 rounded-xl bg-muted text-muted-foreground">
        <Wallet className="w-6 h-6" />
      </span>
      <h1 className="text-base font-bold text-foreground">Lương nhân viên</h1>
      <p className="text-[13px] text-muted-foreground">
        Màn này sẽ bật sau increment payroll staff riêng. Không đọc dealer payroll và không tính lại lương đã lưu.
      </p>
    </Card>
  );
}

