import { Receipt, ArrowRight } from "lucide-react";

/**
 * PlayerLookupCard — kết quả tra cứu 1 người chơi (material iOS). SĐT masked; full money history chỉ
 * owner/admin/self. docs/design/ios-operations-components.md §7. Read-only mock.
 */
export function PlayerLookupCard({
  name,
  phone,
  status,
  place,
  entry,
}: {
  name: string;
  phone: string;
  status: string;
  place: string;
  entry: string;
}) {
  const busted = status === "Đã loại";
  return (
    <div className="ios-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[16px] font-semibold text-[#f2ece6]">{name}</span>
        <span className="font-mono text-[12px] text-[#9b8e97]">{phone}</span>
      </div>
      <div className="mt-0.5 text-[13px]">
        <span className={busted ? "text-[#9b8e97]" : "text-emerald-300"}>{status}</span>
        <span className="text-[#9b8e97]"> · {place}</span>
      </div>
      <div className="text-[12px] text-[#7c7079]">Lượt vào {entry}</div>
      <div className="mt-2.5 flex items-center gap-2">
        <button className="ios-press ios-tinted flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[13px] font-medium">
          <ArrowRight className="h-3.5 w-3.5" /> Tới bàn
        </button>
        <button className="ios-press ios-fill flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[13px] text-[#f2ece6]">
          <Receipt className="h-3.5 w-3.5 text-sky-300" /> Phiếu
        </button>
      </div>
    </div>
  );
}
