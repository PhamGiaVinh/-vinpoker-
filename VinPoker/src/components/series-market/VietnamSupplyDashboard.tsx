import { useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  Database,
  FileCheck2,
  HelpCircle,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  VietnamSupplyCollisionWindow,
  VietnamSupplyMoney,
  VietnamSupplyReadModel,
  VietnamSupplySeriesSummary,
  VietnamSupplyTemplateGroup,
} from "@/lib/series-market/vietnamSupplyReadModel";
import { VietnamMarketPulse } from "./VietnamMarketPulse";
import { VietnamSupplyEventExplorer } from "./VietnamSupplyEventExplorer";

function Metric({
  value,
  label,
  kind,
  help,
}: {
  value: string;
  label: string;
  kind: string;
  help?: string;
}) {
  return (
    <div className="min-w-0 border-r border-border/60 px-3 py-4 last:border-r-0 sm:px-4">
      <div className="flex items-start gap-2">
        <p className="break-words font-mono text-xl font-semibold text-foreground">{value}</p>
        {help && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`About ${label}`}
              >
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{help}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-[10px] uppercase text-muted-foreground/70">{kind}</p>
    </div>
  );
}

function moneyList(values: readonly VietnamSupplyMoney[]): string {
  return values.length > 0 ? values.map((value) => value.displayValue).join(" + ") : "Unavailable";
}

