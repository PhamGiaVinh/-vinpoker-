# Early Bird Tournament Packages — Implementation Plan

## Overview

Add a full "Tournament Packages (Early Bird)" feature to VBacker: package listing page, package detail page, database tables, custom hooks, and reusable components — per the provided Stitch AI designs with global corrections applied.

---

## 1. Database Migration

**File:** `supabase/migrations/20260520000001_tournament_packages.sql`

```sql
-- 1. Package status enum
DO $$ BEGIN
  CREATE TYPE public.package_status AS ENUM ('active', 'sold_out', 'expired', 'draft');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Tournament packages table
CREATE TABLE IF NOT EXISTS public.tournament_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT NOT NULL,
  hero_image_url TEXT,
  original_price NUMERIC(12,0) NOT NULL,
  package_price NUMERIC(12,0) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'VND',
  max_slots INTEGER NOT NULL DEFAULT 10,
  slots_remaining INTEGER NOT NULL DEFAULT 10,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  location TEXT,
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
  status public.package_status NOT NULL DEFAULT 'active',
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT positive_price CHECK (package_price > 0),
  CONSTRAINT savings_check CHECK (original_price >= package_price),
  CONSTRAINT slots_check CHECK (slots_remaining >= 0 AND slots_remaining <= max_slots)
);

-- 3. Package-tournament junction table
CREATE TABLE IF NOT EXISTS public.package_tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.tournament_packages(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(package_id, tournament_id)
);

-- 4. RLS: public read, admin-only write
ALTER TABLE public.tournament_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "packages_read_all" ON public.tournament_packages
  FOR SELECT USING (status IN ('active', 'sold_out'));
CREATE POLICY "packages_write_admin" ON public.tournament_packages
  FOR ALL USING (auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin'));

CREATE POLICY "pt_read_all" ON public.package_tournaments
  FOR SELECT USING (true);
CREATE POLICY "pt_write_admin" ON public.package_tournaments
  FOR ALL USING (auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin'));

-- 5. Seed sample data
INSERT INTO public.tournament_packages (name, slug, description, hero_image_url, original_price, package_price, max_slots, slots_remaining, start_date, end_date, location, benefits, status, sort_order)
VALUES
  (
    'SUMMER PACKAGE 2026',
    'summer-package-2026',
    'Trọn gói 3 giải đấu hấp dẫn nhất mùa hè với mức giá ưu đãi đặc biệt. Cơ hội tranh tài tại các sự kiện poker lớn nhất Việt Nam.',
    'https://images.unsplash.com/photo-1528323273322-d81442ced56c?w=1200',
    15000000, 9900000, 20, 14,
    NOW() + INTERVAL '7 days', NOW() + INTERVAL '30 days',
    'Hồ Chí Minh, Việt Nam',
    '[{"icon": "hotel", "title": "Khách sạn 3 sao", "desc": "2 đêm nghỉ dưỡng tại khách sạn đạt chuẩn"}, {"icon": "flight", "title": "Vé máy bay", "desc": "Khứ hồi nội địa cho người chơi"}, {"icon": "restaurant", "title": "Ăn uống", "desc": "Buffet tối khai mạc + tiệc trao giải"}, {"icon": "spa", "title": "Spa & Wellness", "desc": "Phiếu massage thư giãn trị giá 500K"}]',
    'active', 1
  ),
  (
    'MAIN EVENT PACKAGE',
    'main-event-package',
    'Gói đặc quyền dành cho Main Event với các quyền lợi VIP. Tham gia giải đấu chính và tận hưởng trải nghiệm đẳng cấp.',
    'https://images.unsplash.com/photo-1607453998774-d533f65dac99?w=1200',
    20000000, 14900000, 10, 3,
    NOW() + INTERVAL '14 days', NOW() + INTERVAL '45 days',
    'Đà Nẵng, Việt Nam',
    '[{"icon": "hotel", "title": "Khách sạn 5 sao", "desc": "3 đêm nghỉ tại resort cao cấp"}, {"icon": "airport_shuttle", "title": "Đưa đón sân bay", "desc": "Xe đưa đón riêng từ sân bay"}, {"icon": "restaurant", "title": "Full-board", "desc": "Ăn sáng, trưa, tối trong suốt giải"}, {"icon": "card_membership", "title": "VIP Lounge", "desc": "Tiếp cận phòng chờ VIP riêng"}]',
    'active', 2
  ),
  (
    'SATELLITE PACKAGE 2026',
    'satellite-package-2026',
    'Gói vệ tinh dành cho người chơi muốn tham gia các giải đấu vòng loại',
    'https://images.unsplash.com/photo-1528323273322-d81442ced56c?w=1200',
    5000000, 3500000, 30, 0,
    NOW() + INTERVAL '2 days', NOW() + INTERVAL '10 days',
    'Hà Nội, Việt Nam',
    '[{"icon": "card_giftcard", "title": "Entry Fee", "desc": "Phí tham gia 3 giải vệ tinh"}, {"icon": "school", "title": "Workshop", "desc": "1 buổi training với pro player"}]',
    'sold_out', 3
  );
```

