# td-ai-assistant — TD AI advisor (provider-agnostic)

Advisory assistant for floor/TD staff: table rulings, tournament operations,
floor procedure and basic strategy. **Advisory only — never an official ruling.**

Flow: `auth (real user) → role gate (staff/club-admin) → zod validate → keyword
retrieval over rules-index.json → below-threshold short-circuit (no model call)
→ provider model (callModel) → deterministic no-hallucination validator →
TdAnswer`.

## Provider configuration (Edge secrets — NOT hardcoded)

No Lovable. The provider and model are chosen at runtime by Edge secrets, so you
can switch providers without a code change.

| Secret | Required? | Purpose |
| --- | --- | --- |
| `TD_AI_PROVIDER` | optional | `gemini` (default) · `groq` · `openrouter` |
| `TD_AI_MODEL` | optional | Overrides the per-provider default model |
| `GEMINI_API_KEY` | for `gemini` | Google AI Studio key (`AIza…`) — free tier |
| `GROQ_API_KEY` | for `groq` | Groq Cloud key (OpenAI-compatible) |
| `OPENROUTER_API_KEY` | for `openrouter` | OpenRouter key (OpenAI-compatible) |

Per-provider default model (overridable by `TD_AI_MODEL`):

- `gemini` → `gemini-2.5-flash`
- `groq` → `llama-3.3-70b-versatile`
- `openrouter` → `google/gemini-2.0-flash-exp:free`

### Preferred: Gemini direct (Google AI Studio free tier)

1. Get a key at <https://aistudio.google.com/apikey> (looks like `AIza…`).
2. Set it as an Edge secret (do **not** paste keys into chat/PRs/commits):
   - **Supabase dashboard** → Project → Edge Functions → **Secrets** → add
     `GEMINI_API_KEY`. Optionally add `TD_AI_PROVIDER=gemini` and a
     `TD_AI_MODEL`.
   - Or CLI: `supabase secrets set GEMINI_API_KEY=...  TD_AI_PROVIDER=gemini`
3. Deploy the function (see below). Done.

## Deploy

The production workflow (`.github/workflows/vbackerworkflowmain.yml` →
**Deploy Edge Functions**) deploys `td-ai-assistant` automatically on every push
to `main`, with `--no-verify-jwt` (the function enforces its own auth + role
gate). Manual deploy:

```
supabase functions deploy td-ai-assistant --no-verify-jwt
```

Secrets are runtime config and are **separate** from deploying code — set them
once (above); they persist across deploys.

## Fallback behavior (UI never crashes)

`callModel` returns `ok:false` on **any** failure — missing/!valid key, unknown
provider, quota/`429`, network error, malformed model JSON. `index.ts` then
returns an error and the frontend hook (`useTdAi`) falls back to the **offline
keyword corpus** (`src/lib/tdai/*`). So even with no key set, the panel works
(offline lookup, labelled accordingly). Below-retrieval-threshold situations
never call a model and return the "not enough basis" template.

## No-hallucination guard (kept)

`logic.ts validateAnswer` runs after the model and is the actual guarantee:
drops any citation whose ruleId is not in the retrieved set, flags fabricated
rule numbers (forces confidence `low`), and returns the no-basis template when
no valid citation remains. The model is instructed (callModel `SYSTEM`) to cite
only retrieved ruleIds; the validator enforces it regardless. Operations / floor
/ strategy answers are labelled advisory.

## Edge secret checklist

- [ ] `GEMINI_API_KEY` set (or `GROQ_API_KEY` / `OPENROUTER_API_KEY` for those providers)
- [ ] (optional) `TD_AI_PROVIDER` set if not using the `gemini` default
- [ ] (optional) `TD_AI_MODEL` set if overriding the default model
- [ ] Function deployed (workflow on merge, or manual `functions deploy`)
- [ ] `LOVABLE_API_KEY` is **no longer used** by this function (safe to leave or remove)
- [ ] Smoke test: a staff-auth request returns `source:"ai"`; on quota/error it falls back to `source:"local"`
