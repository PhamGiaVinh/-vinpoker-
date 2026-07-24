import {
  classifyPostgrestError,
  postgrestHttpStatus,
} from "./postgrestError.ts";

export interface CandidateSnapshotFailureDiagnostic {
  component: "candidate_snapshot";
  stage: string;
  status: "query_failed" | "dependency_unavailable";
  provider_code: string;
  http_status: number | null;
  input_count_bucket: string;
  duration_bucket: string;
  fingerprint: string;
}

export function inputCountBucket(inputCount: number): string {
  if (inputCount <= 0) return "zero";
  if (inputCount === 1) return "one";
  if (inputCount <= 10) return "two_to_ten";
  if (inputCount <= 25) return "eleven_to_twenty_five";
  if (inputCount <= 50) return "twenty_six_to_fifty";
  if (inputCount <= 100) return "fifty_one_to_one_hundred";
  if (inputCount <= 200) return "one_hundred_one_to_two_hundred";
  return "over_two_hundred";
}

export function durationBucket(durationMs: number): string {
  if (durationMs < 25) return "under_25ms";
  if (durationMs < 100) return "25ms_to_99ms";
  if (durationMs < 500) return "100ms_to_499ms";
  if (durationMs < 2_000) return "500ms_to_1999ms";
  return "2s_or_more";
}

export function candidateSnapshotFailureDiagnostic(
  stage: string,
  error: unknown,
  inputCount: number,
  durationMs: number,
): CandidateSnapshotFailureDiagnostic {
  const { status, sanitizedCode } = classifyPostgrestError(error);
  const httpStatus = postgrestHttpStatus(error);
  const inputBucket = inputCountBucket(inputCount);

  return {
    component: "candidate_snapshot",
    stage,
    status,
    provider_code: sanitizedCode,
    http_status: httpStatus,
    input_count_bucket: inputBucket,
    duration_bucket: durationBucket(durationMs),
    fingerprint: `${stage}|${sanitizedCode}|${httpStatus ?? "none"}|${inputBucket}`,
  };
}
