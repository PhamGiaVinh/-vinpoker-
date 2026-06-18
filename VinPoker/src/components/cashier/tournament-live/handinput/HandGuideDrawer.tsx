// "? Hướng dẫn nhập hand" — a self-contained help drawer for non-developer floor
// operators. Static 7-step guide for engine-mode Hand Input. Owns its own open
// state + trigger button so the parent only has to drop it in.

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerTrigger,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

const STEPS: { title: string; body: string }[] = [
  { title: "1 · Chọn nút chia bài", body: "Chạm vào ghế giữ nút (BTN) rồi nhập số ván và bấm “Bắt đầu Hand”. Phải xác nhận nút trước khi bắt đầu." },
  { title: "2 · Đặt cược mù (Blinds)", body: "Hệ thống hiển thị SB/BB theo level hiện tại. Bấm Post SB, Post BB rồi “Xác nhận” để vào vòng Preflop." },
  { title: "3 · Nhập hành động", body: "Mỗi lượt chỉ có một người hành động (được tô sáng). Chỉ những nút hợp lệ mới bật. Số tiền cược nhập theo “Bet to” (tổng mức của vòng)." },
  { title: "4 · Nhập lá bài chung", body: "Khi hết vòng cược, hệ thống yêu cầu nhập Flop (3 lá) / Turn (1 lá) / River (1 lá). Bấm “Gửi …” để đẩy lên viewer trước khi nhập hành động tiếp theo." },
  { title: "5 · Theo dõi đồng bộ viewer", body: "Dòng trạng thái cho biết “Đang gửi…”, “Đã gửi lên viewer” hay “Lỗi gửi”. Nếu báo lỗi, thử lại thao tác vừa rồi." },
  { title: "6 · Showdown", body: "Khi tới Showdown, lật bài người còn lại rồi tự chọn người thắng (bản này chưa tự đánh giá bài). Xác nhận kết quả." },
  { title: "7 · Kiểm tra & Gửi", body: "Màn Review kiểm tra bảo toàn chip. Chỉ khi chip khớp và đã có người thắng, nút “Gửi Hand” mới bật. Bấm để lưu ván." },
];

export function HandGuideDrawer() {
  const [open, setOpen] = useState(false);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground border border-border/40 rounded-lg px-2.5 py-1.5 hover:text-foreground hover:border-amber-400/50 transition"
        >
          <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" /> Hướng dẫn nhập hand
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Hướng dẫn nhập hand (chế độ engine)</DrawerTitle>
          <DrawerDescription>7 bước cơ bản để ghi một ván bài đúng trình tự.</DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-2 space-y-3 overflow-y-auto max-h-[55vh]">
          {STEPS.map((s) => (
            <div key={s.title} className="rounded-lg border border-border/30 bg-card p-3">
              <div className="text-sm font-semibold text-amber-300">{s.title}</div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.body}</div>
            </div>
          ))}
        </div>
        <div className="p-4 pt-2">
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">Đã hiểu</Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
