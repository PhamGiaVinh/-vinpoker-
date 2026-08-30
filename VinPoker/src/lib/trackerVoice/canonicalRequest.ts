import type { TrackerWorkflowState, WorkflowStreet } from "@/components/cashier/tournament-live/handinput/trackerWorkflow";

/**
 * Wire contract for the explicitly enabled Assist domains. Each payload stays
 * discriminated so no domain can smuggle optional fields from another writer.
 */
export type VoiceIntentDomain = "action" | "board" | "hole_cards" | "finish_hand";

export type VoiceActionIntentPayload = {
  canonicalAction: "fold" | "check" | "call" | "bet" | "raise" | "all_in";
  actorPlayerId: string;
  entryNumber: number;
  seatNumber: number;
  street: WorkflowStreet;
  actionAmount: number;
  actionOrder: number;
};

export type VoiceCanonicalEnvelope = {
  expectedStateVersion: string;
  expectedWorkflowState: TrackerWorkflowState;
  expectedStreet: WorkflowStreet;
  payloadHash: string;
  rawTranscriptHash: string;
};

export type VoiceActionCanonicalRequest = {
  intentDomain: "action";
  envelope: VoiceCanonicalEnvelope;
  payload: VoiceActionIntentPayload;
};

export type VoiceBoardIntentPayload = {
  street: "flop" | "turn" | "river";
  newCards: readonly string[];
  cumulativeCards: readonly string[];
  expectedExistingBoardCount: 0 | 3 | 4;
};

export type VoiceBoardCanonicalRequest = {
  intentDomain: "board";
  envelope: VoiceCanonicalEnvelope;
  payload: VoiceBoardIntentPayload;
};

export type VoiceHoleCardsIntentPayload = {
  seatNumber: number;
  expectedPlayerId: string;
  expectedEntryNumber: number;
  cards: readonly [string, string];
};

export type VoiceHoleCardsCanonicalRequest = {
  intentDomain: "hole_cards";
  envelope: VoiceCanonicalEnvelope;
  payload: VoiceHoleCardsIntentPayload;
};

export type VoiceFinishIntentPayload = {
  settlementOrigin: "engine_fold_win" | "engine_showdown";
  settlementDigest: string;
};

export type VoiceFinishCanonicalRequest = {
  intentDomain: "finish_hand";
  envelope: VoiceCanonicalEnvelope;
  payload: VoiceFinishIntentPayload;
};

export type VoiceCanonicalRequest =
  | VoiceActionCanonicalRequest
  | VoiceBoardCanonicalRequest
  | VoiceHoleCardsCanonicalRequest
  | VoiceFinishCanonicalRequest;

export function actionWorkflowForStreet(street: WorkflowStreet): TrackerWorkflowState | null {
  switch (street) {
    case "preflop": return "preflop_action";
    case "flop": return "flop_action";
    case "turn": return "turn_action";
    case "river": return "river_action";
    default: return null;
  }
}

export function canonicalizeVoiceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeVoiceValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalizeVoiceValue(record[key])]),
    );
  }
  return value;
}

export function canonicalVoiceJson(value: unknown): string {
  return JSON.stringify(canonicalizeVoiceValue(value));
}

export async function sha256VoiceText(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256VoiceCanonical(value: unknown): Promise<string> {
  return sha256VoiceText(canonicalVoiceJson(value));
}

export async function buildVoiceActionCanonicalRequest(input: {
  rawTranscript: string;
  expectedStateVersion: string;
  expectedWorkflowState: TrackerWorkflowState;
  expectedStreet: WorkflowStreet;
  payload: VoiceActionIntentPayload;
}): Promise<VoiceActionCanonicalRequest> {
  const [payloadHash, rawTranscriptHash] = await Promise.all([
    sha256VoiceCanonical({ intentDomain: "action", payload: input.payload }),
    sha256VoiceText(input.rawTranscript),
  ]);
  return {
    intentDomain: "action",
    envelope: {
      expectedStateVersion: input.expectedStateVersion,
      expectedWorkflowState: input.expectedWorkflowState,
      expectedStreet: input.expectedStreet,
      payloadHash,
      rawTranscriptHash,
    },
    payload: input.payload,
  };
}

export async function buildVoiceBoardCanonicalRequest(input: {
  rawTranscript: string;
  expectedStateVersion: string;
  expectedWorkflowState: TrackerWorkflowState;
  expectedStreet: "flop" | "turn" | "river";
  payload: VoiceBoardIntentPayload;
}): Promise<VoiceBoardCanonicalRequest> {
  const [payloadHash, rawTranscriptHash] = await Promise.all([
    sha256VoiceCanonical({ intentDomain: "board", payload: input.payload }),
    sha256VoiceText(input.rawTranscript),
  ]);
  return {
    intentDomain: "board",
    envelope: {
      expectedStateVersion: input.expectedStateVersion,
      expectedWorkflowState: input.expectedWorkflowState,
      expectedStreet: input.expectedStreet,
      payloadHash,
      rawTranscriptHash,
    },
    payload: input.payload,
  };
}

export async function buildVoiceHoleCardsCanonicalRequest(input: {
  rawTranscript: string;
  expectedStateVersion: string;
  payload: VoiceHoleCardsIntentPayload;
}): Promise<VoiceHoleCardsCanonicalRequest> {
  const [payloadHash, rawTranscriptHash] = await Promise.all([
    sha256VoiceCanonical({ intentDomain: "hole_cards", payload: input.payload }),
    sha256VoiceText(input.rawTranscript),
  ]);
  return {
    intentDomain: "hole_cards",
    envelope: {
      expectedStateVersion: input.expectedStateVersion,
      expectedWorkflowState: "runout_reveal",
      expectedStreet: "showdown",
      payloadHash,
      rawTranscriptHash,
    },
    payload: input.payload,
  };
}

export async function buildVoiceFinishCanonicalRequest(input: {
  rawTranscript: string;
  expectedStateVersion: string;
  payload: VoiceFinishIntentPayload;
}): Promise<VoiceFinishCanonicalRequest> {
  const [payloadHash, rawTranscriptHash] = await Promise.all([
    sha256VoiceCanonical({ intentDomain: "finish_hand", payload: input.payload }),
    sha256VoiceText(input.rawTranscript),
  ]);
  return {
    intentDomain: "finish_hand",
    envelope: {
      expectedStateVersion: input.expectedStateVersion,
      expectedWorkflowState: "submit_ready",
      expectedStreet: "showdown",
      payloadHash,
      rawTranscriptHash,
    },
    payload: input.payload,
  };
}

/** The server compares its own reparse receipt to this untrusted wire object. */
export function voiceCanonicalRequestsMatch(
  candidate: unknown,
  authoritative: VoiceCanonicalRequest,
): boolean {
  return canonicalVoiceJson(candidate) === canonicalVoiceJson(authoritative);
}
