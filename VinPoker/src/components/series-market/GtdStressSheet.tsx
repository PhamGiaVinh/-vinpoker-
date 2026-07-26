import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Database,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  getGtdStressEventEligibility,
  type GtdStressEventReadModel,
} from "@/lib/series-market/gtdStressUiReadModel";
import { SeriesMarketValidationError } from "@/lib/series-market/normalization";
import type { VerifiedEventRow } from "@/lib/series-market/verifiedMarketReadModel";
import { EvidenceStateBadge } from "./EvidenceStateBadge";

interface GtdStressSheetProps {
  readonly event: VerifiedEventRow | null;
  readonly loadResearch: (eventId: string) => Promise<GtdStressEventReadModel>;
  readonly onOpenChange: (open: boolean) => void;
}

type ResearchReadModel = Extract<GtdStressEventReadModel, { state: "research" }>;
type AvailableScenario = Extract<ResearchReadModel["result"]["scenario"], { state: "available" }>;
type UnavailableScenario = Extract<ResearchReadModel["result"]["scenario"], { state: "unavailable" }>;
type GtdStressUiMoney = AvailableScenario["gtd"];
type GtdStressUiUnavailableReason = UnavailableScenario["unavailableReason"];

type ResearchLoadState =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "loaded"; readonly value: GtdStressEventReadModel }
  | { readonly state: "error"; readonly code: string };

const UNAVAILABLE_COPY: Readonly<Record<GtdStressUiUnavailableReason, string>> = {
  missing_gtd: "GTD evidence is missing.",
  missing_prize_contribution: "Prize contribution evidence is missing.",
  zero_prize_contribution: "Prize contribution per entry is zero.",
  currency_mismatch: "GTD and prize contribution currencies do not match.",
  invalid_scale: "The money scales cannot be normalized exactly.",
  unavailable_historical_distribution: "This event has no eligible historical comparable distribution.",
  conflicting_evidence: "The required public evidence is conflicting.",
};

function errorCode(error: unknown): string {
  return error instanceof SeriesMarketValidationError
    ? error.code ?? "RESEARCH_VALIDATION_FAILED"
    : "RESEARCH_VALIDATION_FAILED";
}

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatMoney(value: GtdStressUiMoney): string {
  const negative = value.minorUnits.startsWith("-");
  const unsigned = negative ? value.minorUnits.slice(1) : value.minorUnits;
  const padded = unsigned.padStart(value.scale + 1, "0");
  const whole = value.scale === 0 ? padded : padded.slice(0, -value.scale);
  const fraction = value.scale === 0 ? "" : `.${padded.slice(-value.scale)}`;
  return `${value.currency} ${negative ? "-" : ""}${groupDigits(whole)}${fraction}`;
}

function SummaryItem({ label, value, kind }: { label: string; value: string; kind: string }) {
  return (
    <div className="min-w-0 border-r border-border/60 px-3 py-3 last:border-r-0">
      <p className="break-words font-mono text-base font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-[10px] uppercase text-muted-foreground/70">{kind}</p>
    </div>
  );
}

function RequirementsMissing({ event }: { event: VerifiedEventRow }) {
  const eligibility = getGtdStressEventEligibility(event);
  return (
    <section
      className="mt-6 border-y border-border/70 py-5"
      aria-labelledby="gtd-stress-requirements"
      data-testid="gtd-stress-requirements"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
        <div>
          <h3 id="gtd-stress-requirements" className="text-sm font-semibold">
            Research inputs are incomplete
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            No partial scenario was calculated. Both source-backed fields below are required.
          </p>
        </div>
      </div>
      <dl className="mt-4 divide-y divide-border/50 border-y border-border/50">
        {eligibility.requirements.map((item) => (
          <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
            <div className="min-w-0">
              <dt className="text-xs font-medium text-foreground">{item.label}</dt>
              <dd className="mt-0.5 break-words text-xs text-muted-foreground">{item.displayValue}</dd>
            </div>
            <EvidenceStateBadge state={item.state} compact />
          </div>
        ))}
      </dl>
    </section>
  );
}