---

## 2. Tailwind Config Updates

**File:** `src/index.css` — Add these imports + utilities:

### 2a. Google Fonts import (add to index.html `<head>`)
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

### 2b. Tailwind config additions (`tailwind.config.ts`)
```typescript
// In the extend section, ADD:
fontFamily: {
  display: ['Bebas Neue', ...existing],
  sans: ['Inter', ...existing],
  // Keep existing AppDigits for numbers
},
keyframes: {
  // Keep existing + ADD:
  'shimmer': {
    '0%': { backgroundPosition: '-200% 0' },
    '100%': { backgroundPosition: '200% 0' },
  },
  'pulse-dot': {
    '0%, 100%': { opacity: '1' },
    '50%': { opacity: '0.4' },
  },
  'fade-in-up': {
    '0%': { opacity: '0', transform: 'translateY(16px)' },
    '100%': { opacity: '1', transform: 'translateY(0)' },
  },
},
animation: {
  // Keep existing + ADD:
  'shimmer': 'shimmer 1.5s ease-in-out infinite',
  'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
  'fade-in-up': 'fade-in-up 0.5s ease-out forwards',
},
```

### 2c. CSS utility classes (add to `src/index.css` `@layer utilities`)
```css
/* Early Bird specific utilities */
.btn-primary {
  @apply bg-emerald-500 text-white font-bold tracking-wider
         shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]
         hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.5)]
         active:scale-[0.98] transition-all duration-200;
}
.card-premium {
  @apply bg-[#121212] border border-[#2A2A2A] rounded-none;
}
.badge-early-bird {
  @apply bg-emerald-500/15 border border-emerald-500/30 text-emerald-400;
}
```

### 2d. Background color update (from #111417 to #0A0A0A)
```css
/* In :root, change: */
--background: 0 0% 4%;     /* #0A0A0A */
```

---

## 3. i18n Translations

**File:** `src/i18n/locales/vi.json` — Add:
```json
"packages": {
  "title": "GÓI ƯU ĐÃI",
  "subtitle": "Combo giải đấu giá ưu đãi — số lượng có hạn",
  "registerNow": "ĐĂNG KÝ NGAY",
  "soldOut": "HẾT CHỖ",
  "spotsRemaining": "Còn {{count}}/{{total}} suất",
  "endsIn": "Kết thúc trong {{days}} ngày {{time}}",
  "savings": "TIẾT KIỆM: {{amount}}",
  "empty": "Hiện chưa có gói ưu đãi nào. Quay lại sau!",
  "includes": "GIẢI ĐẤU BAO GỒM",
  "benefits": "QUYỀN LỢI ĐI KÈM",
  "originalValue": "Tổng giá trị gốc",
  "finalPrice": "Giá gói",
  "trustNote": "Giao dịch được bảo mật bởi VBacker.",
  "backToPackages": "Quay lại danh sách gói"
}
```

Add to `en.json`:
```json
"packages": {
  "title": "EARLY BIRD PACKAGES",
  "subtitle": "Tournament combos at discounted prices — limited slots",
  "registerNow": "REGISTER NOW",
  "soldOut": "SOLD OUT",
  "spotsRemaining": "{{count}}/{{total}} spots left",
  "endsIn": "Ends in {{days}}d {{time}}",
  "savings": "SAVE: {{amount}}",
  "empty": "No packages available yet. Check back later!",
  "includes": "TOURNAMENTS INCLUDED",
  "benefits": "BENEFITS",
  "originalValue": "Original total value",
  "finalPrice": "Package price",
  "trustNote": "Transaction secured by VBacker.",
  "backToPackages": "Back to packages"
}
```

