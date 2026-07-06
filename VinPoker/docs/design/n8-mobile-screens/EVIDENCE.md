# N8-ratio mobile table — visual evidence (owner mockup v3)

Online play table, **mobile < 640px, `heroAsHud` path only**. Owner complaint: "tỉ lệ bàn và
người chơi không giống N8 1 chút nào" (elongated full-screen ellipse, tiny sparse pods, board
stuck at centre). Approved mockup v3: stadium felt to the bottom of the phone, board/pot lifted,
seats clustered in the upper felt, hero's own cards LARGE inside the table's lower-left,
dock overlaying the felt.

Measured live on `/__dev/table` (typed fixtures, no Supabase), CSS px at 390×844.

## Before → after (9-max flop, my turn)

| Metric | Before | After | Target (mock v3) |
|---|---|---|---|
| Felt border-radius | `48%` ellipse (nhọn) | **`46% / 21%`** stadium | stadium |
| Board/pot block y | **49%** màn hình | **31%** | ~31% |
| Seat-row span | 9% → **73%** (pgv giữa vùng dock) | 7% → **52%** (all upper felt) | ≤ ~52% |
| Hero cards | 30×40 (mc, equal rule) | **44×64 (`lg`)** fanned | to hơn board |
| Bet chips | at plate edge (edge-anchor slot bug) | from pod visual centre, t=0.5 toward {50,38} | clear of plates |
| Pod↔HUD / pod↔dock overlaps | — | **0 / 0** | 0 |

## Regression (must be unchanged)

| Surface | Check | Result |
|---|---|---|
| Desktop 1280 (`sm:`) | radii `48/47/46/44%`, board 50% of oval, hero in-ring centre, HUD `display:none`, fold cx=773 | ✅ identical to #729 measurements |
| Cinematic `AllInRunout` (no heroAsHud) | radii `48/47/46/44%` legacy oval | ✅ |
| Off-turn mobile | dock gone, HUD visible | ✅ |

## Screenshots
- `before-mobile-390-{9max-flop,6max-flop,2max-preflop}.png` — baseline (elongated ellipse)
- `after-mobile-390-9max-flop.png` — stadium 9-max, my turn
- `after-mobile-390-6max-premium.png` — 6-max turn, premium (owner's skin)
- `after-mobile-390-2max-preflop.png` — heads-up
- `after-mobile-390-9max-offturn.png` — off-turn (no dock)
- `after-desktop-1280-regression.png` — desktop unchanged vs #729

0 console errors on every load.
