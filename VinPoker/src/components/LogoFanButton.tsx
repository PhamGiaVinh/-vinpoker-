import { useRef, useState } from "react";
import { AnimatePresence, motion, PanInfo } from "framer-motion";
import { QrCode, Spade } from "lucide-react";

import appLogo from "@/assets/app-logo.png";

interface Props {
  onQR: () => void;
  onPoker: () => void;
}

/**
 * Center logo (fixed) on mobile bottom nav.
 * - Tap → backdrop blurs, 2 big diagonal option cards appear (QR + Vào bàn chơi)
 * - Tap option / swipe ↖ / swipe ↗ → fire that branch
 * - Tap backdrop or logo again → close
 */
export function LogoFanButton({ onQR, onPoker }: Props) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<"qr" | "poker" | null>(null);
  const movedRef = useRef(false);

  const fire = (which: "qr" | "poker") => {
    setTrigger(which);
    window.setTimeout(() => {
      setOpen(false);
      setTrigger(null);
      if (which === "qr") onQR();
      else onPoker();
    }, 200);
  };

  const handlePanEnd = (_: unknown, info: PanInfo) => {
    const { x: dx, y: dy } = info.offset;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx < 24 && ady < 24) {
      movedRef.current = false;
      return;
    }
    movedRef.current = true;
    // Open first so the visuals show during the brief fire delay
    if (dx < -24 && dy < 20) {
      setOpen(true);
      fire("qr");
    } else if (dx > 24 && dy < 20) {
      setOpen(true);
      fire("poker");
    }
  };

  return (
    <div className="relative col-start-3">
      {/* Backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-md"
          />
        )}
      </AnimatePresence>

      {/* Branch cards */}
      <AnimatePresence>
        {open && (
          <>
            {/* QR — top-left (symmetric) */}
            <motion.button
              key="branch-qr"
              type="button"
              onClick={() => fire("qr")}
              initial={{ opacity: 0, x: 0, y: 0, scale: 0.3 }}
              animate={{
                opacity: trigger === "poker" ? 0 : 1,
                x: -96,
                y: -120,
                scale: trigger === "qr" ? 1.18 : 1,
              }}
              exit={{ opacity: 0, x: 0, y: 0, scale: 0.3 }}
              transition={{ type: "spring", stiffness: 340, damping: 22 }}
              className="absolute left-1/2 -translate-x-1/2 -ml-[26px] -top-2 z-50 flex flex-col items-center gap-1.5"
              aria-label="QR thành viên"
            >
              <div className="w-[72px] h-[72px] rounded-2xl bg-card border-2 border-primary shadow-[0_0_28px_hsl(var(--primary)/0.7)] flex items-center justify-center text-primary">
                <QrCode className="w-8 h-8" />
              </div>
              <span className="text-[12px] font-extrabold text-primary whitespace-nowrap drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
                QR thành viên
              </span>
            </motion.button>

            {/* PLAY — top-right (symmetric) */}
            <motion.button
              key="branch-poker"
              type="button"
              onClick={() => fire("poker")}
              initial={{ opacity: 0, x: 0, y: 0, scale: 0.3 }}
              animate={{
                opacity: trigger === "qr" ? 0 : 1,
                x: 96,
                y: -120,
                scale: trigger === "poker" ? 1.18 : 1,
              }}
              exit={{ opacity: 0, x: 0, y: 0, scale: 0.3 }}
              transition={{ type: "spring", stiffness: 340, damping: 22, delay: 0.03 }}
              className="absolute left-1/2 -translate-x-1/2 -ml-[26px] -top-2 z-50 flex flex-col items-center gap-1.5"
              aria-label="Vào bàn chơi"
            >
              <div className="w-[72px] h-[72px] rounded-2xl bg-card border-2 border-accent shadow-[0_0_28px_hsl(var(--accent)/0.7)] flex items-center justify-center text-accent">
                <Spade className="w-8 h-8" />
              </div>
              <span className="text-[12px] font-extrabold text-accent whitespace-nowrap drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
                Vào bàn chơi
              </span>
            </motion.button>
          </>
        )}
      </AnimatePresence>

      {/* Pulsing neon halo behind the logo (visual catch). Sibling, not a child —
          the button itself is overflow-hidden so an inner ping would be clipped. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 -ml-[32px] -top-[24px] z-40 w-[64px] h-[64px] rounded-full ring-2 ring-primary/40 animate-ping"
      />

      {/* Center logo (FIXED — no drag, no rotate) */}
      <motion.button
        type="button"
        onClick={() => {
          if (movedRef.current) {
            movedRef.current = false;
            return;
          }
          setOpen((v) => !v);
        }}
        onPan={(_, info) => {
          if (Math.abs(info.offset.x) > 6 || Math.abs(info.offset.y) > 6) {
            movedRef.current = true;
          }
        }}
        onPanEnd={handlePanEnd}
        whileTap={{ scale: 0.92 }}
        animate={open ? { scale: 1.08 } : { scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 22 }}
        aria-label="Menu nhanh"
        aria-expanded={open}
        className="absolute left-1/2 -translate-x-1/2 -ml-[32px] -top-[24px] z-50 w-[64px] h-[64px] rounded-full bg-gradient-to-b from-background to-card ring-[2.5px] ring-primary shadow-[0_0_28px_hsl(var(--primary)/0.9),0_6px_18px_rgba(0,0,0,0.6)] flex items-center justify-center overflow-hidden touch-none select-none"
      >
        <img
          src={appLogo}
          alt="VBacker"
          className="w-11 h-11 object-contain pointer-events-none drop-shadow-[0_0_6px_hsl(var(--primary)/0.6)]"
          draggable={false}
        />

      </motion.button>
    </div>
  );
}
