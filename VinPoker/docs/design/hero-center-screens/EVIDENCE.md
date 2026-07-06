# Desktop / tablet hero-centre layout — visual evidence

Online play table (`/poker/table/:id`). On **desktop & tablet (Tailwind `sm:` ≥ 640px)** the hero
(your own seat) now sits as a real **bottom-centre ring seat** with face-up hole cards — the
GG / N8 / PokerStars desktop convention — instead of the old bottom-left corner HUD. The action
dock (bet/fold/raise) moves to the **bottom-right**. **Mobile (< 640px) is unchanged.**

Verified live against the dev harness `/__dev/table` (pure typed fixtures — no Supabase / auth),
measured via `page.evaluate` (CSS px):

| Viewport | State | Hero | Corner HUD | Action dock | Result |
|---|---|---|---|---|---|
| Desktop 1280×800 | 6-max flop, my turn | in-ring, centred (cx≈640 = oval centre 640) | `display:none` | bottom-right (fold cx=773, below oval) | ✅ no overlap |
| Tablet 768×1024 | 9-max turn, my turn | in-ring, centred; all 8 opponents arced | `display:none` | sizing tiles right (x≥604) clear of hero (x≤427); fold row at very bottom | ✅ no overlap |
| Mobile 390×844 | 6-max flop, my turn | in-ring pod **hidden** (not visible) | `display:flex`, bottom-left (cx=24) | full-width (fold l=4) | ✅ **unchanged** |
| Desktop 1280×800 | 9-max **preflop**, my turn | in-ring, centred | `display:none` | hybrid **BB** tiles: Tất tay 100BB · 4× · 3× · 2.5× · 2× | ✅ ActionBar logic intact |

Screenshots in this folder:
- `hero-center-desktop-1280.png` — 6-max flop
- `hero-center-tablet-768-9max.png` — 9-max turn (tightest: narrow + crowded)
- `hero-center-mobile-390.png` — mobile, unchanged (HUD bottom-left)
- `hero-center-desktop-9max-preflop.png` — 9-max preflop (BB-sizing tiles = #551 logic preserved)

0 console errors on every load.
