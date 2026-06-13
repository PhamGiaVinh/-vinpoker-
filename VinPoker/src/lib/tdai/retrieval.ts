import type { TdRule, TdSituation } from "./types";
import { searchRules, type TdSearchHit } from "./localSearch";

// RAG retrieval for the TD AI edge function. Pure & offline — reuses the PR D
// keyword ranker (searchRules) over the corpus, returns the top-K and a
// below-threshold flag so the edge fn can short-circuit WITHOUT a model call
// when there is nothing solid to reason over (a no-hallucination safeguard).

export const RETRIEVAL_TOP_K = 8;
// Below this top score there is no confident match → skip the LLM entirely.
export const RETRIEVAL_MIN_SCORE = 3;

export interface TdRetrieval {
  hits: TdSearchHit[];
  belowThreshold: boolean;
}

export function situationToQuery(s: TdSituation): string {
  return [s.description, s.actionSequence, s.playersInvolved, s.tableLabel]
    .filter(Boolean)
    .join(" ");
}

export function retrieveRules(
  situation: TdSituation,
  corpus: TdRule[],
  k: number = RETRIEVAL_TOP_K,
): TdRetrieval {
  const ranked = searchRules(situationToQuery(situation), corpus);
  const hits = ranked.slice(0, k);
  const belowThreshold = hits.length === 0 || hits[0].score < RETRIEVAL_MIN_SCORE;
  return { hits, belowThreshold };
}
