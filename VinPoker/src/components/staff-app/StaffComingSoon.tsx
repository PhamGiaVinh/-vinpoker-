import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function StaffComingSoon() {
  const nav = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-background">
      <span className="grid place-items-center w-16 h-16 rounded-2xl bg-card border border-primary/30 text-primary">
        <Clock3 className="w-8 h-8" />
      </span>
      <h1 className="text-xl font-display font-bold text-foreground">Cổng nhân viên đang hoàn thiện</h1>
      <p className="text-sm text-muted-foreground max-w-xs">
        Cổng /staff chưa bật cho nhân viên. Chủ CLB sẽ thông báo khi có thể sử dụng.
      </p>
      <Button variant="outline" onClick={() => nav("/")}>
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        Về trang chủ
      </Button>
    </div>
  );
}

