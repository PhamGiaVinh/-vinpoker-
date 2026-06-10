# Project Memory — VinPoker Platform

**Last Updated:** 2026-06-11  
**Status:** Phase 1 Complete (Loveable Import)  

---

## Project Overview

**VinPoker** is a poker platform built on React + Vite + TypeScript, with Supabase backend and Vercel deployment.

**Architecture:** UI-driven (React) + Real-time DB (Supabase) + Functions (Edge Functions)

**Current Repo:** https://github.com/PhamGiaVinh/-vinpoker-.git

---

## Core Systems

### 1. Swing Dealer System (Production-Critical)
**Location:** `src/components/cashier/Dealer*.tsx` + `supabase/functions/assign-dealer/*`

**What it does:**
- Assigns dealers to tables in real-time
- Manages shift breaks (meal breaks, rest periods)
- Tracks dealer payroll (hours, rates, payments)
- Pre-assigns dealers to upcoming shifts
- Sends Telegram notifications to dealers

**Key Components:**
- `DealerSwingTab.tsx` — Assign/checkout dealer
- `DealerPayrollTab.tsx` — Payroll approval
- `DealerManagementTab.tsx` — Roster management
- `DealerBreaks.tsx` — Break management

**Key Edge Functions:**
- `assign-dealer` — Dealer to table assignment
- `perform_swing` — Execute swing (main RPC)
- `manage-break` — Break request handling
- `process-swing` — Swing completion pipeline

**Key Database:**
- `dealer_assignments` — Who's assigned where
- `dealer_swings` — Swing state machine
- `dealer_payroll` — Payment records
- `dealer_breaks` — Break tracking
- `dealer_attendance` — Work time log

**CRITICAL:** Never overwrite, modify, or remove Swing Dealer files without explicit approval.

---

### 2. Tournament System
**Location:** `src/components/cashier/tournament-live/` + `supabase/functions/tournament-*`

**What it does:**
- Live tournament tracking (blinds, stacks, eliminations)
- Hand history recording
- Leaderboard management
- Real-time clock and blind progression

**Key Components:**
- `TournamentLiveView.tsx` — Main tournament page
- `ClockPanel.tsx` — Blind timer
- `LeaderboardPanel.tsx` — Player standings
- `TableDrawPanel.tsx` — Table assignments

**Key Database:**
- `tournament_live_games` — Live game state
- `tournament_hands` — Hand records
- `tournament_eliminations` — Busted players
- `tournament_chip_counts` — Stack tracking

---

### 3. Chat & Messaging
**Location:** `src/components/chat/` + `src/pages/ChatInbox.tsx`, `DirectChat.tsx`, `GroupChat.tsx`

**What it does:**
- Direct messaging between players
- Group chats for tournaments/clubs
- Real-time message delivery

**Database:**
- `chat_messages` — Message content
- `direct_messages` — DM tracking
- `chat_groups` — Group metadata
- `chat_group_messages` — Group messages

---

## Recently Imported (Phase 1)

**Date:** 2026-06-11  
**Status:** ✅ Merged to main & pushed

**13 files added:**

| Module | Files | Purpose |
|--------|-------|---------|
| Feed System | 6 | Social feed, stories, music |
| Utility Components | 3 | QR scanning, logo button, QR sheet |
| Pages | 2 | Notification settings, email unsubscribe |
| Dependency | 1 | CardSlot (card display utility) |
| App Routes | 1 | Updated routing |

**Routes Added:**
- `/feed` — Social feed
- `/notification-settings` — User notification preferences
- `/unsubscribe` — Email unsubscribe handler

**Build Status:** ✅ PASSED (no errors)

**Key Property:** Zero Swing Dealer/Tournament modifications. Fully isolated feature.

---

## Supabase Structure

### Production Tables (Critical)
```
profiles                — User accounts
clubs                   — Venue data
players                 — Club members
tournaments             — Tournament records

dealer_assignments      — Active dealer assignments (Swing Dealer)
dealer_swings           — Swing state machine (Swing Dealer)
dealer_payroll          — Payment records (Swing Dealer)
dealer_breaks           — Break tracking (Swing Dealer)
dealer_attendance       — Work time log (Swing Dealer)

tournament_hands        — Hand records
tournament_live_games   — Live game state
tournament_eliminations — Busted players

cash_games             — Cash game sessions
staking_deals          — Backing agreements
```

### Loveable-Imported Tables
```
feed_posts             — Social posts
feed_stories           — Story content
feed_post_likes        — Post engagement
feed_story_views       — Story views
```

### Edge Functions (55+ total)
**Critical (Swing Dealer):**
- assign-dealer, checkout-dealer, process-swing, manage-break, perform_swing, execute_pre_assigned_swing

**Tournament:**
- tournament-live-update, tournament-live-clock, tournament-live-draw, tournament-live-leaderboard

**Notifications:**
- telegram-swing-notifier, send-push-notification, send-email

**Shared:**
- health, get-public-profile, sync-club-members, approve-reject-verification

---

## Loveable Integration Roadmap

### ✅ Phase 1 (COMPLETE — 2026-06-11)
- Feed system (6 components)
- Utility components (LogoFanButton, MyQrSheet, ScanQrDialog)
- Pages (NotificationSettings, Unsubscribe)
- **Build:** ✅ Passed
- **Conflicts:** 0
- **Risk:** 🟢 LOW

