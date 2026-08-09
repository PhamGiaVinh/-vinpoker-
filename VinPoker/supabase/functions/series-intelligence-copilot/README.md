# V Copilot Edge V1

Source-only server provider for Series Intelligence. The browser sends only a
club ID, owner question, and selected option IDs. The function authenticates
the user, reads Club Pulse through the fixed user-context RPC, redacts protected
cohorts before hashing or provider export, and returns only validated
`series-v-response-v1` output.

## Required server environment

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SERIES_GEMINI_API_KEY`
- `SERIES_GEMINI_MODEL` using one explicit model ID, never a `latest` alias

Do not use a browser environment variable or a key previously exposed in chat.

## Production blockers

- The default schedule source fails closed until a reviewed, server-side
  candidate schedule catalog is wired. Mock PR1 candidates are not numerical
  truth and are never sent to Gemini.
- The V1 limiter is process-local and is not globally durable across Edge
  isolates. Production rollout requires an approved durable limiter or an
  explicit owner acceptance of a bounded canary policy.
- Club Pulse migration, live RPC verification, new Gemini secret provisioning,
  Edge deployment, authenticated Preview UAT, and both feature flags remain
  separate owner gates.

No source in this directory authorizes a DB apply, Edge deploy, flag-on, or
schedule/money write.
