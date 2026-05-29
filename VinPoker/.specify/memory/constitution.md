# VinPoker Constitution

## Core Principles

### I. Spec-Driven Development (NON-NEGOTIABLE)
All features follow the SDD cycle: constitution → specify → clarify → plan → tasks → implement. No implementation without an approved spec and plan. Exceptions only for critical bug fixes (hotfix protocol: fix → spec after).

### II. No-Release Invariant
Never release an old dealer without a confirmed replacement. Swing logic must always find a replacement before releasing the current dealer. If no replacement is found, push `swing_due_at` by 90s (max 3 retries), then mark `swing_skipped` and send Telegram alert.

### III. Database-First
All business logic constraints are enforced at the database level (CHECK constraints, NOT NULL, triggers) before application-level validation. Edge functions use RPC calls for complex operations, never raw table access for writes.

### IV. Human-Readable Telegram Notifications
Pre-assign format: single message at T-6 with outgoing and incoming dealer names, 24-hour time. Battle map shows upcoming dealer name inline next to timer. Error/skip alerts are concise and include actionable information.

### V. Supabase Patterns
- Edge Functions: TypeScript, Deno runtime, one concern per function
- Queries: PostgREST with proper FK disambiguation (`!attendance_id`), never `.eq("related_table.column")` cross-relation filters
- Realtime: `useRealtimeQuery` wrapper with try/catch, loading state, and error state
- Migrations: Sequential SQL files in `supabase/migrations/`

### VI. Testing & Verification
Test any edge function before deployment. Verify frontend builds with `npm run build`. Run `npm run lint` for code quality. Use `supabase functions serve` for local testing.

### VII. Multi-Language Support (i18n)
- 6 locales: `vi`, `en`, `zh-CN`, `ko`, `ja`, `th`
- Fallback: Vietnamese (vi)
- Convention: user-facing strings translated naturally; admin keys (`admin.*`) stay English
- All 6 locale files updated simultaneously

### VIII. Frontend Patterns
- React 18 + TypeScript, Vite, Tailwind CSS + shadcn/ui
- React Query for server state, React Router v6 for routing
- Error boundaries at feature level, error banners for user-facing feedback
- Dark theme (#0A0A0A), emerald accent (#10B981)

### IX. Dealer Swing Logic
- Minimum swing duration: 30 minutes
- Intra-cycle exclusion across all 3 passes
- Fatigue penalty: `-Math.floor(workedMin / 10) * 5` (max -60 at 120 min)
- Break need evaluated via ratio-based balance comparison against club average
- `returnTopN` uses separate `pickTopDealers()` function
- Dealer club filter: fetch dealer IDs → filter by `.in("dealer_id", ...)` two-step
- Club processing locks table (not advisory locks) for distributed locking
- Timezone via `AT TIME ZONE` in PostgreSQL

### X. Review-After-Fix (NON-NEGOTIABLE)
Mọi thay đổi code — tính năng mới, fix bug, refactor — đều phải qua **reviewer** trước khi deploy. Quy trình:
- Feature mới: researcher → planner → implementer → reviewer
- Fix bug / sửa lỗi: implementer → reviewer
- Deploy: reviewer phải approve trước
- Nếu reviewer reject → quay lại implementer sửa → reviewer lại (vòng lặp đến khi pass)

### XI. Deployment
- Frontend: Vercel (`npm run build` to verify)
- Database: Supabase migrations (`supabase/migrations/`)
- Edge Functions: `supabase functions deploy` with proper version tags

## Governance
- Constitution supersedes all other practices
- SDD workflow must be followed for new features (constitution → specify → plan → tasks → implement)
- Hotfix protocol only for production bugs: fix first, then document with spec
- All specs, plans, and tasks reviewed before implementation begins
- Amendments to constitution require documentation and approval

**Version**: 1.0.0 | **Ratified**: 2026-05-27 | **Last Amended**: 2026-05-27
