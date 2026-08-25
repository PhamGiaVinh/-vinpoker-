import { useEffect, useState } from "react";
import "./center-point-poker-masters/centerPointPokerMasters.css";
import { CenterPointDialog, type CenterPointDialogState } from "./center-point-poker-masters/components/CenterPointDialog";
import { CenterPointFooter } from "./center-point-poker-masters/components/CenterPointFooter";
import { CenterPointHeader } from "./center-point-poker-masters/components/CenterPointHeader";
import { CenterPointHero } from "./center-point-poker-masters/components/CenterPointHero";
import { CenterPointShowcase } from "./center-point-poker-masters/components/CenterPointShowcase";
import { EventCarousel } from "./center-point-poker-masters/components/EventCarousel";
import type { CenterPointEvent, CenterPointNews } from "./center-point-poker-masters/centerPointContent";

export default function CenterPointPokerMastersPage() {
  const [activeSection, setActiveSection] = useState("home");
  const [dialog, setDialog] = useState<CenterPointDialogState | null>(null);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return undefined;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-cp-section]"));
    const observer = new IntersectionObserver((entries) => {
      const visibleEntry = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visibleEntry) setActiveSection((visibleEntry.target as HTMLElement).dataset.cpSection ?? "home");
    }, { rootMargin: "-20% 0px -65% 0px", threshold: [0.05, 0.2, 0.5] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const navigateTo = (target: string) => {
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openEventDetails = (event: CenterPointEvent) => setDialog({ type: "event", event });
  const openNews = (news: CenterPointNews) => setDialog({ type: "news", news });

  return (
    <div className="cp-page">
      <CenterPointHeader activeSection={activeSection} onNavigate={navigateTo} onRegister={() => setDialog({ type: "registration" })} />
      <main>
        <CenterPointHero onRegister={() => setDialog({ type: "registration" })} onSchedule={() => navigateTo("events")} />
        <EventCarousel onDetails={openEventDetails} />
        <CenterPointShowcase onGallery={() => setDialog({ type: "gallery" })} onLeaderboard={() => setDialog({ type: "leaderboard" })} onNews={openNews} />
      </main>
      <CenterPointFooter onNavigate={navigateTo} />
      <CenterPointDialog dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