function SeriesSummary({ series }: { series: VietnamSupplySeriesSummary }) {
  return (
    <article className="min-w-0 border border-border/75 bg-muted/10 p-4" data-testid={`vietnam-series-${series.sourceId}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase text-cyan-300">{series.sourceLabel}</p>
          <h3 className="mt-1 break-words text-sm font-semibold">{series.seriesName}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {series.displayedScheduleDates.join(" · ")} · {series.venue ?? "Venue not displayed"}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-200">Unverified</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-4 text-xs">
        <SummaryLine label="Events" value={String(series.eventCount)} />
        <SummaryLine label="Claims" value={String(series.claimCount)} />
        <SummaryLine label="Announced GTD" value={series.announcedGtd?.displayValue ?? "Unavailable"} />
        <SummaryLine
          label="Required entries"
          value={series.calculableRequiredEntries ?? "Unavailable"}
          warn={series.calculableRequiredEntries === null}
        />
        <SummaryLine label="Calculable metrics" value={String(series.calculableRequiredMetricCount)} />
        <SummaryLine label="Missing claims" value={String(series.missingClaimCount)} warn={series.missingClaimCount > 0} />
      </dl>
      {series.requiredEntriesReason && (
        <p className="mt-4 border-l-2 border-amber-400/70 pl-3 text-xs leading-relaxed text-amber-100">
          {series.requiredEntriesReason}
        </p>
      )}
      <p className="mt-4 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
        SHA-256 {series.sourceSha256}
      </p>
    </article>
  );
}

function SummaryLine({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd className={`${warn ? "text-amber-200" : "text-foreground"} mt-1 break-words font-mono`}>{value}</dd>
    </div>
  );
}

function CollisionSection({ windows }: { windows: readonly VietnamSupplyCollisionWindow[] }) {
  const defaultWindow = windows.find((window) => window.key === "within_14_days") ?? windows[0]!;
  const [windowKey, setWindowKey] = useState(defaultWindow.key);
  const selected = windows.find((window) => window.key === windowKey) ?? defaultWindow;

  return (
    <section className="border-t border-border/70 py-7" aria-labelledby="calendar-pressure-title">
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div>
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <h2 id="calendar-pressure-title" className="text-lg font-semibold">Calendar Pressure</h2>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Descriptive overlap between announced schedules. It does not measure player overlap or turnout.
          </p>
          <ToggleGroup
            type="single"
            value={windowKey}
            onValueChange={(value) => { if (value) setWindowKey(value as VietnamSupplyCollisionWindow["key"]); }}
            className="mt-4 grid grid-cols-2 justify-stretch gap-1 sm:grid-cols-5 lg:grid-cols-2"
            aria-label="Collision window"
          >
            {windows.map((window) => (
              <ToggleGroupItem
                key={window.key}
                value={window.key}
                variant="outline"
                className="min-h-10 min-w-0 px-2 text-[11px] data-[state=on]:border-cyan-400/60 data-[state=on]:bg-cyan-400/10"
              >
                {window.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="min-w-0 border-l border-border/70 pl-0 lg:pl-6">
          {selected.state === "empty" ? (
            <div className="flex min-h-48 items-center border-y border-border/70 px-5 py-8">
              <div>
                <p className="text-sm font-medium">No announced schedule collision in this window.</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  This empty state describes the three committed public posters only.
                </p>
              </div>
            </div>
          ) : selected.groups.map((group) => (
            <article key={group.collisionId} className="border-y border-border/70 py-5" data-testid="vietnam-collision-group">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase text-amber-200">
                    {group.distanceDays} days apart
                  </p>
                  <h3 className="mt-1 text-base font-semibold">{group.sourceLabels.join(" + ")}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{group.dates.join(" · ")}</p>
                </div>
                <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                  {group.eventFamilyOverlap.length} overlapping families
                </Badge>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-px border border-border/70 bg-border/70 sm:grid-cols-4">
                <CollisionMetric label="Announced GTD" value={moneyList(group.announcedGtdTotals)} />
                <CollisionMetric label="Required entries" value={group.combinedRequiredEntries} />
                <CollisionMetric label="Calculable metrics" value={group.calculableRequiredEntryEvents} />
                <CollisionMetric label="Repeated templates" value={group.repeatedTemplateCount} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {group.eventFamilyOverlap.map((family) => (
                  <Badge key={family} variant="outline" className="text-[10px]">{family}</Badge>
                ))}
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Announced supply is not achieved entries, player-pool overlap, or underlying demand.
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CollisionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-background px-3 py-4">
      <p className="break-words font-mono text-sm font-semibold">{value}</p>
      <p className="mt-1 text-[10px] uppercase text-muted-foreground">{label}</p>
    </div>
  );
}

function TemplateSection({ templates }: { templates: readonly VietnamSupplyTemplateGroup[] }) {
  return (
    <section className="border-t border-border/70 py-7" aria-labelledby="repeated-formats-title">
      <div className="flex items-center gap-2">
        <Layers3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <h2 id="repeated-formats-title" className="text-lg font-semibold">Repeated market formats</h2>
      </div>
      <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Exact matches use identical committed structural fingerprints. Partial similarity reports only named equal fields; no origin or authorship inference is made.
      </p>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {templates.map((template) => (
          <article key={template.groupId} className="border border-border/75 bg-muted/10 p-4" data-testid={`vietnam-template-${template.matchKind}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Badge
                  variant="outline"
                  className={template.matchKind === "exact"
                    ? "border-emerald-500/40 text-emerald-200"
                    : "border-amber-500/40 text-amber-200"}
                >
                  {template.matchKind === "exact" ? "Exact template" : "Partial similarity"}
                </Badge>
                <h3 className="mt-2 text-sm font-semibold">{template.title}</h3>
              </div>
              {template.requiredEntriesState === "partially_unavailable" && (
                <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                  Required entries partly unavailable
                </Badge>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{template.basis}</p>
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Matched fields</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {template.matchedFields.map((field) => (
                  <Badge key={field} variant="outline" className="text-[10px]">{field}</Badge>
                ))}
              </div>
            </div>
            <div className="mt-4 border-t border-border/60 pt-3">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Event rows</p>
              <ul className="mt-2 space-y-2 text-xs">
                {template.eventLabels.map((label) => (
                  <li key={label} className="break-words border-l border-cyan-400/35 pl-3">{label}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function VietnamSupplyDashboard({ model }: { model: VietnamSupplyReadModel }) {
  const announcedGtd = moneyList(model.overview.announcedGtdTotals);
  const correction = model.correction;

  return (
    <TooltipProvider delayDuration={180}>
      <main className="min-w-0 overflow-x-hidden" data-testid="vietnam-supply-dashboard">
        <header className="border-b border-border/70 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl text-primary sm:text-3xl">Vietnam Market Supply</h1>
                <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-200">
                  Owner-provided public images · Unverified
                </Badge>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Read-only intelligence over three announced poker schedules. This surface describes supply evidence, not turnout, demand, capacity, or player flow.
              </p>
            </div>
            <div className="min-w-0 border-l-2 border-emerald-400/60 pl-3 text-xs text-muted-foreground">
              <p><span className="text-foreground">Source cutoff</span> {model.sourceCutoff}</p>
              <p className="mt-1"><span className="text-foreground">Release</span> <span className="font-mono">{model.releaseShortId}</span></p>
            </div>
          </div>
        </header>

        <VietnamMarketPulse
          state={model.integrityState}
          releaseShortId={model.releaseShortId}
          sourceCutoff={model.sourceCutoff}
          correctionId={model.correctionId}
        />

        <section aria-label="Vietnam supply overview" className="grid grid-cols-2 border-b border-border/70 sm:grid-cols-3 xl:grid-cols-6">
          <Metric value={String(model.overview.seriesCount)} label="Series" kind="Derived UI count" />
          <Metric value={String(model.overview.eventCount)} label="Event rows" kind="Released artifact" />
          <Metric value={announcedGtd} label="Announced GTD" kind="Exact released sum" />
          <Metric
            value={model.overview.calculableRequiredEntries}
            label="Calculable required entries"
            kind="Released derived metrics"
            help="Sum of released required-entry metrics only where monetary GTD and explicit prize contribution are both displayed. This is not a turnout estimate."
          />
          <Metric value={String(model.overview.claimCount)} label="Evidence claims" kind="Released artifact" />
          <Metric value={String(model.overview.missingClaimCount)} label="Missing claims" kind="Missing is not zero" />
        </section>

        <section className="py-7" aria-labelledby="series-comparison-title">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <h2 id="series-comparison-title" className="text-lg font-semibold">Series comparison</h2>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Source summaries preserve each poster identity and exact source hash.
          </p>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {model.series.map((series) => <SeriesSummary key={series.sourceId} series={series} />)}
          </div>
        </section>

        <CollisionSection windows={model.collisionWindows} />
        <TemplateSection templates={model.templates} />
        <VietnamSupplyEventExplorer model={model} />

        <section className="grid gap-6 border-y border-border/70 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-labelledby="evidence-limitations-title">
          <div>
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              <h2 id="evidence-limitations-title" className="text-lg font-semibold">Evidence & correction history</h2>
            </div>
            <div className="mt-4 border-l-2 border-emerald-400/60 pl-4 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-200">Corrected release active</Badge>
                <span className="font-mono text-muted-foreground">{correction.correctedAt}</span>
              </div>
              <p className="mt-3 leading-relaxed">
                {correction.affectedEventKey}: prize contribution corrected from {correction.oldValue.displayValue} to {correction.newValue.displayValue}.
              </p>
              <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
                Correction {correction.correctionId}
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                Superseded release {correction.supersededReleaseId}
              </p>
            </div>
            <div className="mt-5 flex items-start gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-100">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                All three posters remain <strong>owner_provided_public_image_unverified</strong>. The UI does not upgrade them to official ground truth.
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />
              <h2 className="text-lg font-semibold">Limitations</h2>
            </div>
            <ul className="mt-4 space-y-3 text-xs leading-relaxed text-muted-foreground">
              {model.limitations.map((limitation) => (
                <li key={limitation} className="border-l border-border/80 pl-3">{limitation}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </TooltipProvider>
  );
}
