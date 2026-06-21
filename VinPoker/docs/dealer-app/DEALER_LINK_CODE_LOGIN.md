# `/malienket` — Dealer-app login by one-time link code (build-spec + security)

> Owner request: a verified dealer types **`/malienket`** in Telegram → gets a **mã liên kết**
> (link code) → enters it in the dealer app → logged in. This is a **login mechanism**, so it's
> design-confirmed before building (same discipline as B2/B1). Build all 4 components on owner "go".

## 1. Why a code (vs the existing magic link)
`/setup` already provisions a Supabase auth user (`dealers.user_id`), stores a synthetic email
`dlr<base36 tgid>@dealer.vinpoker.live`, and sends a **one-tap magic link** + an account-code +
temp password for the app's `DealerLogin` form (`signInWithPassword`). The owner wants a **simpler,
re-issuable, short code** the dealer just types — no long URL, no stored password. `/malienket`
issues that code; the app exchanges it for a real session **reusing the proven `verifyOtp` path**
(`AuthCallback` already calls `supabase.auth.verifyOtp({ token_hash, type })`).

## 2. Flow (4 components)
```
Dealer (Telegram, already verified+linked) ── /malienket ──▶ telegram-bot
   bot: dealer.telegram_user_id → dealers row; REQUIRE dealers.user_id (auth account exists)
        generate random code  →  store SHA-256(code) in dealer_login_codes (user_id, expires_at, used=false)
        DM the plaintext code to the dealer  (e.g. "Mã đăng nhập: K7QP-2F9 — hết hạn 10 phút, dùng 1 lần")
Dealer (app DealerLogin) ── enters code ──▶ edge dealer-code-login (anon-callable)
   edge (service_role): SHA-256(code) → atomic claim row (unexpired, unused) → mark used → user_id
        admin.auth.admin.getUserById(user_id) → email
        admin.auth.admin.generateLink({ type:'magiclink', email }) → properties.hashed_token
        return { token_hash, type:'magiclink' }
App: supabase.auth.verifyOtp({ token_hash, type:'magiclink' }) → session set → DealerAppShell renders app
```
The link code is a **bearer credential** (like an OTP); the `token_hash` exchange happens
server-side, gated by a valid code, and the app then uses Supabase's own verifyOtp (no custom JWT
minting, no service-role session forging).

## 3. Security properties (must-haves)
- **Hashed at rest**: store only `sha256(code)`; never the plaintext (mirrors how OTPs are handled).
- **High entropy**: ≥ 40 bits (e.g. 8 chars from an unambiguous base32 alphabet, no 0/O/1/I).
- **Short expiry**: 10 minutes (owner-tunable).
- **Single-use, atomic**: `UPDATE dealer_login_codes SET used=true WHERE code_hash=$1 AND used=false
  AND expires_at>now() RETURNING user_id` — exactly one caller can win; replay returns nothing.
- **Requires an existing auth account**: `/malienket` refuses if `dealers.user_id` is null (tell them
  to `/setup` first). The code never *creates* an account — it only logs into an existing one.
- **One active code per dealer**: issuing a new code invalidates prior unused ones (delete/expire).
- **Rate-limit**: `/malienket` throttled per dealer (e.g. ≥ 30 s between issues); the edge counts
  failed attempts (brute-force is already impractical given entropy + expiry + single-use).
- **Edge is anon-callable** (dealer isn't signed in yet) but mints a session ONLY on a valid code;
  no code → no session. Self-cleans expired rows on each issue (like the lock table).
- **Audit**: log issue + redeem events (telegram_user_id, dealer_id, ts) — NEVER the code/token.
- **No new privilege**: the session is the dealer's own existing auth user; same scope as today's
  magic-link / password login. No swing/payroll/financial surface touched.

## 4. Components to build (all source-only first; deploys owner-gated)
1. **DB migration** `dealer_login_codes` — `code_hash text PK, user_id uuid, dealer_id uuid,
   expires_at timestamptz, used boolean default false, created_at`. RLS on + no policy +
   service_role-only grants (internal). + index on expires_at. Idempotent. Source-only → controlled apply.
2. **telegram-bot** — add `/malienket` (aliases `/malien`, `/code`) handler: verify linked dealer
   with `user_id`; rate-limit; self-clean + invalidate old; insert hashed code; DM the code. Add to /help.
3. **edge `dealer-code-login`** (new fn, `--no-verify-jwt` — pre-auth, like a login endpoint; but it
   ONLY returns a token_hash for a valid code): validate+claim code → generateLink → return token_hash.
   Best-effort + safe failure (invalid/expired → generic "mã không hợp lệ hoặc đã hết hạn").
4. **DealerLogin.tsx** — add a second tab/section **"Đăng nhập bằng mã"**: code input → call
   `dealer-code-login` → `supabase.auth.verifyOtp({ token_hash, type })` → toast + AuthProvider
   re-renders. Keep the existing account+password path. + i18n keys (vi + the 5 other locales:
   `dealer.login.codeTab`, `.codePlaceholder`, `.codeSubmit`, `.codeFailed`).

## 5. Test plan
- `/malienket` without `/setup` → refused with guidance. With account → DM code; re-issuing invalidates the old.
- App: valid code → logged in; reused code → "không hợp lệ"; expired code → "hết hạn"; wrong code → generic fail.
- Synthetic-email dealer + real-email dealer both work (generateLink works on both).
- Rate-limit blocks rapid re-issue. Audit rows present; no plaintext code/token logged anywhere.

## 6. Open questions for owner (lock before build)
1. **Code length/format** — 8 chars base32 grouped `XXXX-XXX` (recommended) vs 6 digits (easier to type, lower entropy → keep 10-min/single-use)?
2. **Expiry** — 10 min (recommended)?
3. **Keep the existing account-code + password login too**, or make code-login the primary? (recommend: keep both, add code as the easy path.)
4. **Command name** — `/malienket` (+ aliases `/malien`, `/code`)?

## 7. Guardrails
Reuses the existing auth user + Supabase verifyOtp; no custom JWT/session forging; no swing/payroll/
financial change; `checkout-dealer`/other fns untouched. DB source-only → controlled apply; edge +
frontend deploy on merge (owner-gated). Each component verified (deno check / tsc / build). Audit
never logs secrets.
