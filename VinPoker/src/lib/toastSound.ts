// Globally attaches sound effects to every sonner `toast.*` call.
// Imported once from src/App.tsx — no per-component changes required.
import { toast } from "sonner";
import {
  playSuccessSound,
  playErrorSound,
  playInfoSound,
  playWarningSound,
} from "./notifySound";

let installed = false;

type ToastFn = (...args: any[]) => any;

const wrap = (fn: ToastFn, sound: () => void): ToastFn => {
  const wrapped: ToastFn = (...args: any[]) => {
    try {
      sound();
    } catch {
      // never let audio break a toast
    }
    return fn(...args);
  };
  // Preserve any properties attached to the original (rare, but safe).
  Object.assign(wrapped, fn);
  return wrapped;
};

export const installToastSounds = () => {
  if (installed) return;
  installed = true;

  const t = toast as any;

  if (typeof t.success === "function") t.success = wrap(t.success.bind(toast), playSuccessSound);
  if (typeof t.error === "function") t.error = wrap(t.error.bind(toast), playErrorSound);
  if (typeof t.warning === "function") t.warning = wrap(t.warning.bind(toast), playWarningSound);
  if (typeof t.info === "function") t.info = wrap(t.info.bind(toast), playInfoSound);
  if (typeof t.message === "function") t.message = wrap(t.message.bind(toast), playInfoSound);
};
