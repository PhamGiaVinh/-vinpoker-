export type PokerLiveSound =
  | "deal"
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all_in"
  | "post_sb"
  | "post_bb"
  | "post_ante";

const MP3_BY_KIND: Partial<Record<PokerLiveSound, string>> = {
  deal: "/sounds/poker/deal-card.mp3",
  call: "/sounds/poker/poker-bet.mp3",
  bet: "/sounds/poker/poker-bet.mp3",
  raise: "/sounds/poker/poker-bet.mp3",
  all_in: "/sounds/poker/poker-bet.mp3",
  post_sb: "/sounds/poker/poker-bet.mp3",
  post_bb: "/sounds/poker/poker-bet.mp3",
  post_ante: "/sounds/poker/poker-bet.mp3",
};

let audioContext: AudioContext | null = null;
let userGestureSeen = false;
let listenersAttached = false;
const lastPlayedAt = new Map<PokerLiveSound, number>();

function ensureGestureListeners() {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;

  const markGesture = () => {
    userGestureSeen = true;
    window.removeEventListener("pointerdown", markGesture);
    window.removeEventListener("keydown", markGesture);
    window.removeEventListener("touchstart", markGesture);
  };

  window.addEventListener("pointerdown", markGesture, { passive: true });
  window.addEventListener("keydown", markGesture);
  window.addEventListener("touchstart", markGesture, { passive: true });
}

function canPlay(kind: PokerLiveSound) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  ensureGestureListeners();
  const now = Date.now();
  const throttleMs = kind === "deal" ? 180 : 70;
  if (now - (lastPlayedAt.get(kind) ?? 0) < throttleMs) return false;
  lastPlayedAt.set(kind, now);
  return userGestureSeen;
}

function playbackRateFor(kind: PokerLiveSound) {
  if (kind === "raise") return 1.05;
  if (kind === "all_in") return 1.12;
  if (kind === "call") return 0.96;
  return 1;
}

function playMp3(kind: PokerLiveSound, src: string) {
  const audio = new Audio(src);
  audio.volume = kind === "deal" ? 0.32 : 0.4;
  audio.playbackRate = playbackRateFor(kind);
  void audio.play().catch(() => {
    if (kind === "fold" || kind === "check") playSynth(kind);
  });
}

function playSynth(kind: PokerLiveSound) {
  if (typeof window === "undefined") return;
  try {
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return;
    audioContext ??= new AudioCtor();

    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = kind === "fold" ? "triangle" : "sine";
    osc.frequency.setValueAtTime(kind === "fold" ? 180 : 520, now);
    gain.gain.setValueAtTime(kind === "fold" ? 0.06 : 0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (kind === "fold" ? 0.14 : 0.08));
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now);
    osc.stop(now + (kind === "fold" ? 0.16 : 0.1));
  } catch {
    // Browser audio can be blocked; the tracker must continue silently.
  }
}

export function markPokerSoundGesture() {
  userGestureSeen = true;
}

export function playPokerLiveSound(kind: PokerLiveSound) {
  if (!canPlay(kind)) return;
  const src = MP3_BY_KIND[kind];
  if (src) {
    playMp3(kind, src);
    return;
  }
  playSynth(kind);
}
