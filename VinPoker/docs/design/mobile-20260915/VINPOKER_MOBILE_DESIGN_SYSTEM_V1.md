# VINPOKER_MOBILE_DESIGN_SYSTEM_V1

Status: READY FOR REVIEW — proposal, không phải CSS đã ship.

## Hướng thiết kế

Một công việc chính: nhìn đúng giải/bàn/người rồi thao tác chính xác. Giữ dark felt + emerald của VinPoker; không copy thương hiệu Apple/Google/kHold’em. Trạng thái bằng chữ + icon, không chỉ màu. Roster dạng hàng, không mỗi ghế một card.

| Quy tắc | Giá trị / reuse |
|---|---|
| Font | `operations-typography`: local Space Grotesk, Segoe UI/system fallback; chip dùng local JetBrains Mono/tabular digits. Không tải font. |
| Type scale đề xuất | Caption 12/16; metadata 14/20; body/input 16/24; section 18/26; title 22/28. Không dùng caption cho tên/lý do lỗi quan trọng. |
| Spacing | Tailwind scale 4,8,12,16,24,32 CSS px; phone gutter16, compact12; row min64 nhưng cho phép tăng theo text. |
| Surface | Reuse background/card/popover, foreground/muted-foreground/border. Không thêm token palette song song. |
| Color | primary/primary-foreground cho CTA; destructive cho hành động loại; warning cho cần xử lý; status luôn có label. Không ngụ ý chip hoặc contribution là tiền/lợi nhuận. |
| Radius | Existing `--radius=.875rem` cho sheet/panel, md cho controls; list hàng dùng separator, không nested card. |
| Elevation | Overlay mới có bóng; content không glow/shadow lặp. Một CTA filled mỗi tác vụ. |
| Touch | Product web target min48×48 CSS px, icon24; không coi CSS px là quy đổi tuyệt đối pt/dp. Gap8 giữa hành động nguy hiểm và thường. |
| Safe area | Edge-to-edge background, controls nằm trong top/bottom/left/right env insets. Insets do một container sở hữu để tránh padding hai lần. |
| Motion | Ngắn 120–200ms khi cần continuity; reduced-motion bỏ slide/scale; không animate chip tạo cảm giác đã ghi server. |

## Component contract

- **Header**: CLB/giải, bàn và Đóng; header ở safe area, không X overlay lên title. Tên dài tối đa hai dòng, mở chi tiết đọc được toàn bộ.
- **Navigation**: một navigation nghiệp vụ trong Floor, không player tab bar chồng. Giữ login hiện có. Đổi giải/CLB tường minh; đóng sheet giữ filter/scroll bàn.
- **Roster**: đủ chín ghế nếu contract 9-max; khác capacity phải có trạng thái rõ, không âm thầm bỏ ghế10. Tên, entry phân biệt trùng tên, stack và trạng thái; nhấn row mở action, không nested button.
- **Entry picker**: list hiện ngay; search không autofocus trên touch. Selected player/bàn/ghế luôn thấy trước xác nhận. Search không tạo entry. Restore là action riêng.
- **Forms**: label thật, input16px+, lỗi gắn field, không xóa search khi lỗi; submitting disable action, không optimistic mutation tiền/chip/seat.
- **Sheet**: viewport-height container, header/footer không bị keyboard che; body min-height0 + overflow-y auto. Reuse visual-viewport seam nếu đã có; chỉ bổ sung khi repro chứng minh cần. Không hard-code chiều cao keyboard hoặc pin.
- **Error**: server-safe reason + bước tiếp theo; unknown error không bị dịch thành thành công. Lỗi stale yêu cầu tải lại, không replay destructive intent tự động.
- **Empty/loading/offline**: phân biệt chưa có entry, không khớp search và không tải được. Last-known roster không actionable khi stale/authority không xác minh.

## Nguồn tham khảo và quyết định

1. [kHold’em Gallery](https://www.kholdem.net/en/kHoldem/Gallery): phân tách event/tables/players/levels và thao tác theo player. Áp dụng cách tổ chức, không bê free-seat hay quy tắc bust của họ vào VinPoker.
2. [Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout): controls phải tôn trọng safe areas. Áp dụng cho DOM/web, không chuyển SwiftUI.
3. [Android accessibility](https://developer.android.com/develop/ui/compose/accessibility/api-defaults): target48dp trên native; đề xuất web48CSSpx và đo trên thiết bị, không tuyên bố native compliance chỉ bằng viewport.

iOS: Safari + installed PWA, home indicator, keyboard/VoiceOver. Android: browser/system Back đóng lớp con, IME resize/TalkBack. Desktop: pointer/keyboard, list-detail; giữ cùng identity/server contract. Không UA sniff để đổi quyền hoặc dữ liệu.

## Accessibility / finish gates

Đo contrast4.5:1 text thường,3:1 large text/nontext; 200% text không mất action; focus-visible; modal focus trap/return đúng trigger; screen-reader label tiếng Việt; không color-only; Escape/back không submit. Anti-ui-slop: bỏ card trong card, mode panels thường trực và glow diện rộng; không thêm hero, fake metrics, glass dashboard.

Đây là specification, chưa đo contrast/runtime/keyboard trên bản implement. App Store là lộ trình riêng, không cam kết submission hoặc native readiness.
