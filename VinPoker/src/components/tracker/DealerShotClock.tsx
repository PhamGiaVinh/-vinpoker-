import { useEffect, useRef, useState } from "react";
import { Pause, Play, Plus, RotateCcw } from "lucide-react";

export function DealerShotClock({ turnKey, playerLabel, active, blocked = false }: {
  turnKey: string; playerLabel: string; active: boolean; blocked?: boolean;
}) {
  const [remaining, setRemaining] = useState(30_000);
  const [running, setRunning] = useState(active);
  const lastTick = useRef(performance.now());
  useEffect(() => {
    setRemaining(30_000);
    setRunning(active);
    lastTick.current = performance.now();
  }, [turnKey, active]);
  useEffect(() => {
    if (!running || blocked) return;
    lastTick.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTick.current;
      lastTick.current = now;
      setRemaining((value) => Math.max(0, value - elapsed));
    }, 100);
    return () => window.clearInterval(timer);
  }, [running, blocked]);
  const seconds = Math.ceil(remaining / 1000);
  const buttonClass = "min-h-11 rounded-xl border border-amber-200/20 bg-white/5 px-3 text-xs font-semibold text-amber-50 inline-flex items-center justify-center gap-2 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200";
  return <section className="dealer-shot-clock" aria-label="Thời gian người chơi">
    <div><h2>THỜI GIAN NGƯỜI CHƠI</h2><p className="mt-1 text-xs text-amber-100/75">{playerLabel}</p></div>
    <div className="mt-3 flex items-center justify-between gap-4">
      <div className="dealer-clock-ring" style={{ background: `conic-gradient(#efbf57 ${Math.min(1, remaining / 30000) * 360}deg, #3c3420 0deg)` }}>
        <div><strong role="timer" aria-label="Shot clock 30 giây">{seconds}</strong><span>giây</span></div>
      </div>
      <div className="grid flex-1 gap-2 max-w-40">
        <button className={buttonClass} disabled={blocked || remaining === 0} onClick={() => setRunning(!running)}>{running ? <Pause size={15} /> : <Play size={15} />}{running ? "Tạm dừng" : "Bắt đầu"}</button>
        <button className={buttonClass} disabled={blocked} onClick={() => setRemaining((value) => value + 30000)}><Plus size={15} />30 giây</button>
        <button className={buttonClass} disabled={blocked} onClick={() => { setRemaining(30000); lastTick.current = performance.now(); }}><RotateCcw size={15} />Đặt lại</button>
      </div>
    </div>
    <p className="mt-2 text-[11px] text-amber-100/60" role="status">{blocked ? "Đang chờ đồng bộ bàn" : seconds === 0 ? "Hết giờ · Dealer xử lý" : "Đồng hồ hỗ trợ · không tự ghi action"}</p>
  </section>;
}
