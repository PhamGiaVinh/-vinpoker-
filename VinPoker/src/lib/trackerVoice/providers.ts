import type {
  RealtimeTranscriptionProvider,
  VoiceProviderHandlers,
  VoiceTranscriptEvent,
} from "./types";

export class MockRealtimeTranscriptionProvider implements RealtimeTranscriptionProvider {
  readonly kind = "mock" as const;
  private handlers: VoiceProviderHandlers | null = null;

  async connect(handlers: VoiceProviderHandlers): Promise<void> {
    this.handlers = handlers;
    handlers.onInputDevice?.({ deviceId: "mock-microphone", label: "Mock microphone" });
    handlers.onStatus("listening");
  }

  async disconnect(): Promise<void> {
    this.handlers?.onStatus("idle");
    this.handlers = null;
  }

  emit(transcript: string, options: { final?: boolean; confidence?: number; id?: string } = {}): void {
    if (!this.handlers) throw new Error("mock_provider_not_connected");
    const event: VoiceTranscriptEvent = {
      providerEventId: options.id ?? crypto.randomUUID(),
      transcript,
      isFinal: options.final ?? true,
      capturedAt: new Date().toISOString(),
      ...(options.confidence === undefined ? {} : { providerConfidence: options.confidence }),
    };
    this.handlers.onTranscript(event);
  }

  emitLevel(rms: number): void {
    if (!this.handlers) throw new Error("mock_provider_not_connected");
    this.handlers.onLevel?.(Math.max(0, Math.min(1, rms)));
  }
}

export interface OpenAIRealtimeSessionCredential {
  clientSecret: string;
  model: string;
  expiresAt: string;
}

export interface OpenAIRealtimeProviderOptions {
  getSessionCredential: () => Promise<OpenAIRealtimeSessionCredential>;
  language?: string;
  prompt?: string;
}

export function createTrackerVoiceOpenAiProvider(
  tournamentId: string,
  tournamentTableId: string,
): RealtimeTranscriptionProvider {
  return new OpenAIRealtimeTranscriptionProvider({
    language: "vi",
    prompt: "Poker actions: fold, check, call, bet, raise, all-in; chip amounts in Vietnamese or English.",
    getSessionCredential: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("tracker-voice-session", {
        body: { tournament_id: tournamentId, tournament_table_id: tournamentTableId },
      });
      if (error || !data?.client_secret || !data?.model || !data?.expires_at) {
        throw new Error(data?.error ?? "Không cấp được phiên Voice cho bàn này.");
      }
      return { clientSecret: data.client_secret, model: data.model, expiresAt: data.expires_at };
    },
  });
}

/**
 * This provider is deliberately isolated to the protected Preview diagnostic.
 * It never reads a production Voice config or invokes a Supabase Edge function.
 */
export function createTrackerVoicePreviewOpenAiProvider(): RealtimeTranscriptionProvider {
  return new OpenAIRealtimeTranscriptionProvider({
    getSessionCredential: async () => {
      const response = await fetch("/api/tracker-voice-uat-session", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null) as {
        client_secret?: unknown;
        model?: unknown;
        expires_at?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || typeof payload?.client_secret !== "string" || typeof payload.model !== "string" || typeof payload.expires_at !== "string") {
        throw new Error(typeof payload?.error === "string" ? payload.error : "preview_voice_session_unavailable");
      }
      return {
        clientSecret: payload.client_secret,
        model: payload.model,
        expiresAt: payload.expires_at,
      };
    },
  });
}

export class OpenAIRealtimeTranscriptionProvider implements RealtimeTranscriptionProvider {
  readonly kind = "openai_realtime" as const;
  private peer: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private channel: RTCDataChannel | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaSource: MediaStreamAudioSourceNode | null = null;
  private levelFrame: number | null = null;
  private handlers: VoiceProviderHandlers | null = null;
  private readonly partialTranscripts = new Map<string, string>();

  constructor(private readonly options: OpenAIRealtimeProviderOptions) {}

