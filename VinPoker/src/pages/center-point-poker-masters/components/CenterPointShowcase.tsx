import { ArrowRight, ChevronRight, Medal, Trophy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { centerPointNews, leaderboardGroups, type CenterPointNews } from "../centerPointContent";

type CenterPointShowcaseProps = {
  onGallery: () => void;
  onLeaderboard: () => void;
  onNews: (news: CenterPointNews) => void;
};

type LeaderboardKey = keyof typeof leaderboardGroups;

export function CenterPointShowcase({ onGallery, onLeaderboard, onNews }: CenterPointShowcaseProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardKey>("main");

  return (
    <section className="cp-showcase cp-shell" aria-label="Season highlights">
      <article className="cp-gallery-panel" data-cp-section="champions" id="champions">
        <div className="cp-gallery-panel__art" aria-hidden="true"><img src="/center-point/hero-artwork.jpg" width="410" height="355" alt="" loading="lazy" /></div>
        <div className="cp-gallery-panel__content"><p className="cp-eyebrow">Honour the greats</p><h2>Champion Gallery</h2><p>Legends of Center Point</p><Button className="cp-button cp-button--secondary" type="button" onClick={onGallery}>View champions <ArrowRight aria-hidden="true" /></Button></div>
      </article>

      <article className="cp-leaderboard-panel" id="results" data-cp-section="results">
        <div className="cp-panel-heading"><div><p className="cp-eyebrow">Live leaderboard</p><h2>Main event</h2></div><Medal aria-hidden="true" /></div>
        <Tabs value={leaderboard} onValueChange={(value) => setLeaderboard(value as LeaderboardKey)}>
          <TabsList className="cp-tabs-list" aria-label="Leaderboard event">
            <TabsTrigger className="cp-tabs-trigger" value="main">Main</TabsTrigger>
            <TabsTrigger className="cp-tabs-trigger" value="highRoller">High roller</TabsTrigger>
            <TabsTrigger className="cp-tabs-trigger" value="kickOff">Kick off</TabsTrigger>
          </TabsList>
        </Tabs>
        <table className="cp-leaderboard-table"><caption className="sr-only">{leaderboard} leaderboard</caption><tbody>{leaderboardGroups[leaderboard].map(([name, score], index) => <tr key={name}><th scope="row"><span>{index + 1}</span>{name}</th><td>{score}</td></tr>)}</tbody></table>
        <Button className="cp-button cp-button--card" type="button" onClick={onLeaderboard}>View full leaderboard</Button>
      </article>

      <article className="cp-news-panel" id="news" data-cp-section="news">
        <div className="cp-panel-heading"><div><p className="cp-eyebrow">From the floor</p><h2>News & Updates</h2></div><Trophy aria-hidden="true" /></div>
        <div className="cp-news-list">{centerPointNews.map((news, index) => <button className="cp-news-item" key={news.id} type="button" onClick={() => onNews(news)}><span className={`cp-news-item__thumbnail cp-news-item__thumbnail--${index + 1}`} aria-hidden="true" /><span><strong>{news.title}</strong><small>{news.date}</small></span><ChevronRight aria-hidden="true" /></button>)}</div>
        <Button className="cp-button cp-button--card" type="button" onClick={() => onNews(centerPointNews[0])}>View all news</Button>
      </article>
    </section>
  );
}
