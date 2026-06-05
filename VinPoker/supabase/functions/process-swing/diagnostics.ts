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