  async connect(handlers: VoiceProviderHandlers): Promise<void> {
    this.handlers = handlers;
    handlers.onStatus("requesting_permission");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const audioTrack = this.stream.getAudioTracks()[0];
    handlers.onInputDevice?.({
      deviceId: audioTrack?.getSettings().deviceId ?? null,
      label: audioTrack?.label || null,
    });
    this.startLevelMeter(this.stream);
    handlers.onStatus("connecting");
    const credential = await this.options.getSessionCredential();
    const peer = new RTCPeerConnection();
    this.peer = peer;
    for (const track of this.stream.getTracks()) peer.addTrack(track, this.stream);
    const channel = peer.createDataChannel("oai-events");
    this.channel = channel;
    channel.addEventListener("message", (message) => this.handleProviderMessage(message.data));
    channel.addEventListener("open", () => handlers.onStatus("listening"));
    channel.addEventListener("close", () => handlers.onStatus("offline"));
    peer.addEventListener("connectionstatechange", () => {
      if (peer.connectionState === "disconnected") handlers.onStatus("recovering", "Kết nối microphone đang khôi phục.");
      if (peer.connectionState === "failed") handlers.onStatus("error", "Kết nối Voice bị lỗi. Hãy kết nối lại.");
    });
    this.stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => handlers.onStatus("offline", "Microphone đã ngắt khỏi thiết bị."), { once: true });
    });

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.clientSecret}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });
    if (!response.ok) throw new Error("openai_realtime_connect_failed");
    await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
  }

  async disconnect(): Promise<void> {
    this.channel?.close();
    this.peer?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.levelFrame !== null) cancelAnimationFrame(this.levelFrame);
    this.levelFrame = null;
    this.mediaSource?.disconnect();
    this.analyser?.disconnect();
    await this.audioContext?.close().catch(() => undefined);
    this.mediaSource = null;
    this.analyser = null;
    this.audioContext = null;
    this.channel = null;
    this.peer = null;
    this.stream = null;
    this.partialTranscripts.clear();
    this.handlers?.onStatus("idle");
    this.handlers = null;
  }

  private startLevelMeter(stream: MediaStream): void {
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      this.audioContext = audioContext;
      this.analyser = analyser;
      this.mediaSource = source;
      const samples = new Float32Array(analyser.fftSize);
      const sample = () => {
        if (!this.analyser || !this.handlers) return;
        this.analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const value of samples) energy += value * value;
        this.handlers.onLevel?.(Math.min(1, Math.sqrt(energy / samples.length) * 5));
        this.levelFrame = requestAnimationFrame(sample);
      };
      this.levelFrame = requestAnimationFrame(sample);
    } catch {
      // Meter failure must not disable transcription; the UI reports level as unavailable.
      this.handlers?.onLevel?.(0);
    }
  }

  private handleProviderMessage(raw: unknown): void {
    if (!this.handlers || typeof raw !== "string") return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof event.type === "string" ? event.type : "";
    const isFinal = type === "conversation.item.input_audio_transcription.completed";
    const isPartial = type === "conversation.item.input_audio_transcription.delta";
    if (!isFinal && !isPartial) return;
    const itemId = typeof event.item_id === "string" ? event.item_id : "";
    if (!itemId) return;

    let transcript = "";
    if (isPartial) {
      const nextDelta = typeof event.delta === "string" ? event.delta : "";
      transcript = `${this.partialTranscripts.get(itemId) ?? ""}${nextDelta}`;
      this.partialTranscripts.set(itemId, transcript);
    } else {
      transcript = typeof event.transcript === "string"
        ? event.transcript
        : this.partialTranscripts.get(itemId) ?? "";
      this.partialTranscripts.delete(itemId);
    }
    if (!transcript) return;
    this.handlers.onTranscript({
      providerEventId: itemId,
      transcript,
      isFinal,
      capturedAt: new Date().toISOString(),
    });
  }
}
