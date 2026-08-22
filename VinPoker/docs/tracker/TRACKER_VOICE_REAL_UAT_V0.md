# Tracker Voice V0: Real Recognition Qualification

## Scope

This is a source-only, non-production qualification surface. It does not
apply a migration, deploy an Edge Function or frontend, change a feature flag,
or write a production action.

The protected Preview-only route is `/__uat/tracker-voice`. The former
`/__dev/tracker-voice-uat` route remains an alias only while the same explicit
build-time gate is on. Neither route is linked from normal application
navigation.

## Preview Boundary

The route and its lazy component are included only when
`VITE_TRACKER_VOICE_UAT_ENABLED=true` at build time. They are absent from a
normal production build. The Vercel endpoint `/api/tracker-voice-gemini-token`
also returns `404 preview_uat_disabled` unless both
`VERCEL_ENV=preview` and `TRACKER_VOICE_UAT_ENABLED=true` are present.

Vercel Deployment Protection covers the Preview deployment, including
`/api/*`; the owner must sign into Vercel before opening the UAT route. The
endpoint has a small per-requester rate limit and returns only a constrained,
one-use Gemini ephemeral token, model and expiry. It never returns, stores or
logs the permanent API key.

## Capability Truth Table

| Capability | Source exists | Automated tested | Real provider measured | Production enabled |
| --- | ---: | ---: | ---: | ---: |
| Final-only transcript to local Shadow proposal | Yes | Yes | No | No |
| Browser/Edge parser parity and amount safety | Yes | Yes, 200-case corpus | No | No |
| Shadow zero canonical action writes | Yes | Yes, fixture E2E | No | No |
| Assist confirmation through the current action handler | Yes | Yes, sanitized fixture | No | No |
| Mock microphone/provider diagnostic | Yes | Yes | Mock only | No |
| Gemini Live PCM16 provider | Yes | PCM/token contract | No | No |
| OpenAI Realtime WebRTC provider | Yes | Session contract only | No | No |
| Preview-only Gemini token endpoint | Yes | Unit tested | No Preview token yet | No |

The three source flags remain false:

```text
trackerVoiceInput=false
trackerPlayerAnalytics=false
trackerVoiceAutoCommit=false
```

## Current Source Audit

1. The browser parser is active in `src/lib/trackerVoice/parser.ts`.
2. The Edge parser is active in `supabase/functions/_shared/trackerVoiceParser.ts`.
3. Both call `src/lib/trackerVoice/parserCore.ts`; the parity corpus asserts
   command kind, normalized transcript, amount and ambiguity for every row.
4. The Gemini Live provider captures browser microphone audio with echo
   cancellation, noise suppression and automatic gain control. It sends mono
   PCM16 little-endian at 16 kHz directly to Gemini Live using a constrained
   ephemeral token.
5. The deterministic VinPoker parser and proposal resolver remain the only
   components that interpret a final transcript as a poker action. Gemini is
   transcription-only and has no Tracker write path.
6. The Preview token endpoint mints a one-use credential server-side for
   `gemini-3.1-flash-live-preview`; the browser never receives the permanent
   key.
7. The OpenAI provider remains optional for comparison and uses browser WebRTC
   with the same microphone constraints.
8. Only a Gemini `turnComplete` containing input transcription creates a
   proposal. Working transcription updates partial text only.
9. Poker proposals in Shadow stay local. They do not call voice validation,
   record an event, or invoke the canonical action writer. `Báo sai action`
   and `Gọi Floor` deliberately keep their existing alert path and do not
   record poker actions.
10. Assist waits for a validation receipt and then uses the existing
   `handleVoiceAction` path.

## Sanitized Preview Fixture

The UAT page does not call `record_action`, `tracker-voice-session`, a Viewer,
or a Floor alert service. It uses only a browser fixture with four selectable
states: check legal, facing a bet, short-stack all-in, and correction pending.
The fixture calls the shared deterministic parser and proposal resolver, then
leaves all Shadow proposals local. Browser-side measurements can be marked and
exported as JSON/CSV; neither audio nor transcript is persisted.

## Real Provider Preconditions

The protected Preview route defaults to **GEMINI LIVE - MIC THẬT**. It asks for
microphone permission only after the owner presses the connection button. The
permanent credential belongs only in Vercel's **Preview** environment as:

```text
GEMINI_API_KEY
```

Do not place it in `VITE_*`, source, browser storage, screenshots, logs, or
chat. The other required Preview-only variables are:

```text
VITE_TRACKER_VOICE_UAT_ENABLED=true
TRACKER_VOICE_UAT_ENABLED=true
```

Without the Preview-only `GEMINI_API_KEY`, the correct outcome is
`GEMINI_PREVIEW_SECRET_REQUIRED`, not a mock success claim. Production values
remain absent or false and no production deployment is part of this UAT.

## UAT Corpus and Export

`tests/trackerVoice/voiceUatCorpus.ts` defines 200 deterministic utterances:

- 80 simple Fold/Check/Call/All-in variants.
- 80 Bet/Raise amount variants.
- 20 control commands.
- 20 negative/background phrases that must not become poker actions.

The diagnostic console records only browser-side test metadata: selected input
device, final transcript, provider event ID, parser/proposal result, optional
manually marked transcript latency, disconnect/reconnect and device-change
counts, and a human correct/incorrect label. It can export that measurement as
JSON or CSV. It never records audio.

## Required Real-Voice Gate

For a real-phone or iPad qualification, select an expected command only for
scoring, then run the corpus in quiet and moderate noise conditions. Mark the
result immediately after each final transcript and record command/amount
accuracy, false activations, transcript latency and disconnect/reconnect
counts. Keep Auto disabled. A physical device run is not implied by automated
mock E2E.
