# VinPoker — UI/UX Implementation Roadmap (Phase 0 output)

> Phased plan for UI improvement after Session 6's audit. Each phase = one or more small PRs by a
> single implementer session, per the Parallel Session Protocol. Multi-agent investigation/review
> is encouraged; multi-agent *editing* is not.
>
> Cross-references: `uiux-master-map.md` (rules), `uiux-screen-inventory.md` (per-screen classes).
> Phase numbers are the canonical "suggested batch" values used in the inventory.
>
> **Sequencing note:** Phase 1 must not start until the currently open payroll PRs
> ([#13](https://github.com/PhamGiaVinh/-vinpoker-/pull/13), [#14](https://github.com/PhamGiaVinh/-vinpoker-/pull/14))
> are stabilized/merged, to avoid conflicts on shared files. PR #15 (seat/floor) is already merged.

---

## Phase 0 — Audit only (THIS SESSION) ✅

```txt
Goal:           Master map, screen inventory, roadmap. No code changes.
Allowed files:  docs/design/*, docs/agent-handoffs/uiux-master-map.md
Forbidden files: everything else
Risk level:     none (docs-only)
Build/test requirements: none (no app code touched)
Manual UAT:     owner reads the three docs; confirms classifications marked E
Rollback notes: delete the docs branch
```

## Phase 1 — Design system cleanup (shared primitives)

```txt
Goal:           Fix token defects and build the shared-primitive layer every later phase consumes.
                Work items, in order:
                1. fontFamily.mono → real monospace stack (one line, tailwind.config.ts; verify
                   countdowns/payroll/reports visually — 207 usages light up)
                2. gold→primary codemod (120 uses/37 files), delete alias block, decide the one
                   remaining literal-gold swing shimmer (index.css:304)
                3. New primitives in src/components/shared/: StatusPill (domain variant maps),
                   StatCard, PageLoader, EmptyState, ErrorState (model: TrackerDashboard retry)
                4. Migrate the 3 colliding StatusBadge impls + 9 stat-card clones + 25 Loader blocks
                5. Re-express index.css badge classes via tokens; kill second green #10B981
                6. Tab-strip pattern: adopt MediaCenter scrollable TabsList in SuperAdmin +
                   TournamentLivePanel + CashierDashboard staking sub-tabs
                7. Layout bottom-nav fix: 5 primary slots + More; pad main from real nav height
                8. Small bug burns: PackageDetail 404 CTA, NotFound rebrand, hero py-6 md:py-16 on
                   Leaderboard/Marketplace, delete dead LookupTab + ExceptionCenter
Allowed files:  tailwind.config.ts, src/index.css, src/components/shared/* (new),
                src/components/ui/* (only if a primitive needs a variant), Layout.tsx (item 7 only,
                coordinated), the specific consumer files being migrated, NotFound.tsx,
                PackageDetail.tsx, dead-code deletions
Forbidden files: DealerSwingTab internals beyond class renames, payroll computation, all
                supabase/**, edge functions, any logic change
Risk level:     medium — shared files have app-wide blast radius; pure-visual intent
Build/test:     npm run build + npx tsc --noEmit per PR; screenshot pass on /cashier, /dealer-board,
                /, /leaderboard at 360px/768px/1440px
Manual UAT:     cashier confirms payroll/report digits aligned; owner spot-checks 5 player pages
Rollback notes: each work item = separate commit; revert per-commit; codemod is mechanical and
                revertible; keep gold aliases one release if needed (deprecation warning comment)
```

## Phase 2 — Cashier dashboard information architecture

```txt
Goal:           Navigation/section clarity in /cashier WITHOUT changing business logic:
                distinct icons per section (Swing vs Tournament Live), scrollable mobile pill bar,
                URL-synced staking sub-tabs, KPI cards gain VND sums + deep-links to exact sub-tab,
                ticking countdowns, actor columns surfaced where data already exists
                (refunded_by!), realtime subscribe on pending/result lists, booking pipeline
                clarity (ChatInbox/MyStacks/BookingChat presentation only).
Allowed files:  CashierDashboard.tsx (presentation), cashier/* presentation-only files,
                ChatInbox.tsx, MyStacks.tsx, BookingChat.tsx (UI only)
Forbidden files: edge functions (admin-confirm-funded etc.), DealerSwingTab, DealerPayrollTab,
                supabase/**, any status-transition logic, BookingChat current_players write path
                (bug documented — fix needs its own controlled backend patch)
Risk level:     medium — operator workflows; presentation-only discipline required
Build/test:     build + typecheck; manual flows: confirm FUNDED, refund, member verify on staging
Manual UAT:     one real cashier shift on staging; check ?tab deep links from old bookmarks
Rollback notes: presentation commits only → straight revert; keep old sub-tab defaults if
                URL-sync regresses
```

## Phase 3 — Tracker / Tournament Live UX (builds on PR #12)

```txt
Goal:           Overview hierarchy, table-state clarity, realtime status honesty, multi-table
                display, mobile floor use. Items: explicit table-picker empty state; staleness
                indicators everywhere (PR #12 pattern); seat-pod responsive sizing (<411px);
                read-only projection for tracker role (hide mutating tabs when role can't use
                them); clock event log DISPLAY (start/pause/skip + actor) where backend provides;
                8-tab strip → scrollable.
Allowed files:  TournamentLivePanel.tsx, tournament-live/{TournamentLiveView,ClockPanel,
                HandHistoryPanel,LeaderboardPanel,BlindStructurePanel}.tsx, TournamentLiveTracker.tsx,
                TrackerDashboard.tsx
Forbidden files: TableDrawPanel.tsx (P6 owns), PrizeStructurePanel money semantics,
                tournament-live-clock edge fn (client-driven auto-advance fix is a BACKEND item —
                document, don't hack client-side), supabase/**
Risk level:     medium-high — shared component serves cashier + tracker + public simultaneously;
                hidden-card invariant lives here
Build/test:     build + typecheck; verify public /live/:id renders identically pre/post for a
                finished tournament fixture; grep-proof no new hole_cards consumer on public path
Manual UAT:     tracker runs one live tournament on staging; phone + tablet pass
Rollback notes: TournamentLiveView changes are the risky surface — isolate in own commit;
                revert restores both ops and public views at once
```

## Phase 4 — Dealer Swing UX (production-safe)

```txt
Goal:           Timer clarity, rest-guard visibility, action confidence, audit/history visibility.
                Items: FIX AttentionQueue per-table swing → per-table action (intent bug);
                confirm-with-blast-radius on mass assign / auto-swing-all; audit log renders actor +
                dealer/table names; DealerSwingTab decomposition into panels (no behavior change);
                zinc→token migration for swing surfaces; /dealer-board out of Layout (chrome-free)
                + tabular-nums countdown; DealerManagementTab mobile collapse; move excluded-table
                list + REST_MINUTES toward config (UI reads config; adding the config column is a
                separate controlled backend patch if needed).
Allowed files:  DealerSwingTab.tsx (decomposition), cashier/{TableCard*,DealerRow,
                DealerManagementTab,NextDealerPreview}.tsx, command-center/*,
                DealerControlBoard.tsx, App.tsx (route group move only), TournamentConfigPage.tsx
Forbidden files: useDealerSwing/useRotationSchedule hooks' data contracts, rotation RPCs/edge fns,
                supabase/**, payroll anything
Risk level:     high — protected production module; one patch at a time, verify after each
Build/test:     build + typecheck per patch; staging swing cycle (assign → swing → break → return)
                after every patch; compare rotation timeline before/after
Manual UAT:     dealer manager runs a real evening on staging board; wall-display check at distance
Rollback notes: decomposition commits must be pure moves (git show --stat proves no logic diff);
                each behavioral fix (AttentionQueue) is its own one-commit patch with revert note
```

## Phase 5 — Payroll / Owner Finance UX (builds on PR #13)

```txt
Goal:           Owner liability summary, truthful approval trail, payment lifecycle clarity.
                Items: render REAL submitted_by/approved_by + timestamps (stop showing viewer id);
                resolve audit-log names; approve/lock confirmation dialogs restating totals;
                lock adjustments post-submit (UI gate; backend enforcement separately);
                sticky name column + mobile card for payroll table; RevenueReportTab explains
                formulas + prior-period delta; SpreadPnL renamed/recomputed honestly; risk strip.
Allowed files:  DealerPayrollTab.tsx (presentation + trail display), RevenueReportTab.tsx,
                SpreadPnL.tsx, FeeRevenueDashboard.tsx
Forbidden files: calculate_dealer_payroll RPC and all payroll computation, useDealerPayroll write
                paths, supabase/** (PR #13/#14 own those), displayed VALUES of any computed pay
Risk level:     high — financial surfaces; controlled patch mode; coordinate with PR #13/#14 owners
Build/test:     build + typecheck; golden-master check: same period renders identical numbers
                pre/post patch (screenshot or DOM-text diff)
Manual UAT:     owner reviews one month-end close on staging; verify trail names correct
Rollback notes: never bundle with other phases; one revert returns prior payroll UI; numbers
                provably unchanged via golden-master artifact kept in PR
```

## Phase 6 — Seat Assignment / Floor Ops UX (builds on Session 4 / PR #15)

```txt
Goal:           Complete the floor-ops loop. Items in priority order (from audit):
                1. tournament_payouts input/approve/mark-paid UI — THE missing money record
                   (needs its backend; UI designs against handoff §9)
                2. ship/move-player dialog over existing move_player_seat RPC when it lands on main
                3. registration confirm → seat → receipt flow (feature branch → main) or clearly
                   label current tab "payment confirm only"
                4. TableDrawPanel: touch targets (h-9+, shadcn Switch for bust), grid-cols-1 <400px,
                   concurrency token on bulk save (UI sends updated_at; backend check separate)
                5. tournament-table close with destination plan (never reuse cash-table close)
                6. consistent total_pay display in TournamentRegistrationsTab + AlertDialog replace
                   confirm()/prompt()
Allowed files:  TableDrawPanel.tsx, TournamentRegistrationsTab.tsx, new seat/payout UI components,
                PrizeStructurePanel.tsx (disclaimer/labels only)
Forbidden files: Dealer Swing close-table lifecycle, rotation logic, supabase/** (each backend
                item is its own controlled patch with rollback SQL)
Risk level:     high — live floor + money records
Build/test:     build + typecheck; staging: full seat → move → bust → save cycle; two-operator
                concurrent-save test
Manual UAT:     TD runs one tournament day on staging incl. payout entry
Rollback notes: UI-only commits revert clean; payout backend ships with explicit rollback SQL in
                its own migration PR
```

## Phase 7 — Staking / Investor UX

```txt
Goal:           Trustworthy money lifecycle across the four staking surfaces. Items:
                FUNDED confirm dialog (amount + reference + proof gate); deal timeline drawer
                (status history + actors) reachable from cashier rows; cosign integrity — remove or
                explicitly gate the auto-cosign 1-step path pending backend verification (P0 if
                backend doesn't reject same-user cosign — escalate to owner); require proof or
                explicit "cash, no reason" per payout before execute; expired-deal closing moved
                off Marketplace page-load (backend job; UI removes side-effect call);
                Marketplace card palette → tokens; portfolio duplication (FindBacker vs
                StakingPortfolio) consolidated; "Report scam" gets a real path or is removed.
Allowed files:  Marketplace.tsx, StakingNew.tsx, StakingMyDeals.tsx, StakingPortfolio.tsx,
                FindBacker.tsx, PlayerProfile.tsx, AdminStaking.tsx (presentation + dialog gates),
                CashierDashboard StakingPanel (with P2 coordination)
Forbidden files: staking edge functions and settlement logic, fee computation, supabase/**
Risk level:     high — real-money escrow flows
Build/test:     build + typecheck; staging: full deal lifecycle create→commit→fund→checkin→result→
                release with 2 distinct admin users
Manual UAT:     owner + cashier walk a real deal on staging; verify cosign requires second user
Rollback notes: dialog-gate commits are additive (can revert to old single-click while keeping
                styling); auto-cosign removal is one isolated commit
```

## Phase 8 — Game Engine / Poker Table Visual (Track B/C)

```txt
Goal:           Integrate PokerTable3D / online-table UI only after the engine state model and
                shared contract (PublicTableState/PrivatePlayerState) are stable. UI consumes
                contract views; red-felt styling allowed inside table components only.
Allowed files:  new engine-client UI components, lobby/table screens (new), mock-state fixtures
Forbidden files: all operational modules; no client-side game authority ever
Risk level:     medium (greenfield) but gated on engine maturity
Build/test:     engine contract tests pass; mock-driven UI storybook/screenshots
Manual UAT:     internal play-test table with mock engine
Rollback notes: greenfield — feature-flag the lobby entry point
```

## Phase 9 — Owner Command Center

```txt
Goal:           Single owner view: cash required, payroll liability, tournament payouts, staking
                exposure, dealer cost, active games, operational warnings (risk strip), with
                period-over-period deltas; consolidates Account club-scope stats, RevenueReportTab,
                FeeRevenueDashboard, SpreadPnL fragments; ClubAdmin/SuperAdmin console IA cleanup
                rides along here. AI recommendations later.
Allowed files:  new owner dashboard page/components, Account.tsx (extract club stats),
                ClubAdmin.tsx + SuperAdmin.tsx (IA restructure, presentation)
Forbidden files: any money computation — dashboard reads existing queries/RPCs; new aggregates are
                separate backend patches
Risk level:     medium — read-only surface but owner decisions depend on its truthfulness
Build/test:     build + typecheck; numbers cross-checked against source screens for one period
Manual UAT:     owner uses it for one real week alongside old screens before any old screen retires
Rollback notes: additive route — feature-flag; old surfaces stay until owner signs off
```

---

## Standing items outside the phase ladder

- **Dedicated security session (owner-scheduled, not a styling batch):** AdminUsers confirm-on-grant + pagination; `/setup-davinci` removal/gating decision (class E); Unsubscribe token-gating (backend).
- **Owner decisions needed (class E):** stack_registrations vs tournament_registrations convergence; SuperAdmin Backing tab vs AdminStaking overlap; Rates tab consumers; SetupDavinci.
- **Backend bugs documented by this audit (not UI work, route to controlled patches):** BookingChat client-side current_players race; client-driven clock auto-advance; NewsDetail client UPDATE view_count; same-user cosign enforcement; expired-deal closing job.
