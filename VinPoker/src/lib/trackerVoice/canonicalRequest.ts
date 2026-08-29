import type { TrackerWorkflowState, WorkflowStreet } from "@/components/cashier/tournament-live/handinput/trackerWorkflow";

/**
 * Wire contract for the only Assist domain enabled by PR A. Later PRs extend
 * this discriminated union instead of accepting dormant optional payloads.
 */
export type VoiceIntentDomain = "action" | "board";

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

export type VoiceCanonicalRequest = VoiceActionCanonicalRequest | VoiceBoardCanonicalRequest;

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

/** The server compares its own reparse receipt to this untrusted wire object. */
export function voiceCanonicalRequestsMatch(
  candidate: unknown,
  authoritative: VoiceCanonicalRequest,
): boolean {
  return canonicalVoiceJson(candidate) === canonicalVoiceJson(authoritative);
}
