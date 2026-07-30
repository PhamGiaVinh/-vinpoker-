import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseVietnamOutcomeIntake,
  runVietnamOutcomeIntakeCli,
  validateVietnamOutcomeIntakeTemplate,
} from "../../../scripts/series-market/validateVietnamOutcomeIntake";

const ROOT = process.cwd().endsWith("VinPoker")
  ? process.cwd()
  : resolve(process.cwd(), "VinPoker");
const TEMPLATE_PATH = resolve(
  ROOT,
  "src/lib/series-market/fixtures/templates/vietnam-outcome-intake.template.json",
);
const tempDirectories: string[] = [];

function templateInput(): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8")) as Record<string, unknown>;
  delete raw.templateOnly;
  delete raw.warning;
  return raw;
}

function outputBuffer() {
  let value = "";
  return {
    stream: { write: (chunk: string | Uint8Array) => {
      value += String(chunk);
      return true;
    } },
    read: () => value,
  };
}

function tempFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "vinpoker-outcome-intake-"));
  tempDirectories.push(directory);
  const path = join(directory, "intake.json");
  writeFileSync(path, contents, "utf8");
  return path;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Vietnam outcome intake strict boundary", () => {
  it("validates the fictional template deterministically", async () => {
    const first = await validateVietnamOutcomeIntakeTemplate();
    const second = await validateVietnamOutcomeIntakeTemplate();
    expect(second).toBe(first);
    expect(first).toContain('"fixtureOnly":true');
    expect(first).toContain('"contractVersion":"v2"');
  });

  it("accepts the exact intake schema and rejects unknown top-level keys", async () => {
    await expect(parseVietnamOutcomeIntake(templateInput())).resolves.toContain(
      '"intakeKey":"fixture.fictional-outcome-intake"',
    );
    await expect(parseVietnamOutcomeIntake({
      ...templateInput(),
      unexpected: true,
    })).rejects.toBeDefined();
  });

  it("rejects unknown nested keys instead of casting them away", async () => {
    const input = templateInput();
    input.source = {
      ...(input.source as Record<string, unknown>),
      trusted: true,
    };
    await expect(parseVietnamOutcomeIntake(input)).rejects.toBeDefined();
  });

  it("rejects private-field literals through a runtime cast", async () => {
    const input = templateInput();
    input.playerIdentifier = "private-player-reference";
    await expect(parseVietnamOutcomeIntake(input))
      .rejects.toMatchObject({ code: "OUTCOME_PRIVATE_FIELD_FORBIDDEN" });
  });

  it("rejects malformed count, money, source, timestamp, and linkage values", async () => {
    const badCount = templateInput();
    const countClaims = badCount.claims as Record<string, unknown>[];
    countClaims[0] = {
      ...countClaims[0],
      value: { type: "integer", value: "59.5" },
    };
    await expect(parseVietnamOutcomeIntake(badCount)).rejects.toBeDefined();

    const badMoney = templateInput();
    const moneyClaims = badMoney.claims as Record<string, unknown>[];
    moneyClaims[1] = {
      ...moneyClaims[1],
      state: "present",
      value: { type: "money", minorUnits: "-1", currency: "VND", scale: 0 },
      extractionStatus: "verified",
    };
    await expect(parseVietnamOutcomeIntake(badMoney)).rejects.toBeDefined();

    const badSource = templateInput();
    badSource.source = {
      ...(badSource.source as Record<string, unknown>),
      sourceIdentity: {
        kind: "public_url",
        url: "https://127.0.0.1/result",
        sha256: null,
        byteLength: null,
        mediaType: null,
      },
    };
    await expect(parseVietnamOutcomeIntake(badSource)).rejects.toBeDefined();

    const badTime = templateInput();
    badTime.source = {
      ...(badTime.source as Record<string, unknown>),
      capturedAt: "2026-08-01 10:00",
    };
    await expect(parseVietnamOutcomeIntake(badTime)).rejects.toBeDefined();

    const badLink = templateInput();
    badLink.linkage = {
      expectedCompetitionKey: "NOT A STABLE KEY",
      sourceDeclaredCompetitionKey: null,
    };
    await expect(parseVietnamOutcomeIntake(badLink)).rejects.toBeDefined();

    const mismatchedLink = templateInput();
    mismatchedLink.source = {
      ...(mismatchedLink.source as Record<string, unknown>),
      expectedCompetitionKey: "fictional-expected-competition",
    };
    await expect(parseVietnamOutcomeIntake(mismatchedLink))
      .rejects.toMatchObject({ code: "OUTCOME_INTAKE_EXPECTED_LINK_MISMATCH" });
  });

  it("rejects fixture identifiers without a fixture marker and vice versa", async () => {
    const missingMarker = templateInput();
    missingMarker.fixtureOnly = false;
    await expect(parseVietnamOutcomeIntake(missingMarker))
      .rejects.toMatchObject({ code: "OUTCOME_FIXTURE_NAMESPACE_MISMATCH" });

    const unreserved = templateInput();
    unreserved.intakeKey = "ordinary-intake";
    await expect(parseVietnamOutcomeIntake(unreserved))
      .rejects.toMatchObject({ code: "OUTCOME_FIXTURE_NAMESPACE_MISMATCH" });
  });

  it("uses the documented CLI exit codes", async () => {
    const validOutput = outputBuffer();
    const validError = outputBuffer();
    await expect(runVietnamOutcomeIntakeCli(
      ["--check-template"],
      validOutput.stream,
      validError.stream,
    )).resolves.toBe(0);
    expect(validOutput.read()).toContain("valid");
    expect(validError.read()).toBe("");

    const usageError = outputBuffer();
    await expect(runVietnamOutcomeIntakeCli(
      [],
      outputBuffer().stream,
      usageError.stream,
    )).resolves.toBe(64);
    expect(usageError.read()).toContain("Usage");

    await expect(runVietnamOutcomeIntakeCli(
      ["--input", resolve(tmpdir(), "vinpoker-does-not-exist.json")],
      outputBuffer().stream,
      outputBuffer().stream,
    )).resolves.toBe(3);

    await expect(runVietnamOutcomeIntakeCli(
      ["--input", tempFile("{not-json}")],
      outputBuffer().stream,
      outputBuffer().stream,
    )).resolves.toBe(2);

    await expect(runVietnamOutcomeIntakeCli(
      ["--input", tempFile(JSON.stringify(templateInput()))],
      outputBuffer().stream,
      outputBuffer().stream,
    )).resolves.toBe(0);
  });
});
