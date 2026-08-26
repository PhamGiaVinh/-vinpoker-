import { CalendarDays, ChevronDown, MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { centerPointFeatures, mockCountdownTarget } from "../centerPointContent";

type CenterPointHeroProps = {
  onRegister: () => void;
  onSchedule: () => void;
};

type CountdownValues = { days: string; hours: string; minutes: string; seconds: string; complete: boolean };

function getCountdownValues(target: Date): CountdownValues {
  const remaining = target.getTime() - Date.now();
  if (remaining <= 0) return { days: "00", hours: "00", minutes: "00", seconds: "00", complete: true };

  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return {
    days: String(days).padStart(2, "0"),
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
    complete: false,
  };
}

function EventCountdown() {
  const target = useMemo(() => new Date(mockCountdownTarget), []);
  const [countdown, setCountdown] = useState(() => getCountdownValues(target));

  useEffect(() => {
    const intervalId = window.setInterval(() => setCountdown(getCountdownValues(target)), 1_000);
    return () => window.clearInterval(intervalId);
  }, [target]);

  return (
    <aside className="cp-countdown" aria-live="polite" aria-label="Main event countdown">
      <p>{countdown.complete ? "Main event is underway" : "Main event starts in"}</p>
      <div className="cp-countdown__values">
        {([['days', countdown.days], ['hrs', countdown.hours], ['mins', countdown.minutes], ['secs', countdown.seconds]] as const).map(([label, value]) => (
          <div key={label}><strong>{value}</strong><span>{label}</span></div>
        ))}
      </div>
      <span className="cp-countdown__address"><MapPin aria-hidden="true" />27 Lê Văn Lương, Thanh Xuân, Hà Nội</span>
    </aside>
  );
}

export function CenterPointHero({ onRegister, onSchedule }: CenterPointHeroProps) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  return (
    <>
      <section className="cp-hero" id="home" data-cp-section="home">
        <div className="cp-hero__city" aria-hidden="true" />
        <div className="cp-shell cp-hero__grid">
          <div className="cp-hero__copy">
            <p className="cp-eyebrow">The battle for glory</p>
            <h1><span>Center Point</span>Poker Masters</h1>
            <p className="cp-season">Season <em>3</em></p>
            <p className="cp-hero__intro">Hanoi&apos;s premier poker championship<br />where champions are made</p>
            <div className="cp-hero__ctas">
              <Button className="cp-button cp-button--primary" type="button" onClick={onRegister}>Register now</Button>
              <Button className="cp-button cp-button--secondary" type="button" onClick={onSchedule}><CalendarDays aria-hidden="true" />View schedule</Button>
            </div>
          </div>

          <div
            className="cp-hero__art"
            aria-hidden="true"
            onMouseMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setTilt({ x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 8, y: ((event.clientY - bounds.top) / bounds.height - 0.5) * 8 });
            }}
            onMouseLeave={() => setTilt({ x: 0, y: 0 })}
            style={{ "--cp-art-x": `${tilt.x}px`, "--cp-art-y": `${tilt.y}px` } as CSSProperties}
          >
            <i className="cp-hero__halo" />
            <img src="/center-point/hero-artwork.jpg" width="410" height="355" alt="" />
            <i className="cp-ember cp-ember--one" />
            <i className="cp-ember cp-ember--two" />
            <i className="cp-ember cp-ember--three" />
          </div>

          <EventCountdown />
        </div>
        <a className="cp-scroll-cue" href="#events" aria-label="Scroll to upcoming events"><ChevronDown aria-hidden="true" /></a>
      </section>

      <section className="cp-feature-strip" id="player-guide" data-cp-section="player-guide" aria-label="Player experience highlights">
        <div className="cp-shell cp-feature-strip__grid">
          {centerPointFeatures.map(({ icon: Icon, title, description }) => (
            <article className="cp-feature" key={title}>
              <Icon aria-hidden="true" />
              <div><h2>{title}</h2><p>{description}</p></div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
