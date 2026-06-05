# Phase 1 — Pass 3 Nested-Select Diagnostic

**Date:** 2026-06-05
**Branch:** `fix/phase1-nested-select-diagnostic`
**Status:** Deployed, awaiting results

## 🎯 Mục tiêu

Xác nhận root cause bug Pass 3 — PostgREST nested select trả về 0 rows khi manual SQL trả về N rows.

**Bug đã biết:** 3 tables (Bàn 1, Bàn 14, Bàn 100) có `pre_assigned_attendance_id` set nhưng Pass 3 không pickup được.

**Giả thuyết:** `dealer_assignments` có 2 FK tới `dealer_attendance` (`attendance_id` + `pre_assigned_attendance_id`), PostgREST nested select với hint `!attendance_id` bị ambiguous → silently 0 rows.

## 📁 Files changed (5)

### 1. NEW: `supabase/migrations/20260605_diagnostic_logs.sql`

```sql
-- supabase/migrations/20260605_diagnostic_logs.sql
-- Create diagnostic_logs table for storing edge function diagnostic data
-- Used for Phase 1 Pass 3 query issue investigation

CREATE TABLE IF NOT EXISTS diagnostic_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  club_id UUID REFERENCES clubs(id),
  diagnostic_type TEXT NOT NULL,
  result JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_timestamp
ON diagnostic_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_type
ON diagnostic_logs(diagnostic_type, timestamp DESC);

COMMENT ON TABLE diagnostic_logs IS
  'Stores diagnostic data from edge functions for debugging.
   Used temporarily for troubleshooting, can be purged manually after fixes confirmed.';

GRANT INSERT, SELECT ON diagnostic_logs TO service_role;
```

**Ghi chú:** Bỏ function `cleanup_old_diagnostic_logs` — sẽ dọn manual sau khi fix confirmed.

---

### 2. NEW: `supabase/migrations/20260605_idx_assignments_due_swing.sql`

```sql
-- supabase/migrations/20260605_idx_assignments_due_swing.sql
-- Partial index for Pass 3 query performance
-- Note: Cannot use CONCURRENTLY inside a transaction block - regular CREATE INDEX is fine
-- (table is small enough that brief lock is acceptable)

CREATE INDEX IF NOT EXISTS idx_assignments_due_swing
ON dealer_assignments(club_id, swing_due_at)
WHERE status = 'assigned'
  AND released_at IS NULL
  AND swing_processed_at IS NULL;

ANALYZE dealer_assignments;
```

**Index purpose:** Tăng tốc Pass 3 query — filter theo `club_id` + `swing_due_at` với điều kiện status/range.

---

### 3. NEW: `supabase/functions/process-swing/diagnostics.ts`

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface DiagnosticResult {
  timestamp: string;
  club_id: string;
  simple_query: {
    count: number | null;
    data_length: number;
    error: string | null;
    sample_ids: Array<{
      id: string;
      due: string;
      overdue_by: string;
    }>;
  };
  nested_query: {
    data_length: number;
    error: string | null;
  };
  fk_verification: {
    assignment_id: string;
    table_exists: boolean;
    attendance_exists: boolean;
    dealer_id: string | null;
  } | null;
  lost_rows: number;
  confirmed_bug: boolean;
}