---

## 4. Multi-Currency System

All prices are stored in VND. The app displays equivalent values in CNY, USD, KRW using exchange rates configurable by super admin.

### 4a. Seed exchange rates (in the migration file, after tables)

Add this to the migration SQL:
```sql
-- Seed default exchange rates (approx, admin can adjust)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'currency_rates',
  '{
    "base_currency": "VND",
    "rates": {
      "VND": 1,
      "CNY": 3420,
      "USD": 25480,
      "KRW": 18.5
    },
    "symbols": {
      "VND": "₫",
      "CNY": "¥",
      "USD": "$",
      "KRW": "₩"
    }
  }'::jsonb,
  NOW()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
```

### 4b. Hook: `src/hooks/useCurrencyRates.ts`

```typescript
// Uses React Query to fetch exchange rates from app_settings
// Cache key: ["currency-rates"]
// Fetches: supabase.from("app_settings").select("value").eq("key", "currency_rates").maybeSingle()
// Returns: { rates, symbols, isLoading, error }
// rates: Record<string, number> — e.g., { VND: 1, CNY: 3420, USD: 25480, KRW: 18.5 }
// symbols: Record<string, string> — e.g., { VND: "₫", CNY: "¥", USD: "$", KRW: "₩" }
// staleTime: 5 * 60 * 1000 (5 min) — same as project default

export interface CurrencyRates {
  base_currency: string;
  rates: Record<string, number>;
  symbols: Record<string, string>;
}

export function useCurrencyRates() {
  return useQuery({
    queryKey: ["currency-rates"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "currency_rates")
        .maybeSingle();
      return (data?.value as CurrencyRates) ?? defaultRates;
    },
    staleTime: 5 * 60 * 1000,
  });
```

Utility export:
```typescript
export function convertPrice(amountVND: number, targetCurrency: string, rates: CurrencyRates): number {
  const rate = rates.rates[targetCurrency];
  if (!rate || rate === 0) return 0;
  return Math.round(amountVND / rate);
}
```

### 4c. Component: `src/components/packages/CurrencyDisplay.tsx`

```typescript
// Props: amountVND: number, showCompact?: boolean
// Uses: useCurrencyRates() hook
// Full display:
//   Primary: "10.000.000 ₫" (large, white)
//   Secondary row: "≈ $392 USD | ¥2.924 RMB | ₩540.540 KRW" (small, muted-foreground)
// Compact display (for cards):
//   Same format but smaller text
// Loading: show only VND if rates not yet loaded
```

### 4d. Admin UI: SuperAdmin Exchange Rates Tab

Add to `src/pages/SuperAdmin.tsx`:
- New tab: "Tỷ giá" (Exchange Rates) between "Livestream" and "Hỗ trợ"
- Reads `app_settings` key `currency_rates`
- Shows 4 input fields for VND (disabled), CNY, USD, KRW
- Save button: upserts to `app_settings`
- Validation: rates must be positive numbers
- Pattern matches existing VipBannerEditor / BannersEditor exactly

### 4e. Integration into Package components

- `PackageCard.tsx`: Replace `{Number(pkg.package_price).toLocaleString()} VND` with `<CurrencyDisplay amountVND={pkg.package_price} compact />`
- `PackageDetail.tsx`: Replace price display with `<CurrencyDisplay amountVND={pkg.package_price} />` in both the hero section and the sticky sidebar
- `StickyBottomBar.tsx`: Replace hardcoded VND with `<CurrencyDisplay amountVND={packagePrice} compact />`

---

## 5. Components to Create (7 files)

### 4a. `src/components/packages/CountdownTimer.tsx`
```typescript
// Live countdown hook + display
// Props: targetDate: string (ISO), onExpire?: () => void
// Shows: "Còn X ngày HH:MM:SS"
// Updates every 1 second via setInterval
// Uses useMemo to compute days/hours/minutes/seconds
// When expired, shows "Đã kết thúc" / "Expired"
// Surface: bg-black/30 backdrop-blur px-3 py-1 rounded text-emerald-400 text-sm font-mono
```

