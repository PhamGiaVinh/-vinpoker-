import { describe, expect, it } from "vitest";

import {
  createGeminiLiveAudioPayload,
  GEMINI_LIVE_PCM_BATCH_SAMPLES,
  GEMINI_LIVE_PCM_SAMPLE_RATE,
  Pcm16FrameAccumulator,
  pcm16ToLittleEndianBytes,
  pcmBytesToBase64,
  resampleMonoToPcm16,
} from "./geminiPcm";

describe("Gemini Live PCM conversion", () => {
  it("keeps 16 kHz mono samples and does not mutate the source", () => {
    const source = new Float32Array([-1, -0.5, 0, 0.5, 1]);
    const original = [...source];
    expect([...resampleMonoToPcm16(source, GEMINI_LIVE_PCM_SAMPLE_RATE)]).toEqual([-32768, -16384, 0, 16384, 32767]);
    expect([...source]).toEqual(original);
  });

  it("resamples browser-rate mono audio to 16 kHz", () => {
    const source = new Float32Array(48).fill(0.25);
    const result = resampleMonoToPcm16(source, 48_000);
    expect(result).toHaveLength(16);
    expect([...result]).toEqual(new Array(16).fill(8192));
  });

  it("encodes signed PCM16 as little-endian bytes", () => {
    expect([...pcm16ToLittleEndianBytes(new Int16Array([0x1234, -2]))]).toEqual([0x34, 0x12, 0xfe, 0xff]);
  });

  it("encodes PCM bytes as the base64 Gemini Live Blob payload", () => {
    expect(pcmBytesToBase64(new Uint8Array([0x34, 0x12, 0xfe, 0xff]))).toBe("NBL+/w==");
    expect(createGeminiLiveAudioPayload(new Uint8Array([0x34, 0x12, 0xfe, 0xff]))).toEqual({
      data: "NBL+/w==",
      mimeType: "audio/pcm;rate=16000",
    });
  });

  it("sends only bounded 100 ms batches and flushes a final nonempty tail", () => {
    const accumulator = new Pcm16FrameAccumulator();
    expect(accumulator.push(new Int16Array(GEMINI_LIVE_PCM_BATCH_SAMPLES - 1))).toEqual([]);
    const frames = accumulator.push(new Int16Array(2));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(GEMINI_LIVE_PCM_BATCH_SAMPLES);
    expect(accumulator.flush()).toHaveLength(1);
    expect(accumulator.flush()).toBeNull();
  });
});