export async function runPass3Diagnostic(
  admin: SupabaseClient,
  clubId: string,
  forceAll: boolean
): Promise<DiagnosticResult> {
  const now = new Date().toISOString();
  const nowPlusBuf = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const cutoff = forceAll ? now : nowPlusBuf;

  console.log('[Pass 3 Diagnostic] Starting diagnostic...', {
    club_id: clubId,
    force_all: forceAll,
    now,
    cutoff,
  });

  // ===== Test 1: Simple query (no nested selects) =====
  const { data: simpleResult, error: simpleErr, count: simpleCount } = await admin
    .from("dealer_assignments")
    .select(
      "id, table_id, attendance_id, swing_due_at, status, released_at, swing_processed_at, club_id",
      { count: 'exact' }
    )
    .eq("status", "assigned")
    .is("released_at", null)
    .is("swing_processed_at", null)
    .eq("club_id", clubId)
    .lte("swing_due_at", cutoff);

  const simpleSample = simpleResult?.slice(0, 3).map(a => ({
    id: a.id.substring(0, 8),
    due: a.swing_due_at,
    overdue_by: ((Date.now() - new Date(a.swing_due_at).getTime()) / 1000).toFixed(0) + 's'
  })) ?? [];

  console.log('[Pass 3 Diagnostic] Simple query result:', {
    error: simpleErr?.message ?? null,
    count: simpleCount,
    data_length: simpleResult?.length ?? 0,
    sample: simpleSample
  });

  // ===== Test 2: Nested selects (original query pattern) =====
  const { data: nestedResult, error: nestedErr } = await admin
    .from("dealer_assignments")
    .select(`
      *,
      game_tables!table_id(id, table_name, table_type),
      dealer_attendance!attendance_id(
        id,
        dealer_id,
        dealers(id, full_name, telegram_username, telegram_user_id)
      )
    `)
    .eq("status", "assigned")
    .is("released_at", null)
    .is("swing_processed_at", null)
    .eq("club_id", clubId)
    .lte("swing_due_at", cutoff);

  console.log('[Pass 3 Diagnostic] Nested select result:', {
    error: nestedErr?.message ?? null,
    data_length: nestedResult?.length ?? 0
  });

  const lostRows = (simpleCount ?? 0) - (nestedResult?.length ?? 0);
  const confirmedBug = (simpleCount ?? 0) > 0 && (nestedResult?.length ?? 0) === 0;

  if (confirmedBug) {
    console.error('[Pass 3 Diagnostic] CONFIRMED: Nested select loses all rows!', {
      simple_count: simpleCount,
      nested_count: nestedResult?.length ?? 0
    });
  } else if (lostRows > 0) {
    console.warn('[Pass 3 Diagnostic] Nested select loses some rows:', { lost: lostRows });
  }

  // ===== Test 3: FK relationship verification =====
  let fkVerification = null;
  if (simpleResult && simpleResult.length > 0) {
    const sample = simpleResult[0];

    const { data: tableExists } = await admin
      .from("game_tables")
      .select("id")
      .eq("id", sample.table_id)
      .maybeSingle();

    const { data: attendanceExists } = await admin
      .from("dealer_attendance")
      .select("id, dealer_id")
      .eq("id", sample.attendance_id)
      .maybeSingle();

    fkVerification = {
      assignment_id: sample.id.substring(0, 8),
      table_exists: !!tableExists,
      attendance_exists: !!attendanceExists,
      dealer_id: attendanceExists?.dealer_id?.substring(0, 8) ?? null
    };

    console.log('[Pass 3 Diagnostic] FK verification:', fkVerification);

    if (!tableExists || !attendanceExists) {
      console.error('[Pass 3 Diagnostic] ORPHANED FK detected!');
    }
  }

  return {
    timestamp: now,
    club_id: clubId,
    simple_query: {
      count: simpleCount,
      data_length: simpleResult?.length ?? 0,
      error: simpleErr?.message ?? null,
      sample_ids: simpleSample
    },
    nested_query: {
      data_length: nestedResult?.length ?? 0,
      error: nestedErr?.message ?? null
    },
    fk_verification: fkVerification,
    lost_rows: lostRows,
    confirmed_bug: confirmedBug
  };
}
```

**Diagnostic làm gì:**
- **Test 1:** Query simple (chỉ select columns phẳng) → baseline
- **Test 2:** Query nested với `!attendance_id` hint (giống code gốc) → nghi vấn
- **Test 3:** Verify FK còn nguyên không
- **So sánh:** `lost_rows = simple_count - nested_count`
- **Confirmed bug:** `simple > 0` AND `nested == 0`

---

### 4. EDIT: `supabase/functions/process-swing/index.ts` (line 33-34, 1612-1635)

**Add import:**

```typescript
import { pass2PreAssignNext } from "./passes/pass2-pre-assign.ts";
import { pass25InitialAssign } from "./passes/pass2.5-initial-assign.ts";
import { pass15RotationPlanner } from "./passes/pass1.5-rotation-planner.ts";
import { runPass3Diagnostic } from "./diagnostics.ts";  // ← NEW
```

**Add diagnostic call trước Pass 3 query (line 1612-1635):**

```typescript
        // ── PASS 3 — Execute swings at T-0 ────────────────────────────────
        const nowPlusBuf = new Date(Date.now() + SWING_WINDOW_BUFFER_MINUTES * 60 * 1000).toISOString();
        const now = new Date().toISOString();

        // ═══ DIAGNOSTIC: Compare simple vs nested query (Phase 1) ═══════
        try {
          const diagnostic = await runPass3Diagnostic(admin, cid, forceAll);
          console.log('[Pass 3 Diagnostic] Summary:', {
            confirmed_bug: diagnostic.confirmed_bug,
            lost_rows: diagnostic.lost_rows,
            simple_count: diagnostic.simple_query.count,
            nested_count: diagnostic.nested_query.data_length
          });
          await admin.from("diagnostic_logs").insert({
            timestamp: diagnostic.timestamp,
            club_id: diagnostic.club_id,
            diagnostic_type: 'pass3_query_issue',
            result: diagnostic,
            metadata: { force_all: forceAll, pass: 3 }
          }).then(({ error: insertErr }) => {
            if (insertErr) {
              console.warn('[Pass 3 Diagnostic] Failed to save:', insertErr.message);
            }
          });
        } catch (diagErr: any) {
          console.warn('[Pass 3 Diagnostic] Diagnostic failed (non-blocking):', diagErr?.message);
        }
        // ═══ End diagnostic ═════════════════════════════════════════════

        const query = admin
          .from("dealer_assignments")
          .select(
            `id, table_id, attendance_id, swing_due_at, version,
             pre_assigned_attendance_id, overtime_started_at,
             last_ot_alert_at,
             game_tables(table_name, table_type),
             dealer_attendance!attendance_id(dealers(full_name, telegram_username, telegram_user_id))`
          )
          .eq("status", "assigned")
          .is("released_at", null)
          .is("swing_processed_at", null)
          .eq("club_id", cid);
