# Code Changes for process-swing/index.ts

> **CORRECTED** — Áp dụng review fixes:
> - [FIX-BATCH] Changes B, C giữ batch UPDATE (không for-loop) để bảo toàn atomicity. Trigger ghi audit với `'direct_update'` reason.
> - [FIX-ORPHAN] Change G dùng `auto_close_low_priority_tables` RPC thay vì for-loop + `close_table`.
> - [FIX-THRESHOLD] Change G dùng `shortage_close_threshold` default 4 (không hardcode 30).

---

## Change A: State transition helper (thêm sau imports, khoảng line 30)

```typescript
// ─── Dealer State Machine ─────────────────────────────────────────────────────
// Wrapper around transition_dealer_state RPC. Dùng cho individual operations.
// Batch cleanup (Pass 1b, 1c) dùng direct UPDATE — trigger ghi audit tự động.
async function transitionDealerState(
  admin: ReturnType<typeof createClient>,
  attendanceId: string,
  newState: string,
  reason?: string
): Promise<boolean> {
  const { data, error } = await admin.rpc("transition_dealer_state", {
    p_attendance_id: attendanceId,
    p_new_state: newState,
    p_reason: reason ?? null,
  });
  if (error || data?.ok !== true) {
    console.error(
      `[state] FAILED ${attendanceId}: ${data?.from ?? '?'} → ${newState}` +
      ` (${data?.error ?? error?.message ?? 'unknown'})` +
      (reason ? ` reason=${reason}` : '')
    );
    return false;
  }
  if (data?.noop) return true; // same state, no-op
  console.log(`[state] ${attendanceId}: ${data.from} → ${data.to}${reason ? ` (${reason})` : ''}`);
  return true;
}
```

## Change B: Pass 1b — GIỮ BATCH UPDATE (FIX-BATCH)

> [FIX-BATCH] Giữ batch UPDATE — không chuyển sang for-loop. Trigger `trg_dealer_state_change` ghi audit với `reason='direct_update'`. Batch atomicity được bảo toàn.

**BEFORE:**
```typescript
await admin
  .from("dealer_attendance")
  .update({
    current_state: "available",
    pre_assigned_table_id: null,
    pre_assigned_at: null,
  })
  .in("id", staleAttendanceIds)
  .eq("current_state", "pre_assigned");
```

**AFTER:** (giống before — chỉ cập nhật pre_assigned fields cùng với state change)
```typescript
await admin
  .from("dealer_attendance")
  .update({
    current_state: "available",
    pre_assigned_table_id: null,
    pre_assigned_at: null,
  })
  .in("id", staleAttendanceIds)
  .eq("current_state", "pre_assigned");
```

**KHÔNG chuyển thành for-loop.** Trigger ghi audit log tự động.

## Change C: Pass 1c — GIỮ BATCH UPDATE (FIX-BATCH)

**BEFORE:**
```typescript
await admin
  .from("dealer_attendance")
  .update({ current_state: "available" })
  .in("id", orphanIds)
  .eq("current_state", "pre_assigned");
```

**AFTER:** (giống before)
```typescript
await admin
  .from("dealer_attendance")
  .update({ current_state: "available" })
  .in("id", orphanIds)
  .eq("current_state", "pre_assigned");
```

## Change D: Pass 2 — replace direct update (line ~429)

**BEFORE:**
```typescript
await admin.from("dealer_attendance").update({ current_state: "pre_assigned" }).eq("id", nextDealer.id);
```

**AFTER:**
```typescript
await transitionDealerState(admin, nextDealer.id, "pre_assigned", "pass2_pre_assign");
```

## Change E: SAFEGUARD — replace direct update (line ~784)

**BEFORE:**
```typescript
await admin.from("dealer_attendance").update({ current_state: "available" }).eq("id", nextDealer.id);
```

**AFTER:**
```typescript
await transitionDealerState(admin, nextDealer.id, "available", "safeguard_club_mismatch");
```

## Change F: Pass 0c — Stuck dealer detector (thêm sau Pass 0b, line ~271)

Cập nhật: sử dụng `detect_stuck_breaks` RPC với signature `(attendance_id UUID, dealer_name TEXT, expected_min INT, overdue_min INT)`.