function ScenarioTable({ value }: { value: Extract<GtdStressEventReadModel, { state: "research" }> }) {
  const scenario = value.result.scenario;
  if (scenario.state === "unavailable") {
    return (
      <div
        className="mt-6 border-l-2 border-amber-400/70 bg-amber-500/5 p-4"
        data-testid="gtd-stress-unavailable"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Historical scenario unavailable
        </div>
        <p className="mt-2 text-xs leading-relaxed text-amber-100/80">
          {UNAVAILABLE_COPY[scenario.unavailableReason]} No substitute value was created.
        </p>
      </div>
    );
  }

  return (
    <>
      <section
        className="mt-5 grid grid-cols-2 border-y border-border/70 sm:grid-cols-4"
        aria-label="Historical GTD Stress summary"
      >
        <SummaryItem label={scenario.requiredFieldLabel} value={scenario.requiredEntries} kind="Derived Metric" />
        <SummaryItem label="GTD" value={formatMoney(scenario.gtd)} kind="Observed Evidence" />
        <SummaryItem
          label={scenario.prizeContributionLabel}
          value={formatMoney(scenario.prizeContributionPerEntry)}
          kind="Observed Evidence"
        />
        <SummaryItem label="Comparable events" value={String(value.evidenceN)} kind="Historical Evidence N" />
      </section>

      <section className="mt-6" aria-labelledby="historical-scenarios">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="historical-scenarios" className="text-sm font-semibold">Historical scenarios</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              P10–P90 are historical comparable field quantiles, not calibrated forecast quantiles.
            </p>
          </div>
          <Badge variant="outline" className="border-cyan-500/35 text-cyan-300">
            Historical Benchmark
          </Badge>
        </div>

        <div className="mt-3 hidden overflow-hidden border border-border/80 sm:block">
          <table className="w-full table-fixed text-left text-xs" data-testid="gtd-stress-table">
            <thead className="bg-muted/35 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="w-[10%] px-3 py-2.5 font-medium">Scenario</th>
                <th className="w-[13%] px-3 py-2.5 font-medium">Field</th>
                <th className="w-[24%] px-3 py-2.5 font-medium">Prize contribution</th>
                <th className="w-[21%] px-3 py-2.5 font-medium">Shortfall</th>
                <th className="w-[20%] px-3 py-2.5 font-medium">Surplus</th>
                <th className="w-[12%] px-3 py-2.5 font-medium">Field gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {scenario.quantileScenarios.map((item) => (
                <tr key={item.quantile}>
                  <td className="px-3 py-3 font-mono font-semibold uppercase text-cyan-300">{item.quantile}</td>
                  <td className="px-3 py-3 font-mono">{item.historicalFieldEntries}</td>
                  <td className="break-words px-3 py-3 font-mono">{formatMoney(item.historicalPrizeContribution)}</td>
                  <td className="break-words px-3 py-3 font-mono text-amber-200">{formatMoney(item.shortfall)}</td>
                  <td className="break-words px-3 py-3 font-mono text-emerald-300">{formatMoney(item.surplus)}</td>
                  <td className="px-3 py-3 font-mono">{item.requiredEntriesGap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 divide-y divide-border/60 border-y border-border/70 sm:hidden">
          {scenario.quantileScenarios.map((item) => (
            <section key={item.quantile} className="py-4" aria-label={`${item.quantile} historical scenario`}>
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-mono text-sm font-semibold uppercase text-cyan-300">{item.quantile}</h4>
                <span className="font-mono text-xs">{item.historicalFieldEntries} entries</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Prize contribution</dt>
                  <dd className="mt-1 break-words font-mono">{formatMoney(item.historicalPrizeContribution)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Required field gap</dt>
                  <dd className="mt-1 font-mono">{item.requiredEntriesGap}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Historical Shortfall</dt>
                  <dd className="mt-1 break-words font-mono text-amber-200">{formatMoney(item.shortfall)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Historical Surplus</dt>
                  <dd className="mt-1 break-words font-mono text-emerald-300">{formatMoney(item.surplus)}</dd>
                </div>
              </dl>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}

function Provenance({ value }: { value: Extract<GtdStressEventReadModel, { state: "research" }> }) {
  const scenario = value.result.scenario;
  return (
    <details className="mt-6 border-y border-border/60 py-3 text-xs">
      <summary className="min-h-11 cursor-pointer py-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        Research provenance and limitations
      </summary>
      <dl className="mt-2 grid gap-3 pb-3 sm:grid-cols-[150px_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Scenario ID</dt>
        <dd className="break-all font-mono">{scenario.scenarioId}</dd>
        <dt className="text-muted-foreground">Comparable artifact</dt>
        <dd className="break-all font-mono">{value.result.provenance.sourceArtifactId}</dd>
        <dt className="text-muted-foreground">Artifact file SHA-256</dt>
        <dd className="break-all font-mono">{value.artifactFileSha256}</dd>
        <dt className="text-muted-foreground">Fold</dt>
        <dd className="break-all font-mono">{value.result.provenance.foldId}</dd>
        <dt className="text-muted-foreground">Selection protocol</dt>
        <dd className="break-all font-mono">{value.result.provenance.selectionProtocolId}</dd>
        <dt className="text-muted-foreground">Distribution method</dt>
        <dd className="break-all font-mono">{value.result.provenance.distributionMethodId}</dd>
      </dl>
      <ul className="space-y-2 border-t border-border/50 pt-3 text-muted-foreground">
        {scenario.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}
      </ul>
    </details>
  );
}

export function GtdStressSheet({ event, loadResearch, onOpenChange }: GtdStressSheetProps) {
  const [loadState, setLoadState] = useState<ResearchLoadState>({ state: "idle" });

  useEffect(() => {
    if (!event) {
      setLoadState({ state: "idle" });
      return;
    }
    const eligibility = getGtdStressEventEligibility(event);
    if (eligibility.state !== "ready") {
      setLoadState({ state: "idle" });
      return;
    }

    let active = true;
    setLoadState({ state: "loading" });
    loadResearch(event.id)
      .then((value) => {
        if (active) setLoadState({ state: "loaded", value });
      })
      .catch((error: unknown) => {
        if (active) setLoadState({ state: "error", code: errorCode(error) });
      });
    return () => {
      active = false;
    };
  }, [event, loadResearch]);

  const eligibility = event ? getGtdStressEventEligibility(event) : null;

  return (
    <Sheet open={event !== null} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full overflow-y-auto border-border bg-background sm:max-w-3xl"
        data-testid="gtd-stress-sheet"
      >
        {event && eligibility && (
          <>
            <SheetHeader className="pr-12 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-cyan-500/35 text-cyan-300">
                  <BarChart3 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Historical GTD Stress
                </Badge>
                <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                  Unverified Evidence
                </Badge>
              </div>
              <SheetTitle>{event.eventName}</SheetTitle>
              <SheetDescription>
                {event.eventDate} · #{event.eventNumber} · {event.festivalName}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 border-l-2 border-amber-400/70 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-100">
              Historical decision support only. This view does not provide a production forecast,
              calibrated range, causal conclusion, or owner action.
            </div>

            {eligibility.state !== "ready" ? (
              <RequirementsMissing event={event} />
            ) : loadState.state === "loading" || loadState.state === "idle" ? (
              <div
                className="mt-8 flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
                data-testid="gtd-stress-loading"
              >
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
                Validating Comparable evidence...
              </div>
            ) : loadState.state === "error" ? (
              <div
                className="mt-6 border border-rose-500/40 bg-rose-500/5 p-5"
                role="alert"
                data-testid="gtd-stress-error"
              >
                <AlertTriangle className="h-5 w-5 text-rose-300" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold">Research evidence could not be validated</h3>
                <p className="mt-2 text-xs text-muted-foreground">
                  No scenario or partial value was displayed.
                </p>
                <p className="mt-3 font-mono text-xs text-rose-300">{loadState.code}</p>
              </div>
            ) : loadState.value.state === "requirements_missing" ? (
              <RequirementsMissing event={event} />
            ) : (
              <>
                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  <span>{loadState.value.evidenceN} selected comparable events</span>
                  <span aria-hidden="true">·</span>
                  <span>Chronological evaluation</span>
                  <span aria-hidden="true">·</span>
                  <span>Unverified Jeju V1</span>
                </div>
                <ScenarioTable value={loadState.value} />
                <Provenance value={loadState.value} />
              </>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
