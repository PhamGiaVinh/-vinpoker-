import { findScoredDecision, pickScoringSnapshot } from "@/lib/series-intelligence/captureScoring";
import type { UseSeriesCapture } from "@/lib/series-intelligence/useSeriesCapture";
import { DecisionTimeline } from "./DecisionTimeline";
import { OutcomeScorecard } from "./OutcomeScorecard";
import { DecisionSection } from "./DecisionSection";
import { ForecastSection } from "./ForecastSection";
import { CampaignSection } from "./CampaignSection";
import { RegistrationSection } from "./RegistrationSection";

/**
 * The full "learning loop" for one event: timeline → scorecard → decisions → forecasts → marketing → funnel.
 * Filters the club-scoped rows from the hook down to this event, then wires each section to the hook mutations.
 */
export function EventLoopPanel({ eventId, hook }: { eventId: string; hook: UseSeriesCapture }) {
  const snaps = hook.snapshots.filter((s) => s.event_id === eventId);
  const decs = hook.decisions.filter((d) => d.event_id === eventId);
  const camps = hook.campaigns.filter((c) => c.event_linked === eventId);
  const regs = hook.registrations.filter((r) => r.event_id === eventId);

  const scored = findScoredDecision(decs);
  const scoringSnap = pickScoringSnapshot(snaps, scored);

  return (
    <div className="space-y-4">
      <DecisionTimeline snapshots={snaps} decisions={decs} />
      <OutcomeScorecard snapshot={scoringSnap} scored={scored} />
      <DecisionSection
        eventId={eventId}
        decisions={decs}
        snapshots={snaps}
        saving={hook.saving}
        insertDecision={hook.insertDecision}
        updateDecision={hook.updateDecision}
      />
      <ForecastSection eventId={eventId} snapshots={snaps} saving={hook.saving} insertForecast={hook.insertForecast} />
      <CampaignSection
        eventId={eventId}
        campaigns={camps}
        saving={hook.saving}
        insertCampaign={hook.insertCampaign}
        updateCampaign={hook.updateCampaign}
      />
      <RegistrationSection eventId={eventId} registrations={regs} saving={hook.saving} insertRegistration={hook.insertRegistration} />
    </div>
  );
}
