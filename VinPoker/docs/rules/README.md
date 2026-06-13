# TD AI rules corpus — provenance & versioning

The TD AI assistant (`/components/td-ai`, edge fn `td-ai-assistant`) answers
**advisory only** over this corpus. It is **never an official ruling**.

## What the corpus IS (and is NOT)

- **IS:** club house rules + **plain-language paraphrased summaries** of common
  Tournament Directors Association (TDA) topics, authored in-house.
- **IS NOT:** the official TDA 2024 rulebook text. The `#NN` in labels like
  `Tóm tắt TDA #44` are **topic placeholders, not real TDA rule numbers**, and
  the wording is paraphrase, not verbatim. This avoids reproducing copyrighted
  text and keeps the tool honestly advisory.

Every corpus entry carries `source: "summary" | "house"` and a non-authoritative
`citationKind` (`tda_summary` | `house`). No entry is verbatim TDA text.

## Source of truth & the committed index

- Canonical corpus: `src/lib/tdai/corpus.ts` (`TD_RULES_CORPUS`, `CORPUS_VERSION`).
- The frontend offline fallback (`useTdAi` → `buildLocalAnswer`) imports the
  corpus directly.
- The edge function imports a committed snapshot
  `supabase/functions/td-ai-assistant/rules-index.json` (Deno cannot import the
  Vite-side TS). Both derive from `corpus.ts`, so content cannot diverge.

### Regenerating the index after editing the corpus

```
REGEN=1 npx vitest run src/lib/tdai/rulesIndex.test.ts
```

`rulesIndex.test.ts` rewrites the JSON when `REGEN=1` and otherwise **asserts**
the committed JSON matches `corpus.ts` (CI drift guard). Commit the regenerated
`rules-index.json` alongside the corpus change.

## No-hallucination guarantee

The model is *instructed* to cite only retrieved rules, but the guarantee is
**deterministic code**, not the prompt — `src/lib/tdai/validateAnswer.ts`
(mirrored in the edge fn `logic.ts`):

1. drop any citation whose `ruleId` is not in the retrieved set;
2. scan the prose for rule numbers (`#NN`) not backed by a retrieved rule →
   flag and force `confidence: "low"`;
3. if zero valid citations remain → return the "không đủ căn cứ — cần TD xác
   nhận" template instead of an unbacked synthesized answer.

Below a retrieval score threshold the edge fn **does not call the model at all**.

## Upgrading to official TDA text (future)

Replace/extend entries with `source: "tda"`, real rule numbers, verbatim text +
provenance (edition, URL, license note). The `TdRule`/`TdAnswer` contracts, the
edge function, the validator, and the UI stay unchanged — only the corpus files
and `CORPUS_VERSION` change. Confirm the licensing for reproducing official TDA
text before doing so.
