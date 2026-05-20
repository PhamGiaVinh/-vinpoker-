// Lightweight chat-notification chime via Web Audio API (no asset required).
let ctx: AudioContext | null = null;
let unlockBound = false;

const getCtx = () => {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Bind a one-time gesture listener so AudioContext is unlocked even on
  // public pages (auth, verify-email, ...) before the user signs in.
  if (!unlockBound && typeof window !== "undefined") {
    unlockBound = true;
    const unlock = () => {
      try { ctx?.resume(); } catch { /* ignore */ }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: false });
    window.addEventListener("keydown", unlock, { once: false });
    window.addEventListener("touchstart", unlock, { once: false });
  }
  return ctx;
};

// Eagerly create + arm unlock listeners as soon as this module loads,
// so the very first toast on a public page can play sound.
if (typeof window !== "undefined") {
  try { getCtx(); } catch { /* ignore */ }
}

export const playNotifySound = () => {
  try {
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume().catch(() => {});

    const now = ac.currentTime;
    const tone = (freq: number, start: number, dur = 0.18, vol = 0.6) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };

    tone(880, 0);       // ping
    tone(1320, 0.12);   // higher echo
  } catch {
    // ignore
  }
};

// Distinct chime for system notifications (bell-like, two descending tones).
export const playAlertSound = () => {
  try {
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume().catch(() => {});

    const now = ac.currentTime;
    const tone = (freq: number, start: number, dur = 0.25, vol = 0.6) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };

    tone(1175, 0);      // D6
    tone(1568, 0.14);   // G6
    tone(1175, 0.30, 0.32);  // D6 tail
  } catch {
    // ignore
  }
};

// Cheerful upward arpeggio for success toasts — C6→E6→G6 bright chime
export const playSuccessSound = () => {
  try {
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume().catch(() => {});

    const now = ac.currentTime;
    const tone = (freq: number, start: number, dur = 0.16, vol = 0.6) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };

    tone(1047, 0);       // C6
    tone(1319, 0.09);    // E6
    tone(1568, 0.18, 0.22); // G6
  } catch {
    // ignore
  }
};

// Low descending tones for error toasts.
export const playErrorSound = () => {
  try {
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume().catch(() => {});

    const now = ac.currentTime;
    const tone = (freq: number, start: number, dur = 0.22, vol = 0.6) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };

    tone(330, 0);        // E4
    tone(247, 0.14, 0.30); // B3
  } catch {
    // ignore
  }
};

// Soft single ping for info/default toasts.
export const playInfoSound = () => {
  try {
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume().catch(() => {});

    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  } catch {
    // ignore
  }
};

// Two-tone bump for warning toasts.
export const playWarningSound = () => {
  try {
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume().catch(() => {});

    const now = ac.currentTime;
    const tone = (freq: number, start: number, dur = 0.18, vol = 0.5) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };

    tone(587, 0);        // D5
    tone(523, 0.13);     // C5
  } catch {
    // ignore
  }
};
