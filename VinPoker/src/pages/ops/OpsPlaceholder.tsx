import { Hammer } from "lucide-react";

/**
 * Placeholder cho các tab mobileOpsV2 chưa dựng trong prototype (Giải đấu/Bàn/Cảnh báo/Thêm).
 * Chỉ để bottom nav điều hướng được; nội dung thật theo docs/design/ios-floor-ux-spec.md.
 */
export default function OpsPlaceholder({ title }: { title: string }) {
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div className="max-w-xs">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-card border border-border text-muted-foreground">
          <Hammer className="h-6 w-6" />
        </div>
        <div className="text-base font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Màn này theo thiết kế trong PR-IOS0. Prototype hiện dựng màn “Floor hôm nay”.
        </p>
      </div>
    </div>
  );
}
