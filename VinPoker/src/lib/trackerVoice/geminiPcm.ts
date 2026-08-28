export const GEMINI_LIVE_PCM_SAMPLE_RATE = 16_000;
export const GEMINI_LIVE_PCM_BATCH_SAMPLES = 1_600;

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Converts Web Audio float samples into the 16 kHz PCM format Gemini Live accepts. */
export function resampleMonoToPcm16(
  source: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = GEMINI_LIVE_PCM_SAMPLE_RATE,
): Int16Array {
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
    throw new Error("invalid_source_sample_rate");
  }
  if (!Number.isFinite(targetSampleRate) || targetSampleRate <= 0) {
    throw new Error("invalid_target_sample_rate");
  }
  if (source.length === 0) return new Int16Array();

  const ratio = sourceSampleRate / targetSampleRate;
  const output = new Int16Array(Math.max(1, Math.floor(source.length / ratio)));

  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    const sourcePosition = outputIndex * ratio;
    const before = Math.min(source.length - 1, Math.floor(sourcePosition));
    const after = Math.min(source.length - 1, before + 1);
    const interpolation = sourcePosition - before;
    const sample = clampSample(source[before] + ((source[after] - source[before]) * interpolation));
    output[outputIndex] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }

  return output;
}

export function pcm16ToLittleEndianBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    bytes[index * 2] = value & 0xff;
    bytes[(index * 2) + 1] = (value >> 8) & 0xff;
  }
  return bytes;
}

/** Encodes browser PCM bytes into the base64 payload required by Gemini Live. */
export function pcmBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function createGeminiLiveAudioPayload(bytes: Uint8Array): {
  data: string;
  mimeType: "audio/pcm;rate=16000";
} {
  return {
    data: pcmBytesToBase64(bytes),
    mimeType: "audio/pcm;rate=16000",
  };
}

/** Accumulates ScriptProcessor fragments into the 100 ms PCM frames Gemini Live expects. */
export class Pcm16FrameAccumulator {
  private pending = new Int16Array();

  push(samples: Int16Array): Int16Array[] {
    if (samples.length === 0) return [];
    const merged = new Int16Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);
    const frames: Int16Array[] = [];
    let offset = 0;
    while (merged.length - offset >= GEMINI_LIVE_PCM_BATCH_SAMPLES) {
      frames.push(merged.slice(offset, offset + GEMINI_LIVE_PCM_BATCH_SAMPLES));
      offset += GEMINI_LIVE_PCM_BATCH_SAMPLES;
    }
    this.pending = merged.slice(offset);
    return frames;
  }

  flush(): Int16Array | null {
    if (this.pending.length === 0) return null;
    const frame = this.pending;
    this.pending = new Int16Array();
    return frame;
  }

  clear(): void {
    this.pending = new Int16Array();
  }
}
