import { MOCK_FNB_NOT_WIRED } from "../mock/mockData";
import { NotWiredState } from "../shared/Notices";
import { TabShell } from "../shared/TabShell";

export function FnbFinanceTab({ data = MOCK_FNB_NOT_WIRED }: { data?: typeof MOCK_FNB_NOT_WIRED }) {
  return (
    <TabShell
      title="F&B Finance"
      question="Biên F&B (doanh thu − giá vốn) đã có trong sổ chưa?"
      doctrine={[
        "Số 0 do chưa nối dữ liệu ≠ số 0 thật (không có hoạt động) — hai thứ khác nhau.",
      ]}
    >
      <NotWiredState title={data.title} detail={data.detail} willShow={data.willShow} />
      <p className="text-[11px] leading-relaxed text-muted-foreground/80">
        Trước khi nối vào P&amp;L: kết quả với F&amp;B = 0 phải TRÙNG KHỚP từng byte với P&amp;L
        hiện tại (golden diff) — nối dữ liệu chỉ được THÊM dòng, không được làm đổi dòng cũ.
      </p>
    </TabShell>
  );
}
