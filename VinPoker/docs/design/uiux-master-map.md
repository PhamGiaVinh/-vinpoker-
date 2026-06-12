# VinPoker — UI/UX Master Map (Phase 0)

> Source of truth for product structure, design rules, and global constraints.
> Produced by Session 6 (Global UI/UX Mapping + Design System Audit) at origin/main `a56399e`.
> Companions: `uiux-screen-inventory.md` (every screen + A–F class), `uiux-roadmap.md` (phases),
> `stitch/README.md` (Stitch usage rules).
> **This map is alignment, not permission** — it shows what exists; file-edit rights come from each session's declaration.

---

## 1. Product UX vision

VinPoker is a poker **operations platform** growing into a poker **ecosystem** (online play later). The UI must serve three audiences at once without compromising any:

- **Operators** (cashier, floor, dealer manager, tracker): dense, fast, truthful screens that answer "what's happening, what needs me, what's safe to do next."
- **Owners**: money clarity — how much, pending vs approved vs paid, who approved, what changed.
- **Players**: a polished, trustworthy consumer surface (schedule, staking marketplace, social) in the PokerVN Stitch Dark identity.

Beauty never outranks operational truth. A screen that hides state to look clean is a regression.

## 2. User role model

| Role | Derived flags | Primary surfaces |
| --- | --- | --- |
| player (default) | — | /, /tournament, /marketplace, /staking/*, /feed, /account |
| club_admin | isClubAdmin | /club/admin, Account club scope |
| super_admin | isAdmin, isClubAdmin, isStaffOps, isMediaOrAdmin | /admin, /admin/*, everything |
| cashier | isCashier, isStaffOps | /cashier, /admin/staking |
| club_cashier | isCashier, isStaffOps (club-scoped) | /cashier (scoped), /admin/staking (scoped) |
| media | isMedia, isMediaOrAdmin | /media |
| tracker | isTracker | /tracker |
| dealer_control | via RPC dealer_control_club_ids | swing/payroll/live tabs, /dealer-board |

Notes: there are **no route-level guards** — all gating is component-level. Capability grants (cashier/dealer_control/tracker per club) are managed in AdminUsers. Any UI change must preserve flag-based show/hide exactly.

## 3. Global navigation model

- **Desktop header**: 12 primary items + role-conditional links (media, club admin, staking, cashier, tracker, admin). Role links append to the right.
- **Mobile bottom nav**: ⚠ currently 10 tab entries rendered into `grid-cols-7` → wraps to a 2-row nav that occludes page bottoms (Layout.tsx:194 vs pb-6rem at :185). Target model: **5 primary slots** (Schedule, Feed, center action, Clubs, Account) + overflow into Account/More. Fixing this is P1 and touches Layout.tsx — single-owner change, coordinate (file currently has uncommitted edits in the main tree).
- `/dealer-board` is intentionally chrome-free in spirit but currently renders **inside** Layout — move outside the Layout route group in P4.
- Operator consoles use URL-state tabs (`?tab=`) — extend this to sub-tabs (staking sub-tabs currently lose state on refresh).

## 4. Information architecture

Three IA layers, kept distinct:

1. **Consumer layer** (public/player): home schedule → detail → register; marketplace → deal → commit; content (news/international/series); social (feed/chat); self-service (account/my-stacks/portfolio).
2. **Operations layer**: `/cashier` is the single operator hub (staking money, members, swing, payroll, live); `/tracker` and `/dealer-board` are role-scoped projections of the same data. Rule: **one workflow, one home** — avoid second copies of a flow in another console (current violations: check-in counter and result-entry exist in both /cashier and /admin/staking; result entry forces a console switch mid-money-flow).
3. **Owner/admin layer**: `/club/admin` (single club owner), `/admin` (platform), future P9 Owner Command Center consolidating money visibility that is currently scattered (RevenueReportTab + FeeRevenueDashboard + SpreadPnL + payroll totals + Account club stats).

## 5. Design system baseline — PokerVN / Stitch Dark

Tokens live in `src/index.css` (HSL CSS variables) + `tailwind.config.ts`. Canonical values at a56399e:

| Token | Value | Notes |
| --- | --- | --- |
| `--primary` | `152 100% 50%` (#00FF88 neon green) | brand primary; `--primary-glow` 152 100% 60% |
| `--background` | `0 0% 4%` (#0A0A0A) | dark base |
| `--card` | `213 9% 12%` (#1D2023) | surface |
| `--secondary` / `--muted` | 213 9% 16% / 14% | containers |
| `--destructive` | `6 100% 70%` | errors |
| `--warning` | `38 92% 65%` | amber |
| `--success` | = primary | success states |
| `--border` | `213 9% 22%` | dividers |
| `--foreground` | `220 11% 89%` (#E1E2E7) | text |
| GTO colors | Fold #3B82F6 · Call #22C55E · Raise #EF4444 · All-in #991B1B | trainer only |

Utilities: `.gradient-neon`, `.gradient-card`, `.shadow-neon`, `.shadow-card`. Legacy aliases `.gradient-gold/.text-gold/.border-gold/.shadow-gold` resolve to neon — **deprecated, scheduled for P1 codemod** (120 uses across 37 files; one literal gold remains at index.css:304 `.table-card--swinging`).

Known token-system defects (P1):
- `fontFamily.mono` is NOT monospace (`Inter/AppDigits/Playfair…`) — 207 `font-mono` uses render proportional digits; `font-jetbrains` exists unused. **One-line fix with app-wide payoff.**
- Second "primary green" #10B981 (emerald) hardcoded in `.btn-primary`/`.badge-early-bird` competes with #00FF88.
- Hardcoded hex in `.ot-badge--*`, `.countdown-badge--*`, `.priority-break-badge--*`, `.table-card--focused`.
- Dealer-ops screens run a parallel raw `zinc-*` palette (226 uses in 10 files) — theme changes never propagate there.

## 6. Component hierarchy

```
tokens (index.css / tailwind.config.ts)
  └─ shadcn/ui primitives (47 components in src/components/ui/)
      └─ shared app primitives (TO BUILD in P1): StatusPill · StatCard · PageLoader · EmptyState · ErrorState · ResponsiveTable helpers
          └─ domain components (cashier/*, admin/*, feed/*, gto/*)
              └─ pages (src/pages/*)
```

Current gaps: the "shared app primitives" layer barely exists — 9 duplicate stat cards, 8+ status-badge implementations, 25+ copy-pasted Loader2 blocks. All new UI work must consume the P1 primitives once they land; no new local Stat/StatusBadge/Loader clones.

## 7. Dashboard layout rules

- Operator hubs: left sidebar (desktop) / scrollable pill bar (mobile, `overflow-x-auto`, never icon-only with duplicate icons), URL-synced `?tab=`.
- KPI strip at top: counts **and VND amounts** for money queues; KPIs deep-link to the exact sub-tab they describe.
- Tab strips: adopt MediaCenter's horizontal-scroll TabsList everywhere; never force N tabs into `grid-cols-N` that cramps below lg (SuperAdmin's 12-col strip and TournamentLivePanel's 3-row wrap are the anti-patterns).
- Right-rail pattern (DealerSwingTab command center) is good — attention queue, ops summary, health, quick links — keep it through the P4 decomposition.
- Wall displays (/dealer-board): chrome-free route, max contrast, `tabular-nums` countdowns, glanceable from meters away.

## 8. Forms / input rules

- shadcn Input/Select/Switch only — no native `<select>` (RangeEditor) or native checkboxes for operational actions (TableDrawPanel bust toggle).
- Touch minimum: 40px hit area for any action in operator flows; 24–28px inputs (h-6/h-7) are not acceptable on floor screens.
- Money/bank inputs: explicit format hints, never silently trimmed; bank fields that feed payouts show a "this is where money goes" warning.
- Destructive or money-moving submit buttons require a confirmation dialog that **re-states the amounts/counts** being affected (see §15).

## 9. Tables / data-grid rules

- Every table either fits mobile or ships a card alternative. Sanctioned patterns (already in repo): Tournaments dual-render, Leaderboard table+cards, DealerPayrollTab `hideBelow` ColumnDef.
- Wide ops tables: sticky first (identity) column; expand-row or detail sheet instead of >12 simultaneous columns on <lg.
- All money/hour columns: `font-mono tabular-nums` (after the P1 mono fix).
- History/audit tables always render **actor + timestamp** columns when the data exists (refund history currently fetches `refunded_by` and drops it — never repeat that).
- No silent row caps: if a query is limited (2000-row RevenueReport), say so on screen.

## 10. Status badge rules

- One shared `<StatusPill>` (P1) with domain variant maps: registration, tournament, deal/purchase, dealer tier, payroll adjustment, web-vitals rating.
- Semantic colors only: success=primary, warning=`--warning`, danger=`--destructive`, neutral=muted. No per-screen color invention; no hardcoded hex.
- The three name-colliding `StatusBadge` implementations (components/StatusBadge.tsx, TournamentLivePanel:28, TournamentRegistrationsTab:222) migrate first.

## 11. Money / number / time display rules

- VND via `formatVND`; never raw `toLocaleString` in new code. One currency per surface — do not mix USD and VND in sibling tabs without explicit labels (Leaderboard violates this today).
- Digits in countdowns, payroll, reports: `font-mono tabular-nums` (post-P1).
- Time: `formatDateTime`/`formatTime` (Asia/Ho_Chi_Minh); countdowns must tick, never render-once (cashier 30-min hold is frozen today — anti-pattern).
- Derived financial labels must be explained on screen ("Lợi nhuận ròng" = ?) and never overstate ("P&L" tab showing gross escrow inflow must be renamed or recomputed).
- Money queues show **sums, not just counts**.

## 12. Error / loading / empty-state rules

- P1 ships `PageLoader`, `EmptyState` (icon+title+hint+optional action), `ErrorState` (message+retry — modeled on TrackerDashboard:49, the best existing pattern).
- Every data surface handles all three states; no bare `Loader2` copy-paste, no empty-`div` empty states.
- Realtime surfaces show staleness honestly: last-updated stamp + "realtime down, polling" indicator (tracker PR #12 pattern) instead of silently stale numbers.

## 13. Mobile-first rules

- Evaluate every screen at 360–390px, tablet, desktop. Operators use phones on the floor — /cashier, /tracker, /dealer-board are mobile surfaces, not desktop-only.
- Fix order (from audit): Layout bottom-nav grid/count mismatch (global, P1) → touch targets in TableDrawPanel + DealerPayrollTab → sticky payroll name column → DealerManagementTab 12-col grid collapse → TournamentLiveView seat-pod overlap <411px.
- Heroes on data-list pages: compact on phone (`py-6 md:py-16`) — a decorative hero may not consume 250px of the first viewport.
- No hover-only affordances (DealerSwingTab score tooltip) — use tap-toggled Popover.
- Respect `env(safe-area-inset-*)`; derive content padding from real nav height.

## 14. Accessibility and contrast

- Dark theme: maintain ≥4.5:1 for body text (foreground #E1E2E7 on #0A0A0A passes; muted-foreground on muted needs checking when restyling).
- Critical state text (ALL-IN, FOLDED, THIẾU DEALER) never below text-xs; text-[10px] is for decorative metadata only.
- Color never the sole signal — pair with icon/label (rest guard, urgency states).
- Focus states preserved on all interactive elements; icon-only buttons get aria-labels.

## 15. Operator-safety rules

Every operational screen must answer: *What is happening? What needs attention? What can I safely do next? What changed recently? Who did it? Can I undo or audit it?*

Hard rules derived from audit findings:
1. **Money-moving and irreversible actions get a real confirmation dialog** restating amount + reference + proof; native `window.confirm/prompt` is banned for these. (FUNDED confirm, check-in cash, payroll approve/lock, payout execute.)
2. **Per-item buttons act on that item only** — never global side effects from a row action (AttentionQueue per-table swing currently fires club-wide auto-swing: P0-class intent bug, fix in P4).
3. **Actors are visible**: confirmed_by / refunded_by / submitted_by / approved_by rendered with names, not uuid prefixes; payroll "Gửi bởi" must show the stored submitter, not the current viewer.
4. **Two-person controls are real**: UI must not offer an auto-cosign-own-request path (AdminStaking 1-step payout) unless backend provably rejects same-user cosign — surface the requirement explicitly.
5. **Mass actions preview their blast radius** ("this will move N dealers across M tables") before executing.
6. **Post-approval immutability**: once submitted/approved, adjustments lock until rejected back to draft.
7. **Audit surfaces are readable**: action + actor name + target + old→new, one click from the workflow.

## 16. Owner-finance clarity rules

Every owner/business screen must answer: *How much money is involved? What is pending? What is approved? What is paid? What is risky? Who approved it? What changed from last period?*

Current state (audit): none of the seven are fully answerable anywhere. Rules for all finance UI work:
- Aggregate VND for every queue state (pending confirm, awaiting release, approved-unpaid, paid).
- Period-over-period delta on every KPI.
- Risk strip: stuck deals (>48h in result_entered), releases pending cosign >24h, missing transfer proofs, refund spikes, OT cost spikes.
- Honest labels (see §11). Payroll cost joins revenue on the same owner surface (P9).
- Tournament payouts need a system of record (`tournament_payouts` — P6); until then PrizeStructurePanel carries a visible "not a payment record" disclaimer (already present — keep it).

## 17. Poker / casino visual rules

- Global theme stays PokerVN Stitch Dark: neon green on near-black, high contrast, professional ops feel.
- **Red felt / burgundy casino styling is allowed only inside explicit poker-table visual components** (TournamentLiveView felt, future PokerTable3D) — never as page background or global accent.
- Forbidden globally: pastel dashboards, purple "AI" gradients, random bright accents, cartoon casino assets, red global redesign.
- Card suits/colors follow standard conventions inside table views; GTO colors stay reserved for trainer surfaces.

## 18. Future 3D poker visual integration (Track B/C/D)

- Godot client is **visual only**; server-authoritative engine decides everything (cards, pots, winners). UI work never implements game authority client-side.
- The shared state contract (PublicTableState / PrivatePlayerState / views) gates integration; until it exists, 3D work uses mock state.
- `TournamentLiveView` is the 2D precedent and a warning: it already carries `hole_cards` into a public route — the engine contract must structurally prevent hidden-card leakage (private views per player), not rely on component discipline.
- Phase 8 only after engine foundations are stable; lobby/table/session UI joins the consumer layer then.

## 19. Stitch usage rules

See `docs/design/stitch/README.md`. Summary: ideation only; translate to React/Tailwind/shadcn tokens; never paste Stitch HTML; never add UI libraries; `public/stitch-preview/` and `StitchSchedulePreview.tsx` are references, not shippable components (raw hex palettes).

## 20. What must never be changed globally

1. The PokerVN Stitch Dark palette and neon-green primary (#00FF88) — no global rebrand, no red/burgundy global theme.
2. Token semantics in `index.css`/`tailwind.config.ts` without a dedicated design-system session (P1-scope changes only, verified app-wide).
3. `Layout.tsx` shell behavior, role-link gating, and safe-area handling — single-owner file, one session at a time.
4. `useAuth` role flags and component-level gating logic.
5. Protected production modules from UI sessions: Dealer Swing logic, Payroll computation, Cashier money flow, Seat assignment backend, Supabase migrations/RPCs/Edge Functions, Telegram notifications.
6. The hidden-card invariant: no UI change may widen what the public live view can render from seat payloads.
7. `format.ts` output formats (money/date) without auditing all ~50 consumers.
8. Vietnamese-first operator UI language — do not silently switch operator surfaces to English.
9. URL contracts operators rely on: `/cashier?tab=`, `/admin/staking?deal=`, `/dealer-board` club filter.
10. Realtime/polling cadences on floor surfaces without measuring low-end club hardware impact.
