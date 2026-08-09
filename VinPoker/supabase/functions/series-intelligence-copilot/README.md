# V Copilot Edge V1

Source-only server provider for Series Intelligence. The browser sends only a
request UUID, club ID, untrusted owner question, and selected option IDs.

## Server authority

The Edge function authenticates the user, consumes the owner-scoped durable
rate-limit RPC, reads Club Pulse, and resolves approved schedule candidates by
ID. Candidate money/count values come only from
`series_get_approved_schedule_candidates_v1`; Gemini cannot create or replace
them. Protected cohorts are redacted before hashing or provider export.

Rate policy V1 is global per actor and club: 5 accepted requests per 60 seconds
and 30 per hour. The request UUID makes retries idempotent. Expired receipts are
removed during consumption so the table is not an unbounded request log.

## Required server environment

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SERIES_GEMINI_API_KEY`
- `SERIES_GEMINI_MODEL` using one explicit model ID, never a `latest` alias

Do not use a browser environment variable or a key previously exposed in chat.

## CORS

The function retains `Access-Control-Allow-Origin: *` because authenticated user
JWT validation, owner-scoped RPC authorization, and database contracts are the
authority. Preview hostnames are not stable enough for a hard-coded Origin
allowlist, and Origin is not treated as authentication.

## Production gates

Source readiness does not mean production readiness. The reviewed migrations
must be applied exactly, a fresh Gemini secret must be provisioned outside
source/chat, the Edge function must be deployed through the protected workflow,
and both UI flags remain off until authenticated UAT.

No source in this directory authorizes a DB apply, Edge deploy, flag-on, or
schedule/money write.
