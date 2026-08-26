import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { centerPointEvents, type CenterPointEvent } from "../centerPointContent";

type EventCarouselProps = {
  onDetails: (event: CenterPointEvent) => void;
};

export function EventCarousel({ onDetails }: EventCarouselProps) {
  const [startIndex, setStartIndex] = useState(0);
  const visibleEvents = centerPointEvents.map((_, offset) => centerPointEvents[(startIndex + offset) % centerPointEvents.length]);

  const rotate = (direction: -1 | 1) => {
    setStartIndex((current) => (current + direction + centerPointEvents.length) % centerPointEvents.length);
  };

  return (
    <section className="cp-events" id="events" data-cp-section="events" aria-labelledby="center-point-events-heading">
      <div className="cp-shell">
        <div className="cp-section-heading cp-section-heading--center">
          <span>Season 3 schedule</span>
          <h2 id="center-point-events-heading">Upcoming Events</h2>
        </div>
        <div className="cp-event-carousel" aria-roledescription="carousel" aria-label="Upcoming events">
          <Button className="cp-carousel-control cp-carousel-control--previous" variant="ghost" size="icon" type="button" onClick={() => rotate(-1)} aria-label="Show previous events"><ChevronLeft aria-hidden="true" /></Button>
          <div className="cp-event-grid">
            {visibleEvents.map((event) => (
              <Card className={`cp-event-card ${event.featured ? "cp-event-card--featured" : ""}`} key={event.id}>
                {event.badge && <span className="cp-event-card__badge">{event.badge}</span>}
                <p className="cp-event-card__category">{event.category}</p>
                <h3>{event.name}</h3>
                <p className="cp-event-card__price">{event.priceLabel}</p>
                <p className="cp-event-card__caption">{event.priceCaption}</p>
                <dl><div><dt>Structure</dt><dd>{event.levelLabel}</dd></div><div><dt>Dates</dt><dd>{event.dateLabel}</dd></div></dl>
                <Button className="cp-button cp-button--card" variant="ghost" type="button" onClick={() => onDetails(event)}>View details</Button>
              </Card>
            ))}
          </div>
          <Button className="cp-carousel-control cp-carousel-control--next" variant="ghost" size="icon" type="button" onClick={() => rotate(1)} aria-label="Show next events"><ChevronRight aria-hidden="true" /></Button>
        </div>
      </div>
    </section>
  );
}
