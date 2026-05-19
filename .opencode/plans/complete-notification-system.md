# Complete Notification System Upgrade

## Goal

Ensure every staking/transaction lifecycle event sends:
1. **In-app notification** (bảng `notifications`) — đúng type, đúng người nhận
2. **Web push** (OneSignal) — tự động qua trigger `fn_dispatch_push` (đã active)
3. **Sound effects** — `playAlertSound()` đã chạy khi có INSERT realtime, cần nâng cấp để phân biệt sound theo type

---

## Current State Audit

### Enum `notification_type` — hiện tại (14 values)
```sql
deal_committed, deal_funded, deal_auto_cancelled, deal_auto_closed,
deal_expiring_soon, result_entered, result_verified, result_disputed,
release_requested, payout_executed, system_announcement,
schedule_updated, registration_confirmed, chat_message
```

### Notification inserts hiện tại

| # | File | Type | Who gets it |
|---|---|---|---|
| 1 | `staking-commit-deal` | `deal_committed` | Player (of the deal) |
| 2 | `admin-confirm-funded` | ❌ KHÔNG CÓ notification insert | — |
| 3 | `player-check-in` | `deal_funded` (MISUSE) | Backers |
| 4 | `tournament-register` | `registration_confirmed` | Player |
| 5 | `approve-reject-verification` | `verification_approved` / `verification_rejected` | Player |
| 6 | `fn_deal_notify` trigger (8 transitions) | Mixed | Player + Backer + Super Admins |
| 7 | `fn_chat_message_notify` trigger | `chat_message` | Group members |
| 8 | `fn_schedule_updated_notify` trigger | `schedule_updated` | Club members |

