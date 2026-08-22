# Tracker Voice V0: Real Recognition Qualification

## Scope

This is a source-only, non-production qualification surface. It does not
apply a migration, deploy an Edge Function or frontend, change a feature flag,
or write a production action.

The DEV-only route is `/__dev/tracker-voice-uat`. Vite removes both the route
and its lazy component from a production build. It is not linked from normal
application navigation.

## Capability Truth Table

| Capability | Source exists | Automated tested | Real provider measured | Production enabled |
| --- | ---: | ---: | ---: | ---: |
| Final-only transcript to local Shadow proposal | Yes | Yes | No | No |
| Browser/Edge parser parity and amount safety | Yes | Yes, 200-case corpus | No | No |
| Shadow zero canonical action writes | Yes | Yes, fixture E2E | No | No |
| Assist confirmation through the current action handler | Yes | Yes, sanitized fixture | No | No |
| Mock microphone/provider diagnostic | Yes | Yes | Mock only | No |
| OpenAI Realtime WebRTC provider | Yes | Session contract only | No | No |
| Voice session token endpoint | Yes | Protocol only | No non-production deployment | No |

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
4. The OpenAI provider uses browser WebRTC with real microphone constraints:
   echo cancellation, noise suppression and automatic gain control.
5. `tracker-voice-session` mints a short-lived client credential server-side.
   Its configured transcription model is `gpt-live-transcribe`; the browser
   never receives the permanent key.
6. Only `conversation.item.input_audio_transcription.completed` creates a
   proposal. Delta events update partial text only.
7. Poker proposals in Shadow stay local. They do not call voice validation,
   record an event, or invoke the canonical action writer. `Báo sai action`
   and `Gọi Floor` deliberately keep their existing alert path and do not
   record poker actions.
8. Assist waits for a validation receipt and then uses the existing
   `handleVoiceAction` path.

## Database and Runtime Dependencies

The real server path requires the source objects in
`20270112000003_tracker_voice_player_analytics_v0.sql`, including Voice config,
runtime/validation RPCs, event ledger and alert tables. The subsequent P0
authority migrations `20270112000004` through `20270112000007` harden the
existing Tracker action and lock authority paths.

This qualification does not apply any of those migrations. Do not use a broad
migration replay or `--include-all`; historical `202608xx` migration order is
not a valid substitute for an owner-controlled exact apply plan.

## Real Provider Preconditions

The DEV route can select **OpenAI Realtime**, but a real connection is only
measurable after a local or other non-production `tracker-voice-session`
function is running against a compatible disposable schema. The permanent
credential belongs only in that function's secret environment as:

```text
OPENAI_API_KEY
```

Do not place it in `VITE_*`, source, browser storage, screenshots, logs, or
chat. Without the local non-production secret, the correct outcome is
`REAL_PROVIDER_SECRET_REQUIRED`, not a mock success claim.

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

For a real-phone or iPad qualification, run the corpus in quiet and moderate
noise conditions, mark each spoken utterance immediately before speech, and
record command/amount accuracy, false activations, transcript latency and
disconnect/reconnect counts. Keep Auto disabled. A physical device run is not
implied by automated mock E2E.