```typescript
// ── Pass 0c: Detect stuck dealers ─────────────────────────
if (!dryRun) {
  // Stuck pre_assigned (no table, no assignment) → auto-release
  const { data: stuckPre } = await admin
    .from("dealer_attendance")
    .select("id, dealer_id")
    .eq("current_state", "pre_assigned")
    .is("pre_assigned_table_id", null);

  // Stuck on_break past expected duration
  const { data: stuckBreaks } = await admin
    .rpc("detect_stuck_breaks", { p_club_id: cid });
  // Returns: attendance_id, dealer_name, expected_min, overdue_min

  const allStuck: Array<{ id: string; issue: string }> = [];
  for (const s of stuckPre ?? []) {
    allStuck.push({ id: s.id, issue: "pre_assigned_no_table" });
    await transitionDealerState(admin, s.id, "available", "pass0c_stuck_pre_assigned");
  }
  for (const s of stuckBreaks ?? []) {
    allStuck.push({ id: s.attendance_id, issue: `break_overdue_${s.overdue_min}m` });
  }

  if (allStuck.length > 0) {
    const chatId = await getClubTelegramChatId(admin, cid);
    if (botToken && chatId) {
      await sendTelegramNotification(
        botToken, chatId,
        `⚠️ *${allStuck.length} dealer bị treo — đã tự động sửa*\n` +
        allStuck.map(s => `  • ${s.issue}: \`${s.id.slice(0, 8)}…\``).join("\n") +
        `\n(Kiểm tra dealer_state_transitions để biết chi tiết)`,
        {}
      );
    }
  }
}
```

## Change G: SHORTAGE ESCALATION — dùng `auto_close_low_priority_tables` RPC

> [FIX-ORPHAN] Dùng `auto_close_low_priority_tables` RPC — xử lý 3 bước (close table → end assignment → release dealer) trong 1 CTE. Không dùng for-loop với `close_table` RPC.
> [FIX-THRESHOLD] `shortage_close_threshold` default = 4 từ club_settings.

```typescript
// ── SHORTAGE ESCALATION ──────────────────────────────────
// Nếu >50% assignments failed với no_dealer (và không có error), escalate
if (!dryRun && metrics.total > 0 && metrics.failed === 0) {
  const noDealerRatio = metrics.no_dealer / metrics.total;
  if (noDealerRatio > 0.5 && metrics.no_dealer >= 3) {
    console.warn(`[process-swing] SHORTAGE: club ${cid} no_dealer=${metrics.no_dealer}/${metrics.total}`);

    // Check club settings for auto-close
    const { data: settingsRow } = await admin
      .from("club_settings")
      .select("shortage_auto_close_enabled, shortage_close_threshold, shortage_notify_telegram")
      .eq("club_id", cid)
      .maybeSingle();

    const autoClose = (settingsRow as any)?.shortage_auto_close_enabled ?? false;
    const threshold = (settingsRow as any)?.shortage_close_threshold ?? 4;
    const notifyTg = (settingsRow as any)?.shortage_notify_telegram ?? true;

    if (notifyTg) {
      const chatId = await getClubTelegramChatId(admin, cid);
      if (botToken && chatId) {
        let msg = `🚨 *THIẾU DEALER* — ${metrics.no_dealer}/${metrics.total} bàn không có người thay.\n`;
        if (autoClose && metrics.no_dealer >= threshold) {
          // auto_close_low_priority_tables handles 3 steps atomically:
          // 1. Close low-priority tables 2. End active assignments 3. Release dealers to available
          const { data: closed } = await admin
            .rpc("auto_close_low_priority_tables", { p_club_id: cid });
          if (closed && closed.length > 0) {
            msg += `🔴 Đã tự động đóng: ${closed.map((t: any) => t.table_name).join(", ")}\n`;
          }
        }
        msg += `🔄 Cron sẽ thử lại ở lần chạy tiếp theo.`;
        await sendTelegramNotification(botToken, chatId, msg, {});
      }
    }
  }
}
```

## Change H: PASS 4 — refresh pool summary (sau dòng ~885)

```typescript
// Refresh dealer pool summary (monitoring only)
if (!dryRun) {
  await admin.rpc("refresh_dealer_pool_summary").catch((err: Error) =>
    console.warn("[process-swing] pool summary refresh failed:", err.message)
  );
}
```

---

## Files affected (non-migration)

| File | Changes |
|------|---------|
| `supabase/functions/process-swing/index.ts` | A (new helper) + B+C (batch UPDATE giữ nguyên) + D+E (transitionDealerState) + F (stuck detect) + G (shortage escalation via RPC) + H (pool refresh) |

## Tổng kết

- **+1 helper function** `transitionDealerState()` (cho individual operations)
- **+0 changes** to Pass 1b, 1c batch logic (giữ nguyên, FIX-BATCH)
- **+2 replacements** Pass 2 + SAFEGUARD → `transitionDealerState()`
- **+1 monitoring pass** Pass 0c (stuck detection + auto-fix)
- **+1 escalation pass** Shortage auto-close via `auto_close_low_priority_tables` RPC
- **+1 pool refresh** via `refresh_dealer_pool_summary()`