### 4b. `src/components/packages/PackageCard.tsx`
```typescript
// Props: package: PackageWithDetails, index: number (for stagger)
// Displays:
// - Hero image with gradient overlay (bg-gradient-to-t from-black/80 via-black/40 to-transparent)
// - "EARLY BIRD" badge (top-left, .badge-early-bird class)
// - LIVE indicator (top-right, green pulsing dot: w-2 h-2 rounded-full bg-emerald-500 animate-pulse-dot)
// - Package name (Bebas Neue, text-2xl tracking-wider)
// - Short description (Inter, text-sm text-muted-foreground, 2-line clamp)
// - Original price strikethrough (line-through text-[#555]) + discounted price (text-emerald-400 text-xl font-bold)
// - <CountdownTimer /> component
// - Spots remaining: "Còn X/Y suất" (text-sm text-muted-foreground)
// - CTA: "ĐĂNG KÝ NGAY" (.btn-primary) if slots > 0, "HẾT CHỖ" (disabled gray) if slots = 0
// Hover: group:hover translate-y-[-4px] transition-all duration-200
//        group:hover shadow-[0_0_24px_rgba(16,185,129,0.2)]
//        group:hover border-emerald-500/40
// Stagger: animate-fade-in-up with style={{ animationDelay: `${index * 150}ms` }}
// CTA button: use Button component from shadcn with active:scale-[0.98]
```

### 4c. `src/components/packages/BenefitGrid.tsx`
```typescript
// Props: benefits: Array<{ icon: string, title: string, desc: string }>
// Display: 2x2 grid (grid grid-cols-2 gap-4)
// Each cell:
//   - Material Symbols icon (using <span class="material-symbols-outlined text-emerald-400 text-2xl">)
//   - Title (font-semibold text-sm)
//   - Description (text-xs text-muted-foreground)
// Background: bg-[#121212] border border-[#2A2A2A] p-4 rounded-lg
//
// NOTE: Material Symbols require adding to index.html:
// <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined">
```

### 4d. `src/components/packages/TournamentListItem.tsx`
```typescript
// Props: tournament: { event_number, name, starting_stack, buy_in, start_time }
// Display: compact row with:
//   - Event number badge (e.g., "#1" — bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-xs font-bold)
//   - Tournament name (text-sm font-medium)
//   - Starting stack (text-xs text-muted-foreground)
//   - Buy-in amount (text-xs text-muted-foreground)
// Background: bg-[#121212] border border-[#2A2A2A] p-3 rounded-lg
```

### 4e. `src/components/packages/StickyBottomBar.tsx`
```typescript
// Props: originalPrice: number, packagePrice: number, onRegister: () => void, disabled: boolean
// Display: fixed bottom-0 inset-x-0 z-50 
//         bg-[#121212] border-t border-[#2A2A2A]
//         pb-[env(safe-area-inset-bottom)] (iOS safe area)
//         md:hidden (mobile only)
// Content: flex row:
//   - LEFT: "Giá gói" label + large emerald price (text-emerald-400 text-xl font-bold)
//   - RIGHT: Full-width CTA button (.btn-primary, h-[44px] px-6 rounded-lg)
// Original price strikethrough shown above package price
```

### 4f. `src/components/packages/PackageCardSkeleton.tsx`
```typescript
// Shimmer/skeleton version of PackageCard for loading state
// Uses existing Skeleton component from src/components/ui/skeleton.tsx
// Layout:
//   - Skeleton for hero image (h-48 w-full rounded-lg)
//   - Skeleton for title + description (3 skeleton lines)
//   - Skeleton for price + timer (2 skeleton lines)
//   - Skeleton for CTA button (h-10 w-full)
// Background: bg-[#121212] border border-[#2A2A2A] p-0 overflow-hidden rounded-lg
```

---

## 6. Custom Hooks (2 files)

### 5a. `src/hooks/useCountdown.ts`
```typescript
// Input: targetDate: string | Date | null
// Output: { days: number, hours: number, minutes: number, seconds: number, isExpired: boolean }
// Uses useState + useEffect with setInterval(1000)
// Cleans up interval on unmount or when targetDate changes
// Computes time remaining from Date.now()
// When remaining <= 0, sets isExpired = true and all values to 0
```

