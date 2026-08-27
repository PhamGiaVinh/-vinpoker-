# FT Payslip Preview and Telegram Delivery Rollout

Mode: `CRITICAL/RED`. This source document does not authorize a database apply,
Edge/frontend deployment, feature enable, or Telegram send.

## Scope

- Online preview for the existing immutable FT statement PDF in Dealer Swing > Bang luong.
- A clearly labelled browser-only PT temporary preview, never eligible for Telegram delivery.
- One-by-one finalised FT statement delivery through `send-payroll-statement` using Telegram
  `sendDocument`, initiated from an owner confirmation dialog.
- No PT settlement, payout, automatic retry of ambiguous sends, correction UI, or wide rollout.

## Server authority and privacy

- The browser submits only a delivery operation UUID. The Edge function resolves the statement,
  club, dealer, private PDF object and `dealers.telegram_user_id` on the server.
- No client-provided money amount, name, bank field, logo URL, chat ID, PDF bytes or Telegram token
  is accepted.
- A finalised FT statement is eligible only when it has an immutable PDF with status `ready`.
- Captions are generic. Logs and operation responses contain counts and stable provider codes only.
- Storage remains private. It uses a fixed `statements/<club_uuid>/<statement_uuid>/statement.pdf`
  key, never a dealer name or phone number.

## Gates

Both existing statement rollout and delivery rollout must evaluate true:

```text
allowed = master_enabled AND (all_clubs_enabled OR club_id IN allowed_club_ids)
```

Any query failure, missing row or exception means `false`. The client does not calculate a gate.
Cashiers may preview/download within their club but cannot finalise or send. Only club owner and
super admin can create a delivery operation.

## Delivery state and duplicate protection

1. The server creates one operation per `club_id + request_id` and one active target per
   `statement_id + telegram` channel.
2. An Edge invocation claims one target with a lease token before it downloads the PDF.
3. It verifies the downloaded PDF SHA-256 against the immutable statement metadata, resolves the
   recipient server-side and calls Telegram once.
4. Success records `sent`. A transport ambiguity or a receipt write failure records `unknown`;
   it is never automatically re-sent.
5. Operators must investigate `unknown` through an approved recovery path before any manual retry.

## Controlled rollout

1. Record exact reviewed merge SHA and keep both rollout masters OFF with allowlists empty.
2. Run protected catalog preflight: statement/PDF relations, `telegram_user_id`, private bucket,
   functions/signatures, ACL/RLS, delivery indexes and migration collision check.
3. Apply only `20270113000004_dealer_payroll_statement_telegram_delivery.sql` in an
   owner-approved window. Do not use `supabase db push` or migration replay.
4. Verify default-off rows, direct-table denial, authenticated entrypoints and service-only claim /
   complete / failure entrypoints.
5. Deploy only `send-payroll-statement` and the reviewed frontend exact SHA through protected
   workflows. Do not deploy unrelated Edge functions.
6. With master OFF, verify statement preview/finalisation/PDF download and delivery operation all
   fail closed. Do not send Telegram.
7. Owner may enable master and allowlist HSOP only for TEST data. Confirm a finalised FT statement,
   its online preview, a single `sendDocument` receipt, operation idempotency and zero payout
   mutation.
8. Switch master OFF once and confirm an already-created pending operation cannot send. Re-enable
   only after owner accepts this kill-switch evidence.
9. Monitor audit/operation/Edge receipts for at least 15 minutes. Do not expand to all clubs in
   the same wave.

## Incident and recovery

- Set either rollout master OFF immediately. This blocks new server work without waiting for a
  frontend deploy.
- Do not delete statements, overwrite PDFs, remove audit evidence or reset assignments.
- `unknown` means Telegram may already have received the document. Treat it as an incident record,
  not a failed item to click again.
- A mistaken immutable statement still follows the existing void/replacement runbook; this slice
  creates no correction or payout path.
