# "Tạo từ ảnh lịch" — switch off Lovable to direct Google Gemini · runbook

The `parse-tournament-schedule` Edge Function used to call the **Lovable AI gateway**
(`ai.gateway.lovable.dev`) and required a `LOVABLE_API_KEY` secret. The owner no longer uses
Lovable and that secret is **not set** on the live project (verified: 24 secrets, none is
`LOVABLE_API_KEY`) — so every "Tạo từ ảnh lịch" call currently 500s, surfaced in the UI as the
generic *"Edge Function returned a non-2xx status code"*.

This change rewrites the function to call **Google's Generative Language API directly**
(native `generateContent` + structured `responseSchema`, model `gemini-2.5-flash`) using a
self-owned **`GEMINI_API_KEY`**. No third-party gateway. The request/response contract is
unchanged, so the two frontend callers (`src/components/floor/BulkScheduleDialog.tsx`,
`src/pages/BulkCreateTournaments.tsx`) work with **no frontend change**.

## What the owner must do (config — cannot be done from code)
1. Get a **free** Gemini API key at **Google AI Studio** → https://aistudio.google.com → *Get API key*.
2. Supabase Dashboard → the VinPoker project (`orlesggcjamwuknxwcpk`) → **Edge Functions → Secrets**
   (a.k.a. *Project Settings → Edge Functions*) → **Add new secret**:
   - Name: `GEMINI_API_KEY`
   - Value: the key from step 1
   (Optional: `GEMINI_MODEL` to override the default `gemini-2.5-flash`.)
   Do **not** paste the key into chat / code / PRs.

## Controlled deploy (owner-gated — CI does NOT deploy this function)
`parse-tournament-schedule` is **not** in the CI Edge-deploy list in
`.github/workflows/vbackerworkflowmain.yml`, so merging the PR does NOT redeploy it. Deploy it
manually (same Management-API multipart method used for `compute-payouts` in prior sessions):
- `POST https://api.supabase.com/v1/projects/orlesggcjamwuknxwcpk/functions/deploy?slug=parse-tournament-schedule`
  with the entrypoint `parse-tournament-schedule/index.ts` + `_shared/validate.ts`, `verify_jwt: true`
  (unchanged from the current v32).
- Order: (a) owner adds `GEMINI_API_KEY` secret → (b) controlled Edge deploy → (c) smoke: upload a
  real schedule photo in "Tạo từ ảnh lịch", confirm tournaments are extracted (or a clear error if
  the key/quota is wrong).

## Error messages the owner may now see (all shown clearly in the UI, not "non-2xx")
- "Chưa cấu hình AI đọc ảnh (thiếu GEMINI_API_KEY)…" → the secret isn't set yet (do the steps above).
- "Khoá GEMINI_API_KEY không hợp lệ hoặc chưa bật quyền (401/403)…" → wrong/disabled key.
- "Hết hạn mức hoặc quá nhiều yêu cầu Gemini … (429)" → free-tier rate/quota; wait or raise quota.
- "Ảnh không hợp lệ hoặc yêu cầu sai (400)…" → try a clearer PNG/JPG.

## Rollback
Revert this PR + redeploy the prior (Lovable) `parse-tournament-schedule` and set `LOVABLE_API_KEY`
again. No DB or schema involved.

## Verify done in source-only PR
- `deno check` on the rewritten function: clean.
- No DB / migration / schema change. No frontend contract change (only a stale code comment updated).
- Cannot be end-to-end tested without the owner's key — the deploy + real-image smoke is the
  owner-gated verification step above.