### 5b. `src/hooks/useTournamentPackages.ts`
```typescript
// Uses @tanstack/react-query useQuery
// Fetches from Supabase:
//   supabase.from("tournament_packages")
//     .select("*, package_tournaments(*, tournament:tournaments(*))")
//     .in("status", ["active", "sold_out"])
//     .order("sort_order", { ascending: true })
// Query key: ["tournament-packages"]
// staleTime: 5 * 60 * 1000 (5 min)
// Returns: { packages, isLoading, error }

// For single package:
//   useQuery({
//     queryKey: ["tournament-package", packageId],
//     queryFn: () => supabase.from("tournament_packages")
//       .select("*, package_tournaments(*, tournament:tournaments(*))")
//       .eq("id", packageId)
//       .single()
//       .then(r => r.data),
//     enabled: !!packageId,
//   })
// Returns: { package, isLoading, error }
```

---

## 7. Pages (2 files)

### 6a. `src/pages/PackageListing.tsx`
```typescript
// Route: /packages (or /early-birds)
// Layout wrapped (inside <Route element={<Layout />}>)
// State: { loading, packages }
// Uses: useTournamentPackages() hook

// HEADER SECTION:
//   <div class="mb-8">
//     <h1 class="font-display text-4xl tracking-wider text-white">
//       {t("packages.title")}
//     </h1>
//     <div class="w-24 h-0.5 bg-emerald-500/50 mt-3"></div>  // chronograph divider
//     <p class="text-muted-foreground mt-2">{t("packages.subtitle")}</p>
//   </div>

// DESKTOP: horizontal scroll row
//   <div class="hidden md:flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory">
//     {packages.map((pkg, i) => (
//       <div class="min-w-[380px] max-w-[420px] snap-start">
//         <PackageCard pkg={pkg} index={i} />
//       </div>
//     ))}
//   </div>

// MOBILE: vertical stack
//   <div class="md:hidden space-y-4">
//     {packages.map((pkg, i) => (
//       <PackageCard pkg={pkg} index={i} />
//     ))}
//   </div>

// EMPTY STATE:
//   <div class="text-center py-20 text-muted-foreground">
//     {t("packages.empty")}
//   </div>

// LOADING STATE:
//   <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//     {[1,2,3].map(i => <PackageCardSkeleton key={i} />)}
//   </div>

// NAVIGATION: clicking CTA → navigate to /packages/${pkg.id}
```

### 6b. `src/pages/PackageDetail.tsx`
```typescript
// Route: /packages/:packageId
// Uses: useQuery for single package (from useTournamentPackages hook)
// Uses: useParams() from react-router-dom

// LAYOUT:
// Back button: <button onClick={() => nav(-1)}>
//   <ArrowLeft /> {t("packages.backToPackages")}

// HERO SECTION:
//   Full-width image with gradient overlay
//   Package name in Bebas Neue (text-4xl md:text-6xl)
//   "EARLY BIRD" badge (top-left, .badge-early-bird)
//   Location icon + text
//   CountdownTimer

// TWO-COLUMN (desktop: md:grid md:grid-cols-12 gap-8):
//   LEFT COLUMN (col-span-8):
//     "GIẢI ĐẤU BAO GỒM" section:
//       {package.package_tournaments.map(t => <TournamentListItem />)}
//
//     "QUYỀN LỢI ĐI KÈM" section:
//       <BenefitGrid benefits={package.benefits} />

//   RIGHT COLUMN (col-span-4, sticky top-24):
//     "Tổng giá trị gốc": original_price (strikethrough, text-[#555])
//     "Giá gói": package_price (text-4xl font-bold text-emerald-400)
//     Savings badge: "TIẾT KIỆM: X,XXX" (bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full text-sm font-bold)
//     CTA: .btn-primary w-full py-3 rounded-lg
//     Trust note: "Giao dịch được bảo mật bởi VBacker." (text-xs text-center)

// MOBILE:
//   Single column, no right sidebar
//   <StickyBottomBar /> at bottom (hidden md:block)
//   Back button at top

// LOADING: centered Loader2 spinner (matches project pattern)
// ERROR/404: "Package not found" with back button
```

---

## 8. Route Update

**File:** `src/App.tsx`

Add imports (within the existing lazy import pattern):
```typescript
const PackageListing = lazy(() => import("@/pages/PackageListing"));
const PackageDetail = lazy(() => import("@/pages/PackageDetail"));
```

Add routes inside `<Route element={<Layout />}>`:
```tsx
<Route path="/packages" element={<PackageListing />} />
<Route path="/packages/:packageId" element={<PackageDetail />} />
```

