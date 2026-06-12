# VinPoker — UI/UX Screen Inventory (Phase 0)

> Session 6 — Global UI/UX Mapping + Design System Audit.
> Audited read-only at origin/main commit `a56399e` (includes merged PR #15 seat/floor-ops).
> Worktree: `D:\VinPoker-uiux-map`. Docs-only session — no app code changed.
>
> **Classification scale (conservative — uncertain production screens are marked E, never downgraded):**
> **A** = production-critical, operator/business-impacting, active workflow ·
> **B** = important user-facing or owner-facing ·
> **C** = useful but lower-risk ·
> **D** = legacy/low-traffic ·
> **E** = needs owner decision / unclear ownership ·
> **F** = future/mock/orphan/unrouted
>
> **Suggested batch** uses the roadmap phases in `uiux-roadmap.md`:
> P1 design-system cleanup · P2 cashier IA · P3 tracker/tournament-live · P4 dealer swing ·
> P5 payroll/owner finance · P6 seat/floor ops · P7 staking · P8 game engine/3D · P9 owner command center.

---

## 1. Route map

All routes lazy-loaded via Suspense in `src/App.tsx`. **No route-level role guards** — protection is component-level via `useAuth` flags (`isAdmin`, `isCashier`, `isTracker`, `isClubAdmin`, `isStaffOps`, `isMediaOrAdmin`).

| Route | Page | Access |
| --- | --- | --- |
| `/auth`, `/auth/callback`, `/verify-email`, `/forgot-password`, `/reset-password`, `/terms`, `/privacy`, `/setup-davinci` | Auth flow + legal + bootstrap | public, **outside Layout** |
| `/` | Tournaments | public |
| `/tournament/:id` | TournamentDetail | public |
| `/live/:tournamentId` | TournamentLiveTracker | authed (spectator) |
| `/series/:id` | SeriesDetail | public (+admin CRUD) |
| `/clubs`, `/club/:id` | Clubs, ClubDetail | public |
| `/leaderboard` | Leaderboard | public (+admin export) |
| `/documents`, `/video` | Documents (5 tabs), Video | public (+admin CRUD) |
| `/feed` | Feed | authed |
| `/news`, `/news/:slug`, `/international` | News, NewsDetail, InternationalEvents | public (+media CRUD) |
| `/marketplace`, `/find-backer` | Marketplace, FindBacker | public browse / authed buy |
| `/staking/new`, `/staking/my-deals`, `/staking/portfolio` | StakingNew, StakingMyDeals, StakingPortfolio | authed (KYC for new) |
| `/my-stacks`, `/account`, `/player/:userId` | MyStacks, Account, PlayerProfile | authed / public profile |
| `/chat/:tournamentId`, `/inbox`, `/dm/:userId`, `/group/:groupId`, `/invite/:token` | BookingChat, ChatInbox, DirectChat, GroupChat, GroupInvite | authed |
| `/notifications`, `/notification-settings`, `/unsubscribe` | Notifications, NotificationSettings, Unsubscribe | authed / public link |
| `/packages`, `/packages/:packageId` | PackageListing, PackageDetail | public |
| `/cashier?tab=…` | CashierDashboard (7 tabs) | cashier / club_cashier / super_admin |
| `/dealer-board` | DealerControlBoard | dealer_control (⚠ not linked in nav — direct URL only) |
| `/tracker` | TrackerDashboard | tracker |
| `/club/admin` | ClubAdmin | club owner |
| `/admin` | SuperAdmin (12 tabs) | super_admin |
| `/admin/users`, `/admin/leaderboard`, `/admin/money-list`, `/admin/web-vitals`, `/admin/tournaments/bulk-create`, `/admin/tournament-config/:clubId`, `/admin/gto-ranges` | Admin tools | super_admin (config also dealer_control/club_admin) |
| `/admin/staking` | AdminStaking (3 groups) | isStaffOps |
| `/media` | MediaCenter (6 tabs) | media / super_admin |
| `*` | NotFound | public |

⚠ Known broken route: `PackageDetail` register CTA navigates to `/packages/:id/register`, which **does not exist** → 404.

## 2. Page/component map

56 page files in `src/pages/`; 54 routed. Component clusters:

- `src/components/cashier/` — DealerSwingTab (4,272 lines), DealerPayrollTab (1,199), DealerManagementTab, TableCard*, DealerRow, TournamentLivePanel + `tournament-live/` (8 panels), `command-center/` (5 widgets, 1 orphan), RevenueReportTab, UnifiedLookupTab, SyncMembersTab, ClubCardQrTab
- `src/components/admin/` — CashierCounter, TournamentRegistrationsTab, FeeRevenueDashboard, FeeConfigManager, SpreadPnL, AdminStreamManager, AdminSupportTab, MediaClubSchedules, BackingReviewQueue
- `src/components/gto/` — ICMCalculator, EquityCalculator, RangeHistoryPanel
- `src/components/feed/` — story dialogs, music sticker
- `src/components/ui/` — 47 shadcn primitives
- Shared singles: Layout, TournamentRegisterModal, TransferInstructions, FomoPrice, StatusBadge, PlayerHistoryDialog, AvatarUploader, LanguageSwitcher …

## 3. Dashboard section map

| Dashboard | Sections/tabs | URL state |
| --- | --- | --- |
| CashierDashboard `/cashier` | overview · staking (6 sub-tabs: pending/check-in/result/history/refund/refund-history) · members (5 sub-tabs) · reports · swing · payroll · tournament_live (8 panels) | `?tab=` synced; staking sub-tabs NOT synced |
| SuperAdmin `/admin` | tournaments · series · registrations · clubs · backing · banners · P&L · livestream · rates · packages · support · profiles | none |
| ClubAdmin `/club/admin` | one long scroll: status, members, banks, bot, dealer tours, streams, bookings, tournaments, registrations, logs | none |
| Documents `/documents` | files · videos · ICM · equity · bankroll | none |
| Account `/account` | profile · QR · scope toggle · stats/charts (club scope) · bank · notifications · admin shortcuts | none |
| MediaCenter `/media` | news · banners · series · international · club schedules · support | — (best-in-app scrollable TabsList) |
| AdminStaking `/admin/staking` | Ops (counter/pending/registrations/release/dispute) · History (confirm log/audit) · Config (banks/fees/fee revenue) | `?deal=` deep link only |

---

## 4. Public pages (per-screen inventory)

### Tournaments (Home)
```txt
Screen:        Tournaments (Home)
Path/Component: src/pages/Tournaments.tsx (906 lines)
User role:     public; super_admin can reorder club schedule images
Purpose:       Home hub — weekly/daily schedule, club schedule images, series, embedded News tab, livestream, live-tracker list, packages preview, banner carousel
Main actions:  filter/search, TournamentRegisterModal, navigate to detail/live/series/packages; admin reorder
Data source:   tournaments(+clubs), app_settings (banners), tournament_series, clubs; realtime live-tracker-list; useTournamentPackages
Current UI quality: good — Loveable hero, consistent neon primary; but overloaded (7 view tabs, embeds whole News page), tab state not in URL
Main UX risks: admin write from public page without rollback; 1s tick re-filters all rows; duplicate News surface
Suggested improvement batch: P1 (polish/split); tab-state→URL
Class: B — primary landing page driving registrations
```

### TournamentDetail
```txt
Screen:        TournamentDetail
Path/Component: src/pages/TournamentDetail.tsx
User role:     public; register/chat require auth
Purpose:       Tournament info, live banner, livestream, free-rake promo, sticky register/chat CTA
Main actions:  register (tournament-register edge fn), continue pending payment, booking chat, follow live
Data source:   tournaments(+clubs), stack_registrations, tournament_registrations; realtime tournament-:id
Current UI quality: fair — legacy gradient-gold, no hero; good mobile sticky CTA
Main UX risks: TWO parallel registration systems surfaced inconsistently (stack_registrations vs tournament_registrations); count = max() of two sources; bottom bar occlusion
Suggested improvement batch: P1 visual; registration-system unification needs owner decision (see §12)
Class: B — gateway to paid registration
```

### Clubs / ClubDetail
```txt
Screen:        Clubs (+ClubDetail)
Path/Component: src/pages/Clubs.tsx, src/pages/ClubDetail.tsx
User role:     public
Purpose:       Club directory + club profile with schedule images and upcoming tournaments
Main actions:  filter/sort, navigate
Data source:   clubs (approved), tournaments by club
Current UI quality: Clubs good (Loveable hero); ClubDetail fair (legacy gold, no hero)
Main UX risks: HARDCODED fake ratings (4.8 / 5.0 by name regex) and static "Open" badge displayed as real data — trust risk; rating sort uses DB column while display shows fake values
Suggested improvement batch: P1 (and remove fake data or wire real ratings)
Class: C — read-only directory
```

### Leaderboard
```txt
Screen:        Leaderboard
Path/Component: src/pages/Leaderboard.tsx
User role:     public; super_admin Excel export
Purpose:       All-time money list, club money list, trusted (admin-verified) results
Main actions:  tabs, filters, search, pagination, PlayerHistoryDialog, export
Data source:   leaderboard_entries, all_time_money_list, club_money_list, player_results, clubs, profiles; realtime on 4 tables (full reload per event)
Current UI quality: good — Loveable hero, rank styling, table+mobile-card duality on trusted tab
Main UX risks: realtime reload-everything (N+1 profiles); USD vs VND mixed between tabs; hero burns ~250px of phone viewport
Suggested improvement batch: P1
Class: B — public reputation surface
```

### News / NewsDetail / InternationalEvents / SeriesDetail
```txt
Screen:        News (+NewsDetail, InternationalEvents, SeriesDetail)
Path/Component: src/pages/News.tsx, NewsDetail.tsx, InternationalEvents.tsx, SeriesDetail.tsx
User role:     public read; media/super_admin CRUD (draft/schedule/publish on News)
Purpose:       Content surfaces: news listing+article, international series catalog, series detail with posts
Main actions:  read/share; media CRUD with image upload (app-assets)
Data source:   news_posts, international_events, tournament_series, series_posts; storage app-assets
Current UI quality: good (News/International have Loveable hero); SeriesDetail fair (admin CRUD inlined, English-only labels)
Main UX risks: NewsDetail bumps view_count via raw client UPDATE (race + RLS question); admin CRUD mixed into public surfaces; News page doubles as embedded component inside Tournaments (renders in two containers)
Suggested improvement batch: P1 (content console consolidation note in roadmap)
Class: C — content/marketing
```

### Documents (+ Video, embedded BankrollManager)
```txt
Screen:        Documents (5 tabs) + Video + BankrollManager (embedded)
Path/Component: src/pages/Documents.tsx, Video.tsx, BankrollManager.tsx; src/components/gto/*
User role:     public read; super_admin CRUD; bankroll per-user
Purpose:       Learning hub — files, videos with SRT subtitles, ICM/Equity calculators, personal bankroll tracker
Main actions:  view/download/play; admin DocumentUploadDialog CRUD; bankroll session CRUD
Data source:   documents; bankroll_entries/bankroll_settings; calculators client-side
Current UI quality: good — Loveable hero, lazy tabs; BankrollManager rich recharts
Main UX risks: window.confirm deletes; no URL tab state (can't deep-link a calculator); bankroll sample-data generator pollutes real table
Suggested improvement batch: P1
Class: C — educational tooling
```

### PackageListing / PackageDetail
```txt
Screen:        PackageListing + PackageDetail
Path/Component: src/pages/PackageListing.tsx, PackageDetail.tsx
User role:     public
Purpose:       Tournament package products with early-bird pricing/countdown
Main actions:  browse; "Register" CTA
Data source:   tournament_packages (useTournamentPackages)
Current UI quality: good visually — but built on a PARALLEL utility-class system (card-premium, btn-primary) with hardcoded emerald gradient (#10B981) competing with brand primary
Main UX risks: P1 BUG — register CTA navigates to unrouted /packages/:id/register → 404; registered_count shown with no enforcement
Suggested improvement batch: P1 (fix CTA + fold custom classes into tokens)
Class: C — sales page with unfinished checkout
```

### Auth flow (Auth, AuthCallback, VerifyEmail, ForgotPassword, ResetPassword)
```txt
Screen:        Auth flow (5 screens)
Path/Component: src/pages/Auth.tsx, AuthCallback.tsx, VerifyEmail.tsx, ForgotPassword.tsx, ResetPassword.tsx
User role:     public / recovery session
Purpose:       Email/password sign-in/up with ToS modal, OTP callback, verification, password reset
Main actions:  supabase.auth calls; display-name uniqueness pre-check
Data source:   supabase.auth; profiles (display_name_lower)
Current UI quality: fair — legacy gold branding; brand says "VBacker" not VinPoker; AuthCallback good (clear states)
Main UX risks: racy client-side display-name check; brand inconsistency; hardcoded Vietnamese (no i18n) on reset screens
Suggested improvement batch: P1
Class: B (Auth, AuthCallback — gateway/critical path); C (the 3 support screens)
```

### Terms / Privacy / Unsubscribe / NotFound
```txt
Screen:        Terms, Privacy, Unsubscribe, NotFound
Path/Component: src/pages/{Terms,Privacy,Unsubscribe,NotFound}.tsx
User role:     public
Purpose:       Legal pages; one-click email unsubscribe; 404
Main actions:  none / auto-invoke email-unsubscribe edge fn on load
Data source:   i18n strings; edge fn email-unsubscribe
Current UI quality: fair; NotFound poor (bg-muted clashes with dark theme, unbranded)
Main UX risks: Unsubscribe fires with bare ?email= param, NO token — anyone with a URL can unsubscribe any address; prefetchers can trigger it (backend hardening item)
Suggested improvement batch: P1 (NotFound rebrand); unsubscribe token = backend item
Class: C / D (NotFound)
```

### SetupDavinci ⚠
```txt
Screen:        SetupDavinci
Path/Component: src/pages/SetupDavinci.tsx
User role:     public route attempting super_admin bootstrap
Purpose:       Dev bootstrap for hardcoded super-admin account (email visible on screen), checks user_roles, redirects /admin
Main actions:  signIn/signUp against the hardcoded admin email
Data source:   supabase.auth; user_roles
Current UI quality: poor — dev utility with on-screen log output, publicly routed
Main UX risks: SECURITY — advertises the super-admin email publicly and allows sign-in/sign-up attempts; safety depends entirely on DB triggers/RLS
Suggested improvement batch: owner decision required before removal/gating (do NOT silently delete)
Class: E — needs owner decision
```

---

## 5. Authenticated player pages

### Feed
```txt
Screen:        Feed
Path/Component: src/pages/Feed.tsx
User role:     authed player
Purpose:       Social feed — posts with poker-hand attachments, likes/comments, 24h stories with music
Main actions:  CreatePostDialog (media → feed-media bucket, hand builder), like, comment, CreateStoryMultiDialog, StoryViewer
Data source:   feed_posts/likes/comments, feed_stories/views, profiles; realtime feed-rt on 4 tables
Current UI quality: good — Loveable hero, Instagram-style stories
Main UX risks: realtime reload-everything on any like in the system; N+1 profile fetches
Suggested improvement batch: P1
Class: C — engagement feature, no money/ops
```

### Account
```txt
Screen:        Account
Path/Component: src/pages/Account.tsx
User role:     player; club-scope mini-dashboard for club_admin/super_admin
Purpose:       Profile + avatar + BANK DETAILS (locked while live staking purchases) + check-in QR + notification prefs + club booking stats/charts/export + admin shortcut menu
Main actions:  save profile/bank (profiles), Excel export, check update, sign out, admin nav
Data source:   profiles, staking_purchases(+deals) for bank lock, stack_registrations, clubs, tournaments, booking_chats, chat_messages; realtime acct-regs/acct-unread
Current UI quality: good — Loveable hero; but a grab-bag (player profile + owner mini-dashboard + admin nav in one screen)
Main UX risks: bank fields feed staking payouts — typo = misdirected money (regex-only validation); per-chat unread count query loop; duplicates ClubAdmin stats
Suggested improvement batch: P9 (club stats → owner command center); P1 visual
Class: B — owner/player-facing with money-adjacent fields
```

### MyStacks
```txt
Screen:        MyStacks
Path/Component: src/pages/MyStacks.tsx
User role:     authed player
Purpose:       Player's stack-booking list with cancel
Main actions:  cancel pending registration (no confirm dialog)
Data source:   stack_registrations(+tournaments+clubs); 30s polling
Current UI quality: fair — legacy gold, simple list
Main UX risks: cancel without confirmation; shows ONLY legacy stack_registrations — newer tournament_registrations bookings invisible here
Suggested improvement batch: P2
Class: B — player view of the booking pipeline cashiers confirm
```

### PlayerProfile
```txt
Screen:        PlayerProfile
Path/Component: src/pages/PlayerProfile.tsx
User role:     public view; super_admin verification toggles
Purpose:       Public player page — stats, verified results, upcoming events with proofs, backer reviews, express backing interest
Main actions:  InterestDialog (backing_interests); admin verification toggles; "Report scam"
Data source:   edge fn get-public-profile; profiles, player_stats, backer_reviews, player_upcoming_events, event_proofs, player_results
Current UI quality: fair — plain, no hero
Main UX risks: "Report scam" is a NO-OP success toast (fake affordance); two profile sources can disagree
Suggested improvement batch: P7
Class: B — trust surface for staking marketplace
```

### Chat suite (BookingChat, ChatInbox, DirectChat, GroupChat, GroupInvite)
```txt
Screen:        BookingChat
Path/Component: src/pages/BookingChat.tsx
User role:     player + club owner/super_admin (receptionist mode)
Purpose:       Per-tournament booking chat where club staff CONFIRM/reject bookings and payment
Main actions:  messages + image upload; receptionist: confirm booking (stack_registrations + tournaments.current_players++), reject, confirm payment, close chat
Data source:   tournaments, booking_chats, chat_messages, profiles, stack_registrations; storage chat-uploads; realtime chat-:id
Current UI quality: fair — booking state driven by chat buttons, not a structured panel
Main UX risks: current_players incremented by client read-then-write (RACE, no transaction); multi-step writes can partially fail; bot inserts rely on permissive RLS
Suggested improvement batch: P2
Class: A — active operator workflow confirming paid bookings

Screen:        ChatInbox / DirectChat / GroupChat / GroupInvite
Path/Component: src/pages/{ChatInbox,DirectChat,GroupChat,GroupInvite}.tsx
User role:     authed; club-side inbox for club_admin
Purpose:       Unified inbox (booking/DM/group), 1:1 DMs, group chat with read receipts, invite links
Main actions:  open/unarchive chats, send messages, accept invite (RPCs get_invite_preview/accept_group_invite)
Data source:   booking_chats, chat_messages (latest 500), direct_chats/messages, chat_groups/members/messages; 15s polling (inbox)
Current UI quality: fair — serviceable
Main UX risks: inbox loads 500 messages for previews; DM find-or-create can race-duplicate chats; RLS is sole scoping
Suggested improvement batch: P2 (inbox), P1 (DM/group polish)
Class: B (ChatInbox — operator triage); C (DirectChat, GroupChat, GroupInvite)
```

### Notifications / NotificationSettings
```txt
Screen:        Notifications + NotificationSettings
Path/Component: src/pages/Notifications.tsx (+useNotifications), NotificationSettings.tsx
User role:     authed player
Purpose:       In-app notification center; email + OneSignal push prefs
Main actions:  mark read, deep-link routing; toggle prefs
Data source:   notifications (realtime); profiles.push_prefs; lib/onesignal
Current UI quality: fair
Main UX risks: none significant
Suggested improvement batch: P1
Class: C
```

---

## 6. Cashier pages

### CashierDashboard shell
```txt
Screen:        CashierDashboard (shell + sidebar)
Path/Component: src/pages/CashierDashboard.tsx
User role:     cashier / club_cashier / club owner / super_admin (swing+payroll+live gated by dealer_control_club_ids)
Purpose:       Single operator hub: staking money-flow, members, revenue, dealer swing, payroll, tournament live
Main actions:  URL-synced section switch; per-club scoping
Data source:   RPC cashier_club_ids, RPC dealer_control_club_ids, clubs
Current UI quality: good — token-consistent, URL-state tabs, skeletons
Main UX risks: phone sidebar collapses to icon-only with DUPLICATE Table2 icon for Swing and Tournament Live (blind tapping); admin with 0 clubs silently sees global data
Suggested improvement batch: P2
Class: A — production entry point for club money/staff ops
```

### Cashier › Overview
```txt
Screen:        Cashier › Overview
Path/Component: CashierDashboard.tsx (OverviewPanel)
User role:     cashier
Purpose:       4 KPI counts (active deals, pending FUNDED, pending results, today check-ins) + quick guide
Main actions:  KPI click → staking tab; manual refresh
Data source:   staking_deals, staking_purchases (count head queries)
Current UI quality: good
Main UX risks: counts only — NO VND amounts ("how much money is waiting" missing); no realtime — stale until manual refresh; all KPIs land on same tab (no sub-tab deep link)
Suggested improvement batch: P2
Class: A — daily triage view
```

### Cashier › Staking (6 sub-tabs)
```txt
Screen:        Cashier › Staking (Chờ xác nhận / Check-in / Kết quả & Giải ngân / Lịch sử / Hoàn tiền / Lịch sử hoàn tiền)
Path/Component: CashierDashboard.tsx (StakingPanel + sub-tabs); check-in → src/components/admin/CashierCounter.tsx
User role:     cashier/staffOps
Purpose:       Confirm backer transfers (FUNDED), QR check-in, monitor payouts, history+export, irreversible refunds
Main actions:  confirm FUNDED (edge fn admin-confirm-funded) — SINGLE CLICK, no dialog, allowed without proof; refund (edge fn staking-process-refund) with reason dialog; Excel export; deep-link to /admin/staking?deal=
Data source:   staking_purchases, staking_deals, profiles, membership_verification_requests, clubs; edge fns
Current UI quality: fair — money warnings at text-[11px]; result tab read-only (forces context switch to /admin/staking)
Main UX risks: FUNDED confirm has no amount re-display/proof gate; 30-min countdown frozen at render; refunded_by fetched but NEVER displayed; sub-tabs not URL-synced
Suggested improvement batch: P7 (money flow), P2 (IA)
Class: A — real money confirmation/refund
```

### Cashier › Members (5 sub-tabs)
```txt
Screen:        Cashier › Members (Tra cứu / Đồng bộ / QR thẻ CLB / Yêu cầu xác minh / Cấp lại thẻ)
Path/Component: CashierDashboard.tsx + cashier/{UnifiedLookupTab,SyncMembersTab,ClubCardQrTab}.tsx
User role:     cashier/staffOps
Purpose:       Member lookup, CSV sync, card QR printing, verification approval
Main actions:  search; approve (RPC approve_verification — fires WITHOUT confirm; reject requires reason); sync; print
Data source:   membership_verification_requests, profiles, clubs
Current UI quality: good — URL-synced sub-tabs; honest coming-soon placeholder
Main UX risks: approve-without-confirm asymmetry; FK fallback silently swallows errors
Suggested improvement batch: P2
Class: A — gates member identity used by payouts
```

### Cashier › Reports (Doanh thu)
```txt
Screen:        Cashier › Reports
Path/Component: src/components/cashier/RevenueReportTab.tsx
User role:     cashier/owner
Purpose:       Date-ranged staking revenue report (fees, payouts, markup, early-bird) + Excel export
Main actions:  date/club filter, export
Data source:   staking_deals (limit 2000, client-side aggregation)
Current UI quality: fair — "font-mono" money columns are NOT monospace (broken mono stack); "Lợi nhuận ròng" formula unexplained on screen
Main UX risks: 2000-row cap silently truncates long ranges; misleading profit label
Suggested improvement batch: P5
Class: A — owner-facing revenue figures
```

---

## 7. Floor / TD pages

### Cashier › Dealer Swing (command center)
```txt
Screen:        Cashier › Dealer Swing
Path/Component: src/components/cashier/DealerSwingTab.tsx (4,272 lines) + TableCard*, DealerRow, DealerManagementTab, NextDealerPreview, command-center/*
User role:     cashier with dealer_control grant / super_admin
Purpose:       Live dealer rotation: check-in/out, assignment, swing execution, break pool, rotation planner, Telegram + swing config, payroll quick-export
Main actions:  assign/release/swing, batch check-in/out, breaks, mass assign, auto-swing toggle, config dialogs, Excel export
Data source:   useDealerSwing/useRotationSchedule/useDealerPayroll hooks → dealer_attendance, dealer_assignments, game_tables, dealer_rotation_schedule, swing_config, club_settings; realtime + polling; edge fns
Current UI quality: fair — operationally rich but a monolith mixing raw zinc-* palette (42 uses) with tokens; payroll export embedded in swing component
Main UX risks: ⚠ INTENT BUG — AttentionQueue per-table "swing" calls GLOBAL onAutoSwing (club-wide processing from a one-table button); Mass-assign/auto-swing-all single-click without confirm; audit log shows action codes only (no actor/table names); excluded-table list hardcoded ["11","12","13","21","A25"]; REST_MINUTES=10 hardcoded client-side
Suggested improvement batch: P4 (decompose monolith first, then visual unification)
Class: A — core production rotation workflow (protected module)
```

### DealerControlBoard (wall display)
```txt
Screen:        DealerControlBoard
Path/Component: src/pages/DealerControlBoard.tsx
User role:     dealer_control (fallback cashier clubs)
Purpose:       Full-screen rotation board: mm:ss countdowns to swing_due_at, CHỐT/DỰ ĐOÁN/THIẾU DEALER slots, dealer pool rail with rest countdowns
Main actions:  read-only monitoring; club filter; 15s poll + realtime invalidation
Data source:   RPC get_rotation_board (untyped `as any`), realtime dealer_rotation_schedule + dealer_assignments
Current UI quality: good for a wall display — strong hierarchy, huge countdowns; but raw zinc/emerald/amber palette outside tokens, and the 6xl countdown uses broken font-mono (digit jitter every second)
Main UX risks: rendered INSIDE Layout (header + bottom nav + max-w-[1400px] padding on what should be chrome-free); REST_MINUTES drift vs server policy
Suggested improvement batch: P4 (move outside Layout, fix mono, tokenize)
Class: A — live production floor display
```

### Cashier › Tournament Live / TrackerDashboard
```txt
Screen:        Tournament Live (8 panels: Live View / Clock / Table Draw / Hand Input / Hand History / Leaderboard / Blinds / Prizes)
Path/Component: src/components/cashier/TournamentLivePanel.tsx + tournament-live/*.tsx; reused WHOLE by /tracker (TrackerDashboard.tsx)
User role:     cashier with dealer_control / tracker / super_admin
Purpose:       Floor ops for live tournaments: clock control, seat draw, hand entry, chip counts, structures
Main actions:  select tournament, run/pause clock (tournament-live-clock edge fn), edit seats, input hands, manage structures
Data source:   tournaments + realtime tournament_hands/chip_counts/seats; per-panel RPCs
Current UI quality: good — needs-attention strip, status badges; local StatusBadge duplicate; 8 tabs wrap to 3 ragged rows on floor tablets
Main UX risks: clock auto-advance runs FROM THE CLIENT (any open tab with autoNextLevel can fire next_level — race across tabs); tracker role gets full mutating surface (server-side rejection invisible); refreshTrigger fan-out re-renders all panels
Suggested improvement batch: P3
Class: A — active floor workflow
```

### Seat assignment — TableDrawPanel (PR #15)
```txt
Screen:        Table Draw (seat assignment)
Path/Component: src/components/cashier/tournament-live/TableDrawPanel.tsx (610 lines)
               ⚠ src/components/tournament/seat/ does NOT exist on main — the receipt RPC flow (confirm_registration_and_assign_seat, SeatReceiptDialog, move_player_seat) lives only on a feature branch/dev DB per docs/agent-handoffs/seat-floor-ops.md
User role:     cashier/dealer_control/tracker ops
Purpose:       Seat draw editing with snapshot/dirty tracking, chip-conservation check, balance HINT only (never auto-moves)
Main actions:  assign/move/remove seats, bust player (native checkbox), undo to snapshot, bulk save, add player, create table
Data source:   tournament_seats, tournament_tables (live DB truth: tournament_seats.table_id → tournament_tables.id)
Current UI quality: good — well-documented safety logic, clear dirty-state UX; touch targets 24–28px (h-6/h-7 inputs) painful on floor tablets
Main UX risks: bulk save is last-write-wins (no concurrency token — two floors clobber each other); no seat history/receipts (acknowledged gap); 10-seat cap hardcoded
Suggested improvement batch: P6
Class: A — production floor-critical seating
```

### Hand Input / Live View (public)
```txt
Screen:        Hand Input + TournamentLiveTracker (/live/:id)
Path/Component: tournament-live/HandInputPanel.tsx (808 lines), TournamentLiveView.tsx (850 lines), src/pages/TournamentLiveTracker.tsx
User role:     tracker/cashier input; any authed user spectating
Purpose:       Street-by-street hand entry feeding the PUBLIC live view (seat map, action log, stacks)
Main actions:  record actions per street, pick cards, undo, publish
Data source:   tournament_hands, tournament_seats; realtime + 30s poll
Current UI quality: good — purpose-built rapid entry; public view has animated LIVE pill
Main UX risks: ⚠ SAME TournamentLiveView component serves ops AND public — SeatInfo carries hole_cards; careless edits could leak hidden cards to the public route (hidden-card invariant); fixed w-36 seat pods overlap below ~411px width
Suggested improvement batch: P3
Class: A (input) / B (public view)
```

### TournamentConfigPage
```txt
Screen:        Tournament Config (swing setup)
Path/Component: src/pages/TournamentConfigPage.tsx
User role:     super_admin / dealer_control / club_admin
Purpose:       CRUD tournaments with dealer-swing config (tables, swing duration) feeding the rotation engine
Main actions:  CRUD configs, attach tables, set swing params
Data source:   useTournaments + useDealerSwing.useActiveTables
Current UI quality: fair — local statusColors duplicate
Main UX risks: misconfigured swing duration silently changes floor rotation timing; reachable only by hand-built URL
Suggested improvement batch: P4
Class: A — configures production swing behavior
```

---

## 8. Owner / admin pages

### Cashier › Payroll (Bảng lương)
```txt
Screen:        Cashier › Payroll
Path/Component: src/components/cashier/DealerPayrollTab.tsx (1,199 lines)
User role:     cashier with dealer_control / super_admin
Purpose:       Monthly dealer payroll: FT/PT 19-column tables (hours, OT, BHXH/BHYT/BHTN, PIT, net), adjustments, draft→submitted→approved→locked state machine, audit log, Excel export
Main actions:  calculate (RPC calculate_dealer_payroll), adjustments, submit/approve/lock/reject, export
Data source:   useDealerPayroll → payroll RPC + save/adjustment/audit tables
Current UI quality: fair — good declarative hideBelow column system + MetricCard strip; 77 zinc-* uses; money in fake font-mono (misaligned digits)
Main UX risks: ⚠ "Gửi bởi" displays the CURRENT VIEWER's id, not the stored submitter (falsified trail); no approver name/timestamp shown; NO separation of duties in UI (same user can save→submit→approve→lock); approve/lock single-click without confirmation; adjustments still editable while approved; audit log shows uuid prefixes; delete-adjustment is a 10px trash icon
Suggested improvement batch: P5 (controlled patch mode — visual changes must not alter computed values)
Class: A — production payroll (protected module)
```

### AdminStaking console
```txt
Screen:        AdminStaking (Ops / History / Config groups)
Path/Component: src/pages/AdminStaking.tsx (2,622 lines) + admin/{CashierCounter,FeeConfigManager,FeeRevenueDashboard,TournamentRegistrationsTab}.tsx
User role:     isStaffOps (super_admin | cashier | club_cashier)
Purpose:       Full staking back office: check-in counter, pending transfers, tournament registration confirmation, result entry + payout release (request→cosign→execute), disputes, audit, banks, fees, fee revenue
Main actions:  confirm transfers, enter results, release payouts (AlertDialog confirmations), resolve disputes, configure fees, export
Data source:   staking_deals/purchases, bank accounts, fee config, staking audit, tournament_registrations; multiple edge fns incl. staking-admin-override
Current UI quality: fair — well-organized nested tabs, proper AlertDialogs; 15 fake font-mono money fields; deep-link only via ?deal=
Main UX risks: ⚠ "Cashier 1-step payout" path auto-creates AND auto-cosigns its own release request from one session — silently bypasses the two-person control unless backend rejects same-user cosign (UI gives no indication); transfer proof per payout optional; execute irreversible with no compensating-entry flow; release math computed client-side
Suggested improvement batch: P7
Class: A — highest money-movement surface in the app
```

### TournamentRegistrationsTab (embedded)
```txt
Screen:        Tournament registrations confirmation
Path/Component: src/components/admin/TournamentRegistrationsTab.tsx (embedded in AdminStaking › Ops)
User role:     isAdmin/isCashier (RLS-scoped)
Purpose:       Confirm/cancel player tournament registration payments (reference code, transfer proof, masked phone) + notify player
Main actions:  confirm (window.confirm with amount), cancel (window.prompt reason), proof lightbox
Data source:   tournament_registrations (+FK fallback), notifications insert
Current UI quality: fair — third local StatusBadge implementation; native confirm/prompt for money actions; hand-rolled lightbox
Main UX risks: money confirmation behind native confirm; card shows buy_in while prompt shows total_pay (two different amounts for one action); no idempotency on notification insert; confirm here does NOT assign a seat (receipt flow not on main)
Suggested improvement batch: P6
Class: A — confirms real payments
```

### ClubAdmin (owner console)
```txt
Screen:        ClubAdmin
Path/Component: src/pages/ClubAdmin.tsx (730 lines)
User role:     club owner (clubs.owner_id)
Purpose:       Owner self-service: club status, member sync, bank accounts, Telegram bot, dealer tours, streams, bookings, tournament CRUD, registrations, profile logs
Main actions:  CRUD tournaments/shifts, reply bookings, confirm/reject registrations, manage banks + bot
Data source:   clubs, tournaments, stack_registrations, booking_chats, profile_update_log, dealer_shifts; realtime
Current UI quality: fair — one long unstructured scroll (no tabs/anchors), native confirm() deletes, dated next to CashierDashboard
Main UX risks: bank accounts below the fold; full refetch on any realtime event; duplicated tournament dialogs vs SuperAdmin
Suggested improvement batch: P9 (owner console IA)
Class: B — owner-facing management
```

### SuperAdmin (12 tabs)
```txt
Screen:        SuperAdmin shell + tabs
Path/Component: src/pages/SuperAdmin.tsx (1,362 lines; EXPORTS BannersEditor/SeriesEditor consumed by MediaCenter)
User role:     super_admin
Purpose:       System-wide control: tournaments, series, registrations, clubs, backing, banners, P&L, livestream, rates, packages, support, profile logs
Main actions:  CRUD everything; hard-delete behind native confirm()
Data source:   clubs, tournaments, stack_registrations, profiles, profile_update_log (untyped), storage; RPC auto_soft_delete_old_tournaments
Current UI quality: poor-to-fair — 12 TabsTriggers in md:grid-cols-12 (unreadably narrow); legacy text-gold; monolithic mount-load
Main UX risks: page doubles as a component library (refactor breaks MediaCenter); hard deletes; no pagination on global lists
Suggested improvement batch: P9 (console IA); P1 for the tab-strip pattern fix
Class: A (shell, tournaments, registrations, clubs — platform control)
       B (series, P&L, packages, support) · C (banners, livestream, profiles log)
       E (Backing tab — overlap with AdminStaking unclear; Rates tab — unclear what consumes rates)
```

### AdminUsers
```txt
Screen:        AdminUsers
Path/Component: src/pages/AdminUsers.tsx
User role:     super_admin
Purpose:       Grant/revoke roles + per-club cashier/dealer-control/tracker assignments; toggle verification
Main actions:  role grant/revoke (one click + toast), club capability toggles, search
Data source:   profiles (ALL loaded eagerly), user_roles, clubs, club_cashiers/club_dealer_controls/club_trackers (untyped)
Current UI quality: fair — functional matrix, no pagination
Main UX risks: highest-privilege screen; mis-click grants super_admin with only a toast (no confirm)
Suggested improvement batch: dedicated controlled session (security-sensitive; not a styling batch)
Class: A — access-control gate for everything
```

### Owner finance surfaces (FeeRevenueDashboard, SpreadPnL)
```txt
Screen:        FeeRevenueDashboard + SpreadPnL
Path/Component: src/components/admin/FeeRevenueDashboard.tsx (/admin/staking → Config); src/components/admin/SpreadPnL.tsx (/admin P&L tab)
User role:     owner-scoped / super_admin
Purpose:       Entry+archive fee revenue per club; 30-day funded escrow volume
Main actions:  read-only
Data source:   staking fee aggregations
Current UI quality: fair — mixes gradient-card and gradient-gold cards in one file
Main UX risks: ⚠ SpreadPnL is LABELED "P&L" but shows gross escrow inflow, not profit — misleading to owner; fixed 30-day window, no club filter/export; no period-over-period anywhere
Suggested improvement batch: P5
Class: B — owner financial insight (correctness over styling)
```

### Content/admin tools (MediaCenter, BulkCreate, AdminLeaderboard, AdminMoneyList, AdminWebVitals, RangeEditor)
```txt
Screen:        MediaCenter (6 tabs)
Path/Component: src/pages/MediaCenter.tsx (+admin/MediaClubSchedules; reuses News page, InternationalEvents page, SuperAdmin exports, AdminSupportTab)
User role:     media / super_admin
Purpose:       Content console: news, banners, series, international, club schedules, support
Current UI quality: good — the scrollable TabsList pattern other consoles should copy
Main UX risks: imports editors from SuperAdmin.tsx page file (coupling)
Suggested improvement batch: P1 · Class: B

Screen:        BulkCreateTournaments
Path/Component: src/pages/BulkCreateTournaments.tsx
Purpose:       AI-parse schedule poster images → batch tournament insert
Main UX risks: AI parse errors create wrong public tournaments if review skipped
Suggested improvement batch: P1 · Class: B

Screen:        AdminLeaderboard + AdminMoneyList
Path/Component: src/pages/AdminLeaderboard.tsx (+MoneyListManager, ClubMoneyListManager), AdminMoneyList.tsx
Purpose:       Manage leaderboard/money-list entries; paste-import with fuzzy profile matching
Main UX risks: fuzzy matching can attribute winnings to the wrong player; native confirm deletes
Suggested improvement batch: P1 · Class: B / C

Screen:        AdminWebVitals
Path/Component: src/pages/AdminWebVitals.tsx
Purpose:       LCP/INP/CLS percentile dashboard
Suggested improvement batch: P1 · Class: C

Screen:        GTO Range Editor
Path/Component: src/components/RangeEditor.tsx (routed as inline JSX in App.tsx:168)
Purpose:       Edit official GTO ranges, broadcast realtime to all users
Main UX risks: saves instantly affect every user's trainer; native <select> elements
Suggested improvement batch: P1 (rewire as a page) · Class: C
```

---

## 9. Existing modal/dialog map

**Money-flow dialogs (class A care):** TournamentRegisterModal (register + payment proof, used by Tournaments/TournamentDetail) · Marketplace DealDetailDialog + TransferInstructions (escrow commit) · Refund reason dialog (CashierDashboard:923) · Release/Cosign/Execute AlertDialogs (AdminStaking) · payroll adjustment + audit dialogs (DealerPayrollTab) · result/proof upload dialogs (StakingMyDeals, StakingPortfolio).

**Ops dialogs:** swing check-in/checkout/break/batch/Telegram/swing-config dialogs (DealerSwingTab) · AddDealerDialog/DealerAdjustDialog · reject-verification reason dialog (CashierDashboard:723) · ClubQrScanDialog · NewTournamentDialog/EditTournamentDialog (DUPLICATED in SuperAdmin and ClubAdmin) · NewClubDialog · NewDealerShiftDialog.

**Content/player dialogs:** DocumentUploadDialog/DocumentViewerDialog · News/InternationalEvents/SeriesDetail inline editors · CreatePostDialog/StoryViewer/CreateStoryMultiDialog/StoryViewersDialog (Feed) · SessionFormDialog (bankroll) · InterestDialog · TosAgreementModal · PlayerHistoryDialog.

**Anti-patterns to retire:** native `window.confirm`/`prompt` for destructive/money actions (SuperAdmin:121,386 · ClubAdmin:132,222 · AdminLeaderboard:74 · TournamentRegistrationsTab:121,216) · hand-rolled fixed-overlay lightbox (TournamentRegistrationsTab:207) · hover-only tooltip via onMouseEnter (DealerSwingTab:1530 — unreachable on touch).

## 10. Existing table/grid map

| Surface | Pattern | State |
| --- | --- | --- |
| Tournaments home table | overflow-x-auto + `hidden sm:table-cell` + mobile stacked info | ✅ best-in-repo, standardize |
| Leaderboard | desktop table `hidden md:block` + mobile card list `md:hidden` | ✅ good duality |
| DealerPayrollTab | 19 columns, declarative `hideBelow` ColumnDef system | ✅ mechanism right; needs sticky name column + mobile card |
| DealerManagementTab roster | fixed `grid grid-cols-12`, no responsive prefixes | ❌ unreadable on phone |
| Refund history (CashierDashboard) | plain table, no pagination >500 | ❌ fetches refunded_by, never renders it |
| shadcn `ui/table.tsx` | wraps every table in `overflow-auto` | ✅ free horizontal scroll everywhere |
| TournamentLiveView seat map | absolute-positioned w-36 pods over 480px felt | ❌ pods collide <411px |

## 11. Existing chart/metric-card map

- recharts: Account (booking bars), BankrollManager (P/L, risk), FindBacker (sparklines), SpreadPnL (escrow area), AdminWebVitals.
- **9 duplicate stat/KPI implementations** of the same label+value+accent shape: `KpiBox` (SystemHealthCard:9), `MetricCard` (DealerPayrollTab:183), `StatCard` (BankrollManager:600), five separate `Stat` components (Account:531, CashierCounter:324, StakingMyDeals:386, StakingPortfolio:417, LiveStateBanner:45, PerformanceCard:101) + inline KPI cards (CashierDashboard:199). → one shared `<StatCard>` is Phase 1 work.

## 12. Orphaned or suspicious UI files

| File | Status | Action |
| --- | --- | --- |
| `src/components/cashier/command-center/ExceptionCenter.tsx` (199 lines) | **F — zero imports** at a56399e | delete or wire up (P1 cleanup) |
| `CashierDashboard.tsx:746-805 LookupTab` | dead code — replaced by UnifiedLookupTab | delete (P1 cleanup) |
| `src/pages/StitchSchedulePreview.tsx` | **F — NOT in origin/main**; untracked file in the main working tree only; raw hex palette | keep as design reference only; never route |
| `src/pages/BankrollManager.tsx` | page file with no route (embedded in Documents) | document; consider /documents/bankroll route later |
| `src/pages/SetupDavinci.tsx` | **E — publicly routed super-admin bootstrap** | owner decision (security) |
| `/packages/:id/register` | route does not exist; PackageDetail CTA → 404 | fix CTA in P1 |
| Two registration systems | `stack_registrations` (booking-chat flow) vs `tournament_registrations` (edge-fn flow) surfaced inconsistently across TournamentDetail/MyStacks/Account | owner decision on convergence — **E** |
| `src/components/tournament/seat/` + seat receipt RPCs | exist only on feature branch / dev DB (not on main) | P6 scope; do not assume present |

## 13. Shared components that are risky to edit

| File | Consumers | Risk |
| --- | --- | --- |
| `src/components/Layout.tsx` | every routed screen except auth/legal | global shell; also currently modified-uncommitted in the main working tree (parallel-session conflict) |
| `src/hooks/useAuth.tsx` | nearly all pages | role gating; regression silently exposes/hides admin controls |
| `src/components/cashier/TournamentLivePanel.tsx` | CashierDashboard AND TrackerDashboard | one component = two roles' entire workspace |
| `src/components/cashier/tournament-live/TournamentLiveView.tsx` | public /live AND ops tab | **hole_cards in SeatInfo — hidden-card invariant** |
| `src/components/admin/CashierCounter.tsx` | cashier check-in AND AdminStaking counter | money flow duplicated into two consoles |
| `src/pages/SuperAdmin.tsx` | exports BannersEditor/SeriesEditor → MediaCenter | page acting as component library |
| `src/components/admin/AdminSupportTab.tsx` | SuperAdmin AND MediaCenter | two consoles, one inbox |
| `src/components/cashier/DealerSwingTab.tsx` | swing tab (12+ hooks, payroll export inside) | 4,272-line protected monolith — decompose before styling |
| `src/components/StatusBadge.tsx` | SuperAdmin, ClubAdmin, MyStacks | name-collides with 2 local StatusBadge clones |
| `src/hooks/useDealerSwing.ts`, `useRotationSchedule.ts`, `useDealerPayroll.ts` | swing/board/config/payroll | protected data contracts — read-only for UI sessions |
| `src/lib/format.ts` | ~50 files | money/date formatting blast radius |
| `src/lib/tournamentLive.ts` | display AND StakingNew deadline math | time math errors change deal deadlines |
| `src/components/FomoPrice.tsx` | 6 player+admin screens | single source of displayed pricing |
| `src/components/ui/card.tsx` + `tailwind.config.ts` + `src/index.css` | everything | token system itself |

## 14. Active parallel-session files that must be avoided

- **Payroll sessions (PR #13 draft, PR #14 draft):** `DealerPayrollTab.tsx`, `useDealerPayroll.ts`, payroll migrations/RPCs — do not touch from UI batches until merged.
- **Seat/floor session (PR #15 — now merged, follow-ups likely):** `TableDrawPanel.tsx`, `PrizeStructurePanel.tsx`, `docs/agent-handoffs/seat-floor-ops.md`.
- **Main working tree (D:\Quy trình)** has uncommitted changes to `Layout.tsx` and `public/version.json` — any session touching Layout must coordinate first.
- **Worktrees active:** `D:\VinPoker-cashier-registrations` (feat/cashier-tournament-registrations), `D:\VinPoker-floor-ops`, `D:\VinPoker_dealer_swing_rescue`.
- Never edit: `supabase/migrations/**`, Edge Functions, `public/version.json` from UI sessions.

## 15. Recommended screen ownership by future sessions

| Session | Owns (screens) | Must not touch |
| --- | --- | --- |
| **Design-system session (P1)** | tokens (`index.css`, `tailwind.config.ts`), new shared primitives (`StatusPill`, `StatCard`, `PageLoader`, `EmptyState`, `ErrorState`), gold→primary codemod, font-mono fix, NotFound, PackageDetail CTA | any business logic; DealerSwingTab internals; payroll values |
| **Cashier IA session (P2)** | CashierDashboard shell/overview/members, ChatInbox, BookingChat, MyStacks | swing/payroll tab internals, edge functions |
| **Tracker session (P3)** | TournamentLivePanel + tournament-live panels (except TableDraw), TournamentLiveTracker, TrackerDashboard | TableDrawPanel (P6 owns), clock edge fn logic without backend plan |
| **Dealer ops session (P4)** | DealerSwingTab decomposition, DealerControlBoard, TournamentConfigPage, DealerManagementTab | payroll computation, rotation RPCs |
| **Payroll/finance session (P5)** | DealerPayrollTab (controlled patch), RevenueReportTab, SpreadPnL, FeeRevenueDashboard | payroll RPC/migrations without explicit scope |
| **Seat/floor session (P6)** | TableDrawPanel, TournamentRegistrationsTab, payout-input (new), seat receipt flow | Dealer Swing close-table lifecycle |
| **Staking session (P7)** | Marketplace, StakingNew/MyDeals/Portfolio, FindBacker, PlayerProfile, AdminStaking, cashier StakingPanel | settlement edge fns without explicit scope |
| **Game engine session (P8)** | future PokerTable3D, engine contract UI | everything operational |
| **Owner command center session (P9)** | new owner dashboard, ClubAdmin IA, SuperAdmin IA, Account club-scope extraction | money calculations |
| **Content/media (fold into P1 or own mini-batch)** | News, NewsDetail, InternationalEvents, SeriesDetail, MediaCenter, banners, AdminLeaderboard, AdminMoneyList | — |
| **Dedicated security session (owner-scheduled)** | AdminUsers, SetupDavinci removal/gating, Unsubscribe token | do not bundle with styling |