### Critical Bugs
1. `verification_approved`, `verification_rejected` — **NOT in DB enum** → inserts FAIL at runtime
2. `player-check-in` uses `deal_funded` type for check-in event — semantic mismatch
3. `admin-confirm-funded` sends emails but **NO in-app notification** to individual backer
4. **Cashiers receive zero notifications** when new transactions arrive
5. **No notification for refund** (`deal_refunded` doesn't exist in enum)
6. `useNotifications.tsx` `NotificationType` union missing `verification_approved`, `verification_rejected`, `player_checked_in`, `deal_refunded`

---

## Changes Required

### Phase 1: Database Migration — Add Missing Enum Values

**File:** `supabase/migrations/20260518000001_notification_enum_additions.sql`

```sql
-- Add missing notification types
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'verification_approved';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'verification_rejected';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'deal_refunded';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'player_checked_in';
```

---

### Phase 2: Add Notifications in Missing Edge Functions

#### 2a. `admin-confirm-funded/index.ts`

**Context:** After purchase is funded (after line 154, before emails). Add notification for:
- Backer (their purchase was confirmed funded)
- Player (someone funded their deal)
- Other cashiers of the same club (informational)

Add after line 154 (after `staking_audit_logs.insert`):

```typescript
// === NOTIFICATIONS ===
try {
  const { data: backerProfile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("user_id", purchase.backer_id)
    .maybeSingle();
  const backerName = backerProfile?.display_name ?? "Backer";
  const label = deal.custom_event_name ?? `Deal #${String(deal.id).slice(0, 6)}`;

  // 1. Notify backer: funding confirmed
  await admin.from("notifications").insert({
    user_id: purchase.backer_id,
    type: "deal_funded",
    title: "Khoản đầu tư đã được xác nhận",
    body: `Giao dịch ${Number(purchase.percent)}% deal "${label}" (${Number(purchase.amount_vnd).toLocaleString()} VND) đã được FUNDED.`,
    data: { deal_id: deal.id, purchase_id: purchase.id, percent: purchase.percent },
  });

  // 2. Notify player: someone funded
  await admin.from("notifications").insert({
    user_id: deal.player_id,
    type: "deal_funded",
    title: "Backer vừa FUNDED",
    body: `${backerName} vừa FUNDED ${purchase.percent}% deal "${label}". Tổng funded: ${totalFunded}/${deal.percentage_sold}%.`,
    data: { deal_id: deal.id, backer_id: purchase.backer_id, total_funded: totalFunded },
  });

  // 3. Notify other cashiers of the club
  if (deal.club_id) {
    const { data: cashiers } = await admin
      .from("club_cashiers")
      .select("user_id")
      .eq("club_id", deal.club_id);
    if (cashiers) {
      const cashierNotis = cashiers
        .filter((c: any) => c.user_id !== uid)
        .map((c: any) => ({
          user_id: c.user_id,
          type: "deal_funded",
          title: "Giao dịch mới FUNDED tại CLB",
          body: `Backer đã FUNDED ${purchase.percent}% deal "${label}". Số tiền: ${Number(purchase.amount_vnd).toLocaleString()} VND.`,
          data: { deal_id: deal.id, club_id: deal.club_id, purchase_id: purchase.id },
        }));
      if (cashierNotis.length) {
        await admin.from("notifications").insert(cashierNotis);
      }
    }
    // Also notify club owner
    const { data: club } = await admin
      .from("clubs")
      .select("owner_id")
      .eq("id", deal.club_id)
      .maybeSingle();
    if (club?.owner_id && club.owner_id !== uid) {
      await admin.from("notifications").insert({
        user_id: club.owner_id,
        type: "deal_funded",
        title: "Giao dịch mới FUNDED tại CLB của bạn",
        body: `Backer đã FUNDED ${purchase.percent}% deal "${label}".`,
        data: { deal_id: deal.id, club_id: deal.club_id },
      });
    }
  }
} catch (_) { /* non-critical */ }
```

#### 2b. `staking-commit-deal/index.ts`

**Context:** After a backer commits to buy % of a deal (after line 181). Add notification for cashiers.

Add after line 181 (after existing notification to player):

```typescript
// === Notify cashiers + club owner of new pending purchase ===
try {
  if (deal.club_id) {
    const { data: cashiers } = await admin
      .from("club_cashiers")
      .select("user_id")
      .eq("club_id", deal.club_id);
    if (cashiers && cashiers.length > 0) {
      const notis = cashiers.map((c: any) => ({
        user_id: c.user_id,
        type: "deal_committed",
        title: "Có giao dịch mới chờ xác nhận",
        body: `Backer vừa mua ${percent}% deal "${deal.custom_event_name ?? "Deal"}". Số tiền: ${amountVnd.toLocaleString()} VND.`,
        data: { deal_id: deal.id, club_id: deal.club_id, percent, amount_vnd: amountVnd },
      }));
      await admin.from("notifications").insert(notis);
    }
    // Also notify club owner
    const { data: club } = await admin
      .from("clubs")
      .select("owner_id")
      .eq("id", deal.club_id)
      .maybeSingle();
    if (club?.owner_id) {
      await admin.from("notifications").insert({
        user_id: club.owner_id,
        type: "deal_committed",
        title: "Có giao dịch mới tại CLB của bạn",
        body: `Backer vừa mua ${percent}% deal "${deal.custom_event_name ?? "Deal"}".`,
        data: { deal_id: deal.id, club_id: deal.club_id, percent },
      });
    }
  }
} catch (_) { /* non-critical */ }
```

#### 2c. `player-check-in/index.ts`

**Context:** Fix type misuse + add notification for cashiers.

Change line 99 from:
```typescript
type: "deal_funded", // reuse existing notification type
```
To:
```typescript
type: "player_checked_in",
```

After the existing backer notification block (after line 105), add:
```typescript
// Notify other cashiers of the club
if (deal.club_id) {
  const { data: cashiers } = await admin
    .from("club_cashiers")
    .select("user_id")
    .eq("club_id", deal.club_id);
  if (cashiers) {
    const notis = cashiers
      .filter((c: any) => c.user_id !== callerId)
      .map((c: any) => ({
        user_id: c.user_id,
        type: "player_checked_in",
        title: "Player đã check-in",
        body: `${playerName} đã check-in deal "${label}" tại CLB.`,
        data: { deal_id: dealId, club_id: deal.club_id },
      }));
    if (notis.length) await admin.from("notifications").insert(notis);
  }
}
```

---

### Phase 3: Create `staking-process-refund` Edge Function

**File:** `supabase/functions/staking-process-refund/index.ts` (NEW)

```typescript
// Cashier/SuperAdmin refunds a staking deal: refunds all funded backers.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  deal_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "Missing auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } },
    );
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return j({ error: "Unauthorized" }, 401);
    const uid = u.user.id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: roles } = await admin
      .from("user_roles").select("role").eq("user_id", uid).in("role", ["super_admin", "cashier"]);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    const isSuper = roleSet.has("super_admin");
    const isCashier = roleSet.has("cashier");
    if (!isSuper && !isCashier) return j({ error: "Forbidden" }, 403);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const { deal_id, reason } = parsed.data;

    const { data: deal } = await admin
      .from("staking_deals")
      .select("id, player_id, club_id, status, custom_event_name, buy_in_amount_vnd, filled_percent")
      .eq("id", deal_id)
      .maybeSingle();
    if (!deal) return j({ error: "Deal not found" }, 404);
    if (!["funded", "locked", "result_entered", "result_verified"].includes(deal.status)) {
      return j({ error: `Deal status is ${deal.status}, cannot refund` }, 400);
    }

    // Cashier scope check
    if (!isSuper && deal.club_id) {
      const { data: ok } = await admin.rpc("is_club_cashier", { _user_id: uid, _club_id: deal.club_id });
      if (!ok) return j({ error: "Not cashier for this club" }, 403);
    }

    // Get all funded backers
    const { data: purchases } = await admin
      .from("staking_purchases")
      .select("id, backer_id, percent, amount_vnd")
      .eq("deal_id", deal.id)
      .eq("status", "funded")
      .limit(500);
    const backers = purchases ?? [];
    const label = deal.custom_event_name ?? `Deal #${String(deal.id).slice(0, 6)}`;

    // Update deal status
    await admin.from("staking_deals")
      .update({
        status: "deal_refunded",
        refund_status: "completed",
        refund_reason: reason,
        refunded_by: uid,
        refunded_at: new Date().toISOString(),
      })
      .eq("id", deal.id);

    // Record escrow transactions (refund)
    for (const p of backers) {
      await admin.from("escrow_transactions").insert({
        deal_id: deal.id,
        transaction_type: "refund",
        amount_vnd: p.amount_vnd,
        performed_by_admin_id: uid,
        note: `Refund to backer ${p.backer_id} (${p.percent}%) — ${reason}`,
      }).catch(() => {});
    }

    // Audit
    await admin.from("staking_audit_logs").insert({
      deal_id: deal.id,
      action: "refunded",
      performed_by: uid,
      old_status: deal.status,
      new_status: "deal_refunded",
      metadata: { reason, backer_count: backers.length },
    });

    // === NOTIFICATIONS ===
    try {
      // Notify player
      await admin.from("notifications").insert({
        user_id: deal.player_id,
        type: "deal_refunded",
        title: "Deal đã được hoàn tiền",
        body: `Deal "${label}" đã bị hoàn tiền. Lý do: ${reason}`,
        data: { deal_id: deal.id, reason },
      });

      // Notify each funded backer
      for (const p of backers) {
        await admin.from("notifications").insert({
          user_id: p.backer_id,
          type: "deal_refunded",
          title: "Bạn đã được hoàn tiền",
          body: `Khoản đầu tư ${p.percent}% (${p.amount_vnd.toLocaleString()} VND) deal "${label}" đã được hoàn trả. Lý do: ${reason}`,
          data: { deal_id: deal.id, refund_amount: p.amount_vnd, reason },
        });
      }

      // Notify other cashiers
      if (deal.club_id) {
        const { data: cashiers } = await admin
          .from("club_cashiers")
          .select("user_id")
          .eq("club_id", deal.club_id);
        if (cashiers) {
          const notis = cashiers
            .filter((c: any) => c.user_id !== uid)
            .map((c: any) => ({
              user_id: c.user_id,
              type: "deal_refunded",
              title: "Deal đã được hoàn tiền tại CLB",
              body: `Deal "${label}" đã hoàn tiền cho ${backers.length} backer. Lý do: ${reason}`,
              data: { deal_id: deal.id, club_id: deal.club_id, reason },
            }));
          if (notis.length) await admin.from("notifications").insert(notis);
        }
      }
    } catch (_) { /* non-critical */ }

    // Email notifications (best-effort)
    try {
      const { sendEmailViaFunction } = await import("../_shared/emailTemplates.ts");
      const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
      const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      for (const p of backers) {
        const { data: bu } = await admin.auth.admin.getUserById(p.backer_id);
        if (bu?.user?.email) {
          await sendEmailViaFunction(SUPA_URL, SVC_KEY, {
            to: bu.user.email,
            subject: `[VBacker] Hoàn tiền deal ${label}`,
            html: `<p>Khoản đầu tư ${p.percent}% (${p.amount_vnd.toLocaleString()} VND) đã được hoàn trả.</p><p>Lý do: ${reason}</p>`,
          }).catch(() => {});
        }
      }
    } catch (_) { /* non-critical */ }

    return j({ success: true, refunded_backers: backers.length, deal_id: deal.id });
  } catch (e: any) {
    return j({ error: e.message ?? "internal" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
```

---

### Phase 4: Update Frontend TypeScript Types

**File:** `src/hooks/useNotifications.tsx`

#### 4a. Add new types to the union (line 6-20):
```typescript
export type NotificationType =
  | "deal_committed"
  | "deal_funded"
  | "deal_auto_cancelled"
  | "deal_auto_closed"
  | "deal_expiring_soon"
  | "deal_refunded"           // NEW
  | "player_checked_in"       // NEW
  | "result_entered"
  | "result_verified"
  | "result_disputed"
  | "release_requested"
  | "payout_executed"
  | "system_announcement"
  | "schedule_updated"
  | "registration_confirmed"
  | "chat_message"
  | "verification_approved"   // NEW
  | "verification_rejected";  // NEW
```

#### 4b. Add routes (in `ROUTE_FOR`, line 33-48):
```typescript
deal_refunded: () => "/staking/my-deals",
player_checked_in: () => "/staking/my-deals",
verification_approved: () => "/account?tab=verification",
verification_rejected: () => "/account?tab=verification",
```

#### 4c. Add icons (in `ICON_FOR`, line 50-65):
```typescript
deal_refunded: "♻️",
player_checked_in: "✅",
verification_approved: "🆔",
verification_rejected: "🚫",
```

#### 4d. Upgrade sound effects — play DIFFERENT sounds per type

Replace the single `playAlertSound()` call with a type-aware dispatcher.

In the `useNotifications` hook (line 113), change:
```typescript
() => { playAlertSound(); fetchAll(); },
```
To:
```typescript
(payload) => {
  const newType = payload.new?.type as NotificationType;
  playSoundForType(newType);
  fetchAll();
},
```

Add a function before the hook:
```typescript
function playSoundForType(type: NotificationType) {
  switch (type) {
    case "deal_committed":
    case "deal_funded":
    case "player_checked_in":
    case "payout_executed":
      playSuccessSound(); break;
    case "deal_auto_cancelled":
    case "deal_refunded":
    case "verification_rejected":
      playErrorSound(); break;
    case "result_entered":
    case "result_verified":
    case "registration_confirmed":
    case "verification_approved":
      playNotifySound(); break;
    default:
      playAlertSound(); break;
  }
}
```

Import the additional sound functions at the top:
```typescript
import { playAlertSound, playSuccessSound, playErrorSound, playNotifySound } from "@/lib/notifySound";
```

> Note: `playNotifySound` is already exported from `notifySound.ts`. `playSuccessSound` and `playErrorSound` also exist. Verify the exact export names in `src/lib/notifySound.ts` — the exports are:
> - `playNotifySound()` — two-tone ping (for notifications)
> - `playAlertSound()` — bell-like descending chime
> - `playSuccessSound()` — upward arpeggio
> - `playErrorSound()` — low descending square wave
> - `playInfoSound()` — soft single ping
> - `playWarningSound()` — two-tone bump

---

### Phase 5: Update NotificationBell — Show New Types

**File:** `src/components/NotificationBell.tsx`

No changes needed if it already uses `routeForNotification(n)` and `ICON_FOR[n.type]` — the new types will automatically get their routes and icons from the updated `ROUTE_FOR` and `ICON_FOR` maps. Just verify the component renders correctly.

If the component hardcodes type checks, update to support the new types.

---

### Phase 6: Verify and Test Checklist

| # | Test Case | Expected |
|---|---|---|
| 1 | Backer commits to buy % deal | Player gets `deal_committed` in-app + push + sound. Cashiers of that club also get notified. |
| 2 | Cashier confirms FUNDED (admin-confirm-funded) | Backer gets `deal_funded`. Player gets `deal_funded`. Other cashiers get notified. Sound = success. |
| 3 | Player checks in | All funded backers get `player_checked_in`. Other cashiers get notified. |
| 4 | Results entered (trigger) | Super admins get `result_entered`. |
| 5 | Results verified (trigger) | Player + Backer get `result_verified`. |
| 6 | Results disputed (trigger) | Player gets `result_disputed`. |
| 7 | Release requested (trigger) | Player + Backer get `release_requested`. |
| 8 | Payout executed (trigger) | Player + Backer get `payout_executed` + success sound. |
| 9 | Deal refunded (staking-process-refund) | Player + all funded backers get `deal_refunded` + error sound. Cashiers notified. Email sent. |
| 10 | Auto-cancel timeout (trigger) | Player + released backer get `deal_auto_cancelled` + error sound. |
| 11 | Verification approved | Player gets `verification_approved` with route to `/account`. |
| 12 | Verification rejected | Player gets `verification_rejected` with route to `/account`. |
| 13 | Tournament registration | Player gets `registration_confirmed`. Cashiers get notified. |

---

## Summary of All Files Changed

| File | Action | Changes |
|---|---|---|
| `supabase/migrations/20260518000001_notification_enum_additions.sql` | **NEW** | Add 4 enum values |
| `supabase/functions/staking-commit-deal/index.ts` | EDIT | Add cashier + club owner notification on commit |
| `supabase/functions/admin-confirm-funded/index.ts` | EDIT | Add backer + player + cashier notification on FUNDED |
| `supabase/functions/player-check-in/index.ts` | EDIT | Fix `deal_funded` → `player_checked_in`, add cashier noti |
| `supabase/functions/staking-process-refund/index.ts` | **NEW** | Full refund function + notifications + emails |
| `src/hooks/useNotifications.tsx` | EDIT | Add 4 new types to union, routes, icons, smart sound |
| `src/components/NotificationBell.tsx` | VERIFY | Ensure new types render correctly |

---

## Appendix: Notification Type — Recipient Matrix

| Event | Type | Player | Backer | Cashiers | Club Owner | Super Admin |
|---|---|---|---|---|---|---|
| Backer commits | `deal_committed` | ✅ | — | ✅ | ✅ | — |
| Purchase funded | `deal_funded` | ✅ | ✅ | ✅ | ✅ | — |
| Player checked in | `player_checked_in` | — | ✅ | ✅ | — | — |
| Deal auto-cancelled | `deal_auto_cancelled` | ✅ | ✅ | — | — | — |
| Deal refunded | `deal_refunded` | ✅ | ✅ | ✅ | — | — |
| Result entered | `result_entered` | — | — | — | — | ✅ |
| Result verified | `result_verified` | ✅ | ✅ | — | — | — |
| Result disputed | `result_disputed` | ✅ | — | — | — | — |
| Release requested | `release_requested` | ✅ | ✅ | — | — | — |
| Payout executed | `payout_executed` | ✅ | ✅ | — | — | — |
| Registration confirmed | `registration_confirmed` | ✅ | — | ✅ | — | — |
| Verification approved | `verification_approved` | ✅ | — | — | — | — |
| Verification rejected | `verification_rejected` | ✅ | — | — | — | — |