---

## 9. TypeScript Types Regeneration

After migration runs on Supabase, regenerate types:
```bash
supabase gen types typescript --project-id orlesggcjamwuknxwcpk --schema public > src/integrations/supabase/types.ts
```

This will auto-generate `tournament_packages` and `package_tournaments` types in the Database interface.

---

## 10. Files Summary

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260520000001_tournament_packages.sql` | **NEW** | Create tables + seed data + currency rates |
| `tailwind.config.ts` | EDIT | Add fonts, keyframes, animations |
| `src/index.css` | EDIT | Add utilities, update background color |
| `index.html` | EDIT | Add Google Fonts + Material Symbols links |
| `src/i18n/locales/vi.json` | EDIT | Add Vietnamese translations |
| `src/i18n/locales/en.json` | EDIT | Add English translations |
| `src/hooks/useCountdown.ts` | **NEW** | Live countdown timer hook |
| `src/hooks/useTournamentPackages.ts` | **NEW** | React Query + Supabase data hook |
| `src/hooks/useCurrencyRates.ts` | **NEW** | Fetch exchange rates from app_settings |
| `src/components/packages/CountdownTimer.tsx` | **NEW** | Timer display component |
| `src/components/packages/CurrencyDisplay.tsx` | **NEW** | Multi-currency price display |
| `src/components/packages/PackageCard.tsx` | **NEW** | Package card in listing |
| `src/components/packages/PackageCardSkeleton.tsx` | **NEW** | Shimmer loading state |
| `src/components/packages/BenefitGrid.tsx` | **NEW** | 2x2 benefits grid |
| `src/components/packages/TournamentListItem.tsx` | **NEW** | Tournament info row |
| `src/components/packages/StickyBottomBar.tsx` | **NEW** | Mobile sticky CTA |
| `src/pages/PackageListing.tsx` | **NEW** | Package listing page |
| `src/pages/PackageDetail.tsx` | **NEW** | Package detail page |
| `src/pages/SuperAdmin.tsx` | EDIT | Add "Tỷ giá" tab with rate editor |
| `src/App.tsx` | EDIT | Add routes + lazy imports |
| `src/integrations/supabase/types.ts` | REGEN | After migration |

---

## 11. Manual Post-Implementation Checks

| # | Check | Expected |
|---|---|---|
| 1 | Run `npm run build` | No TypeScript/import errors |
| 2 | Migration applied via `supabase db push` | Tables created, seed data inserted |
| 3 | Types regenerated | `tournament_packages`, `package_tournaments` in Database type |
| 4 | Google Fonts + Material Symbols | Bebas Neue, Inter, Material Icons all loading in browser |
| 5 | Background color | `#0A0A0A` applied globally (check any non-package page) |
| 6 | Package listing at `/packages` | Cards render, images load, countdown ticks, staggered entrance |
| 7 | Package detail at `/packages/:id` | Hero, tournament list, benefits grid, sticky sidebar, mobile bar |
| 8 | Mobile viewport | Cards stack vertically, sticky bar visible, no overlap with iOS safe area |
| 9 | Empty state | If no packages → shows "Hiện chưa có gói ưu đãi nào" |
| 10 | Sold out state | Package with slots_remaining=0 shows disabled "HẾT CHỖ" CTA |
| 11 | Countdown expiry | Timer shows "Đã kết thúc" / expired state |
| 12 | Card hover | Translate up 4px + emerald glow border |
| 13 | CTA button click | Scale to 98% (active:scale-95), navigates correctly |
| 14 | Back navigation | Back button uses `nav(-1)`, works on mobile |

---

## 12. Design Token Reference (from Stitch AI, corrected)

| Token | Value | Usage |
|---|---|---|
| Background | `#0A0A0A` | App background |
| Card bg | `#121212` | Card surfaces |
| Card border | `#2A2A2A` | Card borders |
| Primary accent | `#10B981` (emerald-500) | CTAs, badges, prices, icons |
| Primary hover | `#34D399` (emerald-400) | Button hover |
| Text muted | `#555` / `#888` | Secondary text, strikethrough |
| Text white | `#FFFFFF` | Headings, primary text |
| Font display | `Bebas Neue` | Package names, large headers |
| Font body | `Inter` | Description, body text |
| Brand | `VBACKER` | All text replacements |
