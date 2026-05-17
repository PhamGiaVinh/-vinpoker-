# FOMO UI — Free Rake Promotion

## Mục tiêu

Hiển thị ưu đãi **"miễn phí dịch vụ CLB" (free_rake)** cho N suất đầu tiên trên tất cả các trang customer-facing có hiển thị giải đấu. Dùng giá gạch ngang (strikethrough) + badge đếm suất còn lại để tạo FOMO, thúc đẩy đăng ký sớm.

---

## Quy ước hiển thị

- App **KHÔNG hiển thị "₫" hay "VND"** — chỉ hiển thị số. Giữ nguyên `formatVND` / `formatBuyInShort` / `formatStack` hiện có tại từng file, **chỉ wrap thêm FomoPrice**.
- Dùng semantic tokens: `success` (giá giảm), `warning` (badge còn suất), `muted` (badge hết suất).
- Dark theme (#0A0A0A), Tailwind CSS.

### 3 trạng thái giá

| Trạng thái | Hiển thị |
|---|---|
| Có ưu đãi & còn suất | Giá gốc (gạch ngang, muted) → Giá ưu đãi (đậm, success) + Badge "🎉 Còn X suất miễn phí DV CLB" |
| Có ưu đãi & hết suất | Giá đầy đủ + Badge mờ "Suất miễn phí DV CLB đã hết" |
| Không bật ưu đãi | Giá đầy đủ, không badge |

---

## 1. File mới: `src/lib/tournament.ts`

Utility function `getTournamentPrice`:

```ts
export function getTournamentPrice(t: {
  buy_in: number;
  rake_amount?: number | null;
  free_rake_enabled?: boolean | null;
  free_rake_slots?: number | null;
  free_rake_used?: number | null;
}) {
  const rake = t.rake_amount ?? 0;
  const enabled = !!t.free_rake_enabled;
  const slots = t.free_rake_slots ?? 0;
  const used = t.free_rake_used ?? 0;
  const remaining = Math.max(0, slots - used);
  const hasDiscount = enabled && remaining > 0;
  const originalPrice = t.buy_in + rake;
  return {
    displayPrice: hasDiscount ? t.buy_in : originalPrice,
    originalPrice,
    hasDiscount,
    promotionEnabled: enabled,
    remainingSlots: remaining,
    savings: rake,
  };
}
```

---

## 2. File mới: `src/components/FomoPrice.tsx`

Component nhận `tournament` + optional `compact`/`formatter` props, render 3 trạng thái.

```tsx
import { Badge } from "@/components/ui/badge";
import { formatVND, formatBuyInShort } from "@/lib/format";
import { getTournamentPrice } from "@/lib/tournament";
import { cn } from "@/lib/utils";

interface FomoPriceProps {
  tournament: {
    buy_in: number;
    rake_amount?: number | null;
    free_rake_enabled?: boolean | null;
    free_rake_slots?: number | null;
    free_rake_used?: number | null;
  };
  compact?: boolean;
  formatter?: (n: number) => string;
}

export const FomoPrice = ({ tournament, compact, formatter }: FomoPriceProps) => {
  const p = getTournamentPrice(tournament);
  const fmt = formatter ?? (compact ? formatBuyInShort : formatVND);

  if (!p.promotionEnabled) {
    return <span>{fmt(p.displayPrice)}</span>;
  }

  if (p.hasDiscount) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="line-through text-muted-foreground/60 text-xs sm:text-sm">
          {fmt(p.originalPrice)}
        </span>
        <span className={cn("font-bold",
          compact ? "text-success text-xs sm:text-sm" : "text-success text-base sm:text-lg"
        )}>
          {fmt(p.displayPrice)}
        </span>
        <Badge className="bg-warning/10 text-warning border-warning/20 rounded-full text-[10px] font-semibold px-2 py-0">
          🎉 Còn {p.remainingSlots} suất miễn phí DV CLB
        </Badge>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{fmt(p.displayPrice)}</span>
      <Badge className="bg-muted/10 text-muted-foreground/60 border-muted/30 rounded-full text-[10px] font-semibold px-2 py-0">
        Suất miễn phí DV CLB đã hết
      </Badge>
    </span>
  );
};
```

---

## 3. Các file cần sửa (7 files + 2 mới)

### 3a. `src/pages/Tournaments.tsx`

**Import** — thêm `FomoPrice`:
```ts
import { FomoPrice } from "@/components/FomoPrice";
```

**Interface `Tournament`** (dòng 22–36) — thêm 4 field:
```ts
interface Tournament {
  id: string;
  name: string;
  start_time: string;
  buy_in: number;
  rake_amount?: number;
  free_rake_enabled?: boolean;
  free_rake_slots?: number;
  free_rake_used?: number;
  // ... existing fields
}
```

**Query** (dòng 85) — thêm 4 field vào `.select()`:
```ts
// CŨ:
.select("id,name,start_time,buy_in,starting_stack,...")

// MỚI:
.select("id,name,start_time,buy_in,rake_amount,free_rake_enabled,free_rake_slots,free_rake_used,starting_stack,...")
```

**Render buy-in cell** (dòng 567):
```tsx
// CŨ:
{formatBuyInShort(t.buy_in)}

// MỚI:
<FomoPrice tournament={t} compact formatter={formatBuyInShort} />
```

### 3b. `src/pages/TournamentDetail.tsx`

**Import** — thêm `FomoPrice`:
```ts
import { FomoPrice } from "@/components/FomoPrice";
```

**Info buy-in line** (dòng 93):
```tsx
// CŨ:
<Info icon={Coins} label={tr("tournamentDetail.buyIn")} value={formatVND(t.buy_in)} />

// MỚI:
<Info icon={Coins} label={tr("tournamentDetail.buyIn")} value={<FomoPrice tournament={t} />} />
```

**Info box sau card chính** — thêm khi `hasDiscount`:
```tsx
{getTournamentPrice(t).hasDiscount && (
  <Card className="p-4 border-success/30 bg-success/5">
    <p className="text-sm text-success font-semibold flex items-center gap-2">
      🎉 Giải này đang miễn phí DV CLB cho {getTournamentPrice(t).remainingSlots} suất đầu tiên. Đăng ký ngay để nhận ưu đãi!
    </p>
  </Card>
)}
```
- Đặt sau `<Card>` header (sau dòng 98 hoặc trước `LivestreamPlayer`).

### 3c. `src/pages/ClubDetail.tsx`

**Import** — thêm `FomoPrice`:
```ts
import { FomoPrice } from "@/components/FomoPrice";
```

**Buy-in display** (dòng 97):
```tsx
// CŨ:
<div className="text-gold font-semibold text-sm">{formatVND(t.buy_in)}</div>

// MỚI:
<FomoPrice tournament={t} />
```

**Query** (dòng 22) — đã dùng `select("*")`, tự động có đủ field. Không cần sửa.

### 3d. `src/pages/ClubAdmin.tsx`

**Import** — thêm `FomoPrice`:
```ts
import { FomoPrice } from "@/components/FomoPrice";
```

**Buy-in display trong list giải sắp diễn ra** (dòng 215):
```tsx
// CŨ:
<div className="text-xs text-muted-foreground">{formatDateTime(t2.start_time)} · {formatVND(t2.buy_in)}</div>

// MỚI:
<div className="text-xs text-muted-foreground">{formatDateTime(t2.start_time)}</div>
<div className="mt-0.5"><FomoPrice tournament={t2} /></div>
```

**Query** (dòng 47) — đã dùng `select("*")`, không cần sửa.

### 3e. `src/pages/SuperAdmin.tsx`

**Import** — thêm `FomoPrice`:
```ts
import { FomoPrice } from "@/components/FomoPrice";
```

**Buy-in display** (dòng 146):
```tsx
// CŨ:
<div className="text-xs text-neon mt-0.5">Buy-in: {formatVND(t.buy_in)} · Stack: {t.starting_stack.toLocaleString()}</div>

// MỚI:
<div className="text-xs text-neon mt-0.5"><FomoPrice tournament={t} /> · Stack: {t.starting_stack.toLocaleString()}</div>
```

**Query** (dòng 46) — đã dùng `select("*, club:clubs(name)")`, không cần sửa.

### 3f. `src/pages/StakingNew.tsx`

**Import** — thêm `FomoPrice` + `getTournamentPrice`:
```ts
import { FomoPrice } from "@/components/FomoPrice";
import { getTournamentPrice } from "@/lib/tournament";
```

**Interface `TournamentOpt`** (dòng 21–29) — thêm 4 field:
```ts
interface TournamentOpt {
  id: string;
  name: string;
  start_time: string;
  buy_in: number;
  rake_amount?: number;
  free_rake_enabled?: boolean;
  free_rake_slots?: number;
  free_rake_used?: number;
  club_id: string | null;
  minutes_per_level: number | null;
  late_reg_close_level: number | null;
}
```

**Query** (dòng 108–109) — thêm 4 field vào `.select()`:
```ts
// CŨ:
.select("id, name, start_time, buy_in, club_id, minutes_per_level, late_reg_close_level")

// MỚI:
.select("id, name, start_time, buy_in, rake_amount, free_rake_enabled, free_rake_slots, free_rake_used, club_id, minutes_per_level, late_reg_close_level")
```

**Selector item** (dòng 322) — thay `formatVND(tt.buy_in)` bằng `FomoPrice`:
```tsx
// CŨ:
{tt.name} · {formatVND(tt.buy_in)}

// MỚI:
{tt.name} · <FomoPrice tournament={tt} compact />
```

**Preview row "Lệ phí tập huấn"** (dòng 510) — thêm info box khi `selectedTournament` có ưu đãi. `SimulationPreview` component cần nhận thêm prop `selectedTournament`:
```tsx
// Props của SimulationPreview:
const SimulationPreview = ({
  buyIn, percentage, markup, askingPrice, selectedTournament,
}: {
  buyIn: number; percentage: number; markup: number; askingPrice: number;
  selectedTournament?: TournamentOpt | null;
}) => {
  const p = selectedTournament ? getTournamentPrice(selectedTournament) : null;
  // ...
}
```

Thêm info box trong preview (sau dòng 509 hoặc trước dòng 520):
```tsx
{p?.hasDiscount && (
  <div className="rounded-lg border border-success/30 bg-success/5 p-2.5 text-xs text-success font-semibold">
    🎉 Giải này đang có ưu đãi miễn phí DV CLB cho {p.remainingSlots} suất đầu tiên. Còn {p.remainingSlots} suất.
  </div>
)}
```

Tại chỗ gọi `SimulationPreview` (dòng 491–496), thêm prop `selectedTournament`:
```tsx
// CŨ:
<SimulationPreview
  buyIn={buyIn} percentage={percentage} markup={markup} askingPrice={askingPrice}
/>

// MỚI:
<SimulationPreview
  buyIn={buyIn} percentage={percentage} markup={markup} askingPrice={askingPrice}
  selectedTournament={selectedTournament}
/>
```

### 3g. `src/pages/Marketplace.tsx`

**Import** — thêm `FomoPrice`:
```ts
import { FomoPrice } from "@/components/FomoPrice";
```

**Interface `DealRow.tournament`** (dòng 42) — thêm field:
```ts
tournament?: {
  name: string;
  start_time: string;
  club_id: string;
  buy_in: number;
  rake_amount?: number;
  free_rake_enabled?: boolean;
  free_rake_slots?: number;
  free_rake_used?: number;
} | null;
```

**Query tournament data** (dòng 118–119) — thêm field:
```ts
// CŨ:
supabase.from("tournaments").select("id, name, start_time, club_id").in("id", tournamentIds)

// MỚI:
supabase.from("tournaments").select("id, name, start_time, club_id, buy_in, rake_amount, free_rake_enabled, free_rake_slots, free_rake_used").in("id", tournamentIds)
```

**Buy-in row trong DealDetailDialog** (dòng 639) — nếu có tournament, dùng FomoPrice:
```tsx
// CŨ:
<Row k={t("marketplace.buyIn")} v={formatVND(deal.buy_in_amount_vnd)} />

// MỚI:
{deal.tournament && 'buy_in' in deal.tournament && deal.tournament.buy_in != null ? (
  <div className="flex items-center justify-between">
    <span className="text-muted-foreground">{t("marketplace.buyIn")}</span>
    <FomoPrice tournament={deal.tournament as any} compact />
  </div>
) : (
  <Row k={t("marketplace.buyIn")} v={formatVND(deal.buy_in_amount_vnd)} />
)}
```

### 3h. `src/components/TournamentRegisterModal.tsx`

**Import** — thêm getTournamentPrice:
```ts
import { getTournamentPrice } from "@/lib/tournament";
```

**Sau khi register thành công** — trong `useEffect` gọi `supabase.functions.invoke("tournament-register")` (sau dòng 74), kiểm tra response có `free_rake_applied`:
```ts
const r = data as RegInfo & { free_rake_applied?: boolean; savings?: number };
setInfo(r);
if (r.free_rake_applied && r.savings) {
  toast.success(`✅ Bạn đã nhận miễn phí dịch vụ CLB (tiết kiệm ${formatStack(r.savings)}). Vui lòng thanh toán trong 5 phút để giữ ưu đãi.`);
}
```

Cần cập nhật `RegInfo` interface thêm 2 field optional:
```ts
interface RegInfo {
  registration_id: string;
  reference_code: string;
  total_pay: number;
  breakdown: { buy_in: number; platform_fee: number };
  // ... existing fields
  free_rake_applied?: boolean;
  savings?: number;
}
```

---

## 4. Các file KHÔNG sửa (admin/history/form input)

- `PlayerProfile.tsx` — past results
- `Account.tsx` — export
- `CashierDashboard.tsx` — admin (đã có plan riêng)
- `AdminStaking.tsx` — admin
- `ResultsManager.tsx` — past results
- `PlayerHistoryDialog.tsx` — history
- `CashierCounter.tsx` — admin
- `TournamentRegistrationsTab.tsx` — admin
- `FeeRevenueDashboard.tsx` — admin report
- `UnifiedLookupTab.tsx` — admin lookup
- `UpcomingEventsManager.tsx` — admin component
- `BulkCreateTournaments.tsx` — form input
- `StakingMyDeals.tsx` — deal detail
- `StakingPortfolio.tsx` — portfolio
- `InternationalEvents.tsx` — bảng `international_events` riêng (USD), không liên quan tournament

---

## 5. Tổng kết thay đổi

| File | Action | Nội dung |
|---|---|---|
| `src/lib/tournament.ts` | **MỚI** | `getTournamentPrice()` utility |
| `src/components/FomoPrice.tsx` | **MỚI** | Reusable price + badge component |
| `src/pages/Tournaments.tsx` | Sửa | Thêm 4 field query + interface + FomoPrice cell |
| `src/pages/TournamentDetail.tsx` | Sửa | FomoPrice + info box khi có discount |
| `src/pages/ClubDetail.tsx` | Sửa | FomoPrice thay formatVND |
| `src/pages/ClubAdmin.tsx` | Sửa | FomoPrice trong list giải |
| `src/pages/SuperAdmin.tsx` | Sửa | FomoPrice trong list giải |
| `src/pages/StakingNew.tsx` | Sửa | Thêm 4 field query + interface + FomoPrice selector/preview |
| `src/pages/Marketplace.tsx` | Sửa | Thêm 5 field query + interface + FomoPrice trong deal dialog |
| `src/components/TournamentRegisterModal.tsx` | Sửa | Toast free_rake_applied + savings |

---

## 6. Verification

1. `npm run build` — type-check tự động qua build
2. Mở `/tournaments` — kiểm tra giải có `free_rake_enabled=true` hiển thị giá gạch ngang + badge "Còn X suất"
3. Mở `/staking/new` — chọn giải có free_rake, preview có info box
4. Mở `/tournament/:id` — header card có FomoPrice, info box "🎉 Đang miễn phí DV CLB"
5. Register giải free_rake → toast tiết kiệm

---

## 7. Lưu ý

- Edge Function `tournament-register` cần trả về `free_rake_applied: boolean` + `savings: number` trong response JSON.
- Các field mới (`rake_amount`, `free_rake_enabled`, `free_rake_slots`, `free_rake_used`) đã có trong DB migration `20260518000000_refund_and_free_rake.sql`.
- Giữ nguyên formatter hiện tại tại mỗi file (chỉ wrap FomoPrice, không đổi formatVND ↔ formatBuyInShort).
