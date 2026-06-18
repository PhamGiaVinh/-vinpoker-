// Public/private visibility contract. PUBLIC = identity / achievement / aspiration
// only. Leaks, odds, training, category scores, suggested events stay PRIVATE.
// (At MVP 2 the same contract is enforced server-side, deny-by-default.)
import { Archetype, DrillResult, ProfileConfidence } from "./types";

export interface PublicProfile {
  grade: string;
  archetype: Archetype;
  isProvisional: boolean;
  confidence: ProfileConfidence;
}

export function toPublicProfile(r: DrillResult): PublicProfile {
  return {
    grade: r.grade,
    archetype: r.archetype,
    isProvisional: r.isProvisional,
    confidence: r.confidence,
  };
}