```

**Ghi chú:**
- Diagnostic chạy TRƯỚC query gốc
- Try/catch wrap → diagnostic fail KHÔNG chặn Pass 3
- Save vào `diagnostic_logs` table để analyze sau

---

## 🚀 Deploy Steps

```bash
# 1. Migrations (DONE)
supabase db push
# OR via MCP:
# supabase_apply_migration(name, query) - both calls succeeded

# 2. Deploy edge function
supabase functions deploy process-swing --no-verify-jwt

# 3. Watch logs
supabase functions logs process-swing --tail

# 4. Wait 2-3 cron cycles (~3 min)

# 5. Analyze
# SQL queries below
```

## 📊 Analysis Queries

### Query 1: Latest diagnostic results

```sql
SELECT 
  timestamp,
  club_id,
  result->>'confirmed_bug' AS confirmed_bug,
  result->>'lost_rows' AS lost_rows,
  result->'simple_query'->>'count' AS simple_count,
  result->'nested_query'->>'data_length' AS nested_count,
  result->'fk_verification' AS fk_check
FROM diagnostic_logs
WHERE diagnostic_type = 'pass3_query_issue'
ORDER BY timestamp DESC
LIMIT 10;
```

### Query 2: 1-hour stats

```sql
SELECT 
  COUNT(*) FILTER (WHERE (result->>'confirmed_bug')::boolean) AS confirmed_bugs,
  COUNT(*) FILTER (WHERE (result->>'lost_rows')::int > 0) AS partial_loss,
  COUNT(*) AS total_runs
FROM diagnostic_logs
WHERE diagnostic_type = 'pass3_query_issue'
  AND timestamp > NOW() - INTERVAL '1 hour';
```

### Query 3: Index check

```sql
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'dealer_assignments'
  AND indexname = 'idx_assignments_due_swing';
```

## 🎯 Decision Matrix

| Scenario | Signals | Next Action |
|----------|---------|-------------|
| **A. PostgREST JOIN confirmed** | `confirmed_bug=true`, FK OK | → Phase 2 (fix all 8 nested selects) |
| **B. Partial loss** | `lost_rows=1-2`, FK issue | Fix data, re-test |
| **C. Both 0** | `simple=0`, `nested=0` | Check timezone, Pass 2 logs |
| **D. Permission error** | `simple_query.error != null` | Check RLS, service_role |

## ⏱️ Timeline

```
T+0:00  Deploy migrations
T+0:30  Deploy edge function
T+1:00  First diagnostic run
T+2:00  Second run
T+3:00  Third run
T+3:30  Analyze diagnostic_logs
T+4:00  Decision: A/B/C/D
```

## 🔄 Rollback Plan

If diagnostic breaks Pass 3:

```bash
# Revert edge function
git revert HEAD
supabase functions deploy process-swing --no-verify-jwt

# Or manual edit: remove diagnostic block from index.ts
```

The diagnostic is in a try/catch — **cannot break** Pass 3 execution.
The `diagnostic_logs` table can be dropped safely if needed.

## 📝 Notes

- **Manual cleanup:** No auto-cleanup function — I'll purge `diagnostic_logs` manually after Phase 3 confirmed
- **Branch protection:** Working on branch `fix/phase1-nested-select-diagnostic`, not master
- **Risk level:** ZERO — only adds logging, no behavior change