### 📋 Phase 2A (Ready — deferred 1-2 weeks)
**Start after:** Phase 1 production stabilization (1+ weeks)

- Chat components (4 files, ~400 LOC)
- Messenger page (1 file, ~200 LOC)
- **Estimated effort:** 1.5 hours
- **Conflicts:** 0
- **Risk:** 🟢 LOW
- **Action:** Implement after Phase 1 stable

### 📋 Phase 2B (Planning needed — deferred 4-6 weeks)
**Start after:** Phase 1 fully stable + architectural decision

- Tracker system (17 files, ~1,100 LOC)
  - **Conflict:** production TrackerDashboard exists
  - **Action:** Merge vs replace decision needed
  
- Replay system (15 files, ~950 LOC)
  - **Conflict:** Hand tracking schema differs
  - **Action:** Schema merge or adapter required

- **Estimated effort:** 12-16 hours
- **Conflicts:** 2 (tracker, replay)
- **Risk:** 🟡 MEDIUM-HIGH

---

## Production Protection Rules

**SACRED (Never Touch):**
```
src/components/cashier/Dealer*.tsx         ← Dealer management
src/components/cashier/DealerSwingTab.tsx  ← Swing assignment
supabase/functions/assign-dealer/          ← Dealer assignment
supabase/functions/perform_swing           ← Swing execution
supabase/migrations/20260530000003+       ← Dealer schema
src/integrations/supabase/types.ts         ← DB types (7,271 lines)
```

**HANDS-OFF (Production system):**
```
TournamentLiveTracker.tsx and related
All tournament-live-* functions
All dealer_* tables
All payroll logic
```

**VERSIONING:**
- Production DB schema: 147+ migrations (v6.11.0+)
- Production types: 7,271-line types.ts
- Edge Functions: 55+ deployed functions

---

## Known Risks

| Risk | Mitigation | Status |
|------|-----------|--------|
| CardSlot dependency | Audited, isolated utility | ✅ Verified |
| Supabase RLS for feed | Policies in base migrations | ✅ Verified |
| Bundle size growth | Lazy-loaded routes | ✅ 42KB → 11.78KB gzipped |
| Tournament conflicts | No code touched | ✅ Clean |
| Dealer conflicts | No code touched | ✅ Clean |

---

## Current Git State

**Branch:** main  
**Latest commit:** 4a2c290 (phase1-loveable-import-complete)  
**Remote:** main (in sync)  

**Key branches:**
- `main` — Production (Phase 1 merged)
- `loveable-phase1` — Preserved for rollback reference

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript + Vite |
| UI | shadcn/ui + Radix UI + Tailwind CSS |
| State | React Query + React Router |
| Backend | Supabase (PostgreSQL) |
| Functions | Edge Functions (Deno) |
| Deployment | Vercel (VinPoker folder) |
| Notifications | Telegram, Push (OneSignal) |
| Payments | Via Supabase RPCs |

---

## Next Phase Roadmap (6 months)

### Immediate (Week 1-2)
- ✅ Phase 1 production stabilization
- Test all 3 new routes (feed, settings, unsubscribe)
- Monitor production error logs

### Short-term (Month 1-2)
- [ ] Phase 2A: Chat + Messenger import
- [ ] Performance optimization (bundle splitting)
- [ ] User feedback on feed system

### Medium-term (Month 2-3)
- [ ] Betting Engine (core poker feature)
- [ ] Game Engine (hand simulation, results)
- [ ] Phase 2B: Tracker + Replay (with schema work)

### Long-term (Month 3-6)
- [ ] GTO Engine (game theory tools)
- [ ] Advanced analytics
- [ ] ML-based recommendations

---

## For Tomorrow's Claude Session

If you're reading this tomorrow:

1. **What was done:** Phase 1 Loveable import (13 files, 0 conflicts)
2. **Status:** Merged to main, committed, pushed to GitHub
3. **Build:** ✅ Passing (27.76s)
4. **What to do next:** Test the 3 new routes, then production deploy
5. **What NOT to touch:** Anything in Swing Dealer system
6. **Phase 2:** Hold for 1+ week, then Phase 2A is ready
7. **File guide:** See PHASE1_IMPORT_REPORT.md, PHASE1_DEPENDENCY_AUDIT.md, MERGE_RECOMMENDATION.md

---

## Session History

**2026-06-10**
- Created 5 integration analysis reports (CODEBASE_COMPARISON, DATABASE_REVIEW, INTEGRATION_RISK_REPORT, MERGE_STRATEGY, EXECUTION_PLAN_FOR_FOUNDER)
- Identified safe vs unsafe imports
- Verified secrets (found 1 Telegram token leak)

**2026-06-11**
- Executed Phase 1 import (3 modules)
- All builds passed (3 times)
- Dependency audit passed (0 conflicts)
- Merged to main ✅
- Created PHASE_2_REVIEW.md

---

## Contact Points

**GitHub:** https://github.com/PhamGiaVinh/-vinpoker-.git  
**Supabase Project:** orlesggcjamwuknxwcpk  
**Vercel:** VinPoker folder (production app)  

---

**Remember:** This project handles real poker operations and payments. Quality and stability are non-negotiable.
