import { useMemo, useState } from "react";
import { AlertTriangle, Database, FilterX, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  EMPTY_MARKET_FILTERS,
  filterVerifiedEvents,
  type MarketFilterState,
  type VerifiedEventRow,
  type VerifiedField,
  type VerifiedMarketReadModel,
} from "@/lib/series-market/verifiedMarketReadModel";
import { EvidenceStateBadge } from "./EvidenceStateBadge";
import { VerifiedMarketEvidenceSheet } from "./VerifiedMarketEvidenceSheet";

interface SelectedEvidence {
  readonly field: VerifiedField;
  readonly eventTitle: string;
}

function SummaryMetric({ value, label, kind }: { value: string; label: string; kind: string }) {
  return (
    <div className="min-w-0 border-r border-border/60 px-3 py-3 last:border-r-0 sm:px-4">
      <p className="font-mono text-xl font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-[10px] uppercase text-muted-foreground/70">{kind}</p>
    </div>
  );
}

function FieldButton({ field, onSelect, compact = false }: { field: VerifiedField; onSelect: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="min-h-11 max-w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`Open Source Detail for ${field.label}: ${field.displayValue}`}
    >
      <span className={`${field.state === "missing" ? "text-amber-300" : field.state === "conflict" ? "text-rose-300" : "text-foreground"} block ${compact ? "text-xs" : "text-sm"} break-words hover:text-primary`}>
        {field.displayValue}
      </span>
    </button>
  );
}

function InlineFieldButton({
  field,
  label,
  onSelect,
}: {
  field: VerifiedField;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="block max-w-full py-1 text-left text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`Open Source Detail for ${field.label}: ${field.displayValue}`}
    >
      <span className="text-muted-foreground">{label}: </span>
      <span className={`${field.state === "missing" ? "text-amber-300" : field.state === "conflict" ? "text-rose-300" : "text-foreground"} break-words hover:text-primary`}>
        {field.displayValue}
      </span>
    </button>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 min-w-0 bg-background/60 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

function EventMobileCard({ event, onSelect }: { event: VerifiedEventRow; onSelect: (field: VerifiedField) => void }) {
  const fields = event.fields;
  const title = `${event.eventDate} · #${event.eventNumber} · ${event.eventName}`;
  const evidenceState = event.conflictFieldCount > 0 ? "conflict" : event.missingFieldCount > 0 ? "missing" : "resolved";
  return (
    <article className="border-b border-border/70 py-4 first:pt-0" data-testid="market-event-card">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-cyan-300">{event.eventDate} · #{event.eventNumber}</p>
          <FieldButton field={fields.event_name} onSelect={() => onSelect(fields.event_name)} />
          <p className="text-xs text-muted-foreground">{event.festivalName}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <EvidenceStateBadge state={evidenceState} compact />
          <Badge variant="outline" className="border-amber-500/35 text-[10px] text-amber-200">Unverified</Badge>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {(["event_type", "game", "is_flagship", "buy_in", "buy_in_prize", "organizer_fee", "gtd", "entries"] as const).map((key) => (
          <div key={key} className="min-w-0 border-t border-border/40 pt-2">
            <p className="text-[10px] uppercase text-muted-foreground">{fields[key].label}</p>
            <FieldButton field={fields[key]} onSelect={() => onSelect(fields[key])} compact />
          </div>
        ))}
      </div>
      {(event.missingFieldCount > 0 || event.conflictFieldCount > 0) && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {event.missingFieldCount} missing · {event.conflictFieldCount} conflicts
        </p>
      )}
      <span className="sr-only">{title}</span>
    </article>
  );
}

export function VerifiedMarketDashboard({ model }: { model: VerifiedMarketReadModel }) {
  const [filters, setFilters] = useState<MarketFilterState>(EMPTY_MARKET_FILTERS);
  const [selected, setSelected] = useState<SelectedEvidence | null>(null);
  const events = useMemo(() => filterVerifiedEvents(model.events, filters), [model.events, filters]);
  const update = <K extends keyof MarketFilterState>(key: K, value: MarketFilterState[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const openField = (event: VerifiedEventRow, field: VerifiedField) => {
    setSelected({ field, eventTitle: `${event.eventDate} · #${event.eventNumber} · ${event.eventName}` });
  };

  return (
    <main className="min-w-0 overflow-x-hidden" data-testid="verified-market-dashboard">
      <header className="border-b border-border/70 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl text-primary sm:text-3xl">Verified Market · Jeju V1</h1>
              <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-200">Unverified public seed</Badge>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Public Evidence inspection for a committed seed release. This is not official ground truth and is never the selected club&apos;s private data.
            </p>
          </div>
          <div className="min-w-0 border-l-2 border-cyan-400/60 pl-3 text-xs text-muted-foreground">
            <p><span className="text-foreground">Source cutoff</span> {model.sourceCutoff}</p>
            <p className="mt-1"><span className="text-foreground">Release</span> <span className="font-mono">{model.releaseShortId}</span></p>
          </div>
        </div>
      </header>

      <section aria-label="Release overview" className="grid grid-cols-2 border-b border-border/70 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryMetric value={String(model.festivals.length)} label="Festivals" kind="Derived UI Count" />
        <SummaryMetric value={String(model.events.length)} label="Events" kind="Derived UI Count" />
        <SummaryMetric value={String(model.claimCount)} label="Claims" kind="Source-backed metadata" />
        <SummaryMetric value={String(model.quality.missingClaims)} label="Missing" kind="Data-quality metadata" />
        <SummaryMetric value={String(model.quality.conflicts)} label="Conflicts" kind="Data-quality metadata" />
        <SummaryMetric value={model.quality.currencies.join(", ")} label="Currencies" kind="Source-backed metadata" />
      </section>

      <section className="py-5" aria-labelledby="festival-navigation">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 id="festival-navigation" className="text-sm font-semibold">Festival navigation</h2>
            <p className="text-xs text-muted-foreground">Event totals are Derived UI Count values.</p>
          </div>
          {filters.festival !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => update("festival", "all")}>Show all</Button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {model.festivals.map((festival) => (
            <button
              key={festival.id}
              type="button"
              onClick={() => update("festival", festival.festivalKey)}
              className={`min-h-[88px] min-w-0 border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${filters.festival === festival.festivalKey ? "border-primary bg-primary/10" : "border-border/80 bg-muted/10 hover:border-cyan-400/50"}`}
            >
              <span className="block truncate text-sm font-semibold">{festival.name}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{festival.tour} · {festival.venue}</span>
              <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                <span>{festival.eventCount} events</span>
                <span className={festival.missingFieldCount > 0 ? "text-amber-300" : "text-emerald-300"}>{festival.missingFieldCount} missing</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="border-y border-border/70 py-5" aria-labelledby="market-filters">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="market-filters" className="text-sm font-semibold">Evidence filters</h2>
            <p className="text-xs text-muted-foreground">Deterministic filtering over resolved claim rows.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_MARKET_FILTERS)} className="gap-2">
            <FilterX className="h-4 w-4" aria-hidden="true" /> Clear
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground sm:col-span-2">
            <span>Search</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4" aria-hidden="true" />
              <Input
                value={filters.search}
                onChange={(event) => update("search", event.target.value)}
                placeholder="Event, festival, venue..."
                className="h-10 bg-background/60 pl-9"
              />
            </span>
          </label>
          <FilterSelect label="Festival" value={filters.festival} onChange={(value) => update("festival", value)} options={[{ value: "all", label: "All festivals" }, ...model.filterOptions.festivals.map((item) => ({ value: item.key, label: item.label }))]} />
          <FilterSelect label="Tour" value={filters.tour} onChange={(value) => update("tour", value)} options={[{ value: "all", label: "All tours" }, ...model.filterOptions.tours.map((value) => ({ value, label: value }))]} />
          <FilterSelect label="Event type" value={filters.eventType} onChange={(value) => update("eventType", value)} options={[{ value: "all", label: "All event types" }, ...model.filterOptions.eventTypes.map((value) => ({ value, label: value }))]} />
          <FilterSelect label="Game" value={filters.game} onChange={(value) => update("game", value)} options={[{ value: "all", label: "All games" }, ...model.filterOptions.games.map((value) => ({ value, label: value }))]} />
          <FilterSelect label="Currency" value={filters.currency} onChange={(value) => update("currency", value)} options={[{ value: "all", label: "All currencies" }, ...model.filterOptions.currencies.map((value) => ({ value, label: value }))]} />
          <FilterSelect label="Flagship" value={filters.flagship} onChange={(value) => update("flagship", value as MarketFilterState["flagship"])} options={[{ value: "all", label: "All events" }, { value: "yes", label: "Flagship only" }, { value: "no", label: "Non-flagship" }]} />
          <FilterSelect label="Evidence state" value={filters.evidenceState} onChange={(value) => update("evidenceState", value as MarketFilterState["evidenceState"])} options={[{ value: "all", label: "All states" }, { value: "resolved", label: "Public Evidence" }, { value: "missing", label: "Missing" }, { value: "conflict", label: "Conflict" }]} />
        </div>
      </section>

      <section className="py-5" aria-labelledby="event-explorer">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="event-explorer" className="text-sm font-semibold">Event explorer</h2>
            <p className="text-xs text-muted-foreground">{events.length} of {model.events.length} events · Derived UI Count</p>
          </div>
          <Badge variant="outline" className="border-cyan-500/30 text-cyan-300"><Database className="mr-1 h-3 w-3" /> Public Evidence</Badge>
        </div>

        {events.length === 0 ? (
          <div className="border border-dashed border-border py-12 text-center" data-testid="market-no-results">
            <Search className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No events match these filters</p>
            <p className="mt-1 text-xs text-muted-foreground">No values were fabricated to fill the empty state.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-hidden border border-border/80 md:block">
              <table className="w-full table-fixed text-left text-xs" data-testid="market-event-table">
                <thead className="bg-muted/35 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="w-[30%] px-3 py-2.5 font-medium">Event</th>
                    <th className="w-[14%] px-3 py-2.5 font-medium">Type / game</th>
                    <th className="w-[21%] px-3 py-2.5 font-medium">Buy-in detail</th>
                    <th className="w-[15%] px-3 py-2.5 font-medium">GTD</th>
                    <th className="w-[9%] px-3 py-2.5 font-medium">Entries</th>
                    <th className="w-[11%] px-3 py-2.5 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {events.map((event) => {
                    const state = event.conflictFieldCount > 0 ? "conflict" : event.missingFieldCount > 0 ? "missing" : "resolved";
                    return (
                      <tr key={event.id} className="bg-background/30 hover:bg-muted/15">
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-wrap gap-x-2 font-mono text-cyan-300">
                            <InlineFieldButton field={event.fields.event_date} label="Date" onSelect={() => openField(event, event.fields.event_date)} />
                            <InlineFieldButton field={event.fields.event_no} label="No." onSelect={() => openField(event, event.fields.event_no)} />
                          </div>
                          <FieldButton field={event.fields.event_name} onSelect={() => openField(event, event.fields.event_name)} compact />
                          <p className="truncate text-[10px] text-muted-foreground">{event.festivalName}</p>
                          <InlineFieldButton field={event.fields.is_flagship} label="Flagship" onSelect={() => openField(event, event.fields.is_flagship)} />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <InlineFieldButton field={event.fields.event_type} label="Type" onSelect={() => openField(event, event.fields.event_type)} />
                          <InlineFieldButton field={event.fields.game} label="Game" onSelect={() => openField(event, event.fields.game)} />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <InlineFieldButton field={event.fields.buy_in} label="Buy-in" onSelect={() => openField(event, event.fields.buy_in)} />
                          <InlineFieldButton field={event.fields.buy_in_prize} label="Prize" onSelect={() => openField(event, event.fields.buy_in_prize)} />
                          <InlineFieldButton field={event.fields.organizer_fee} label="Fee" onSelect={() => openField(event, event.fields.organizer_fee)} />
                        </td>
                        <td className="px-3 py-2 align-top"><FieldButton field={event.fields.gtd} onSelect={() => openField(event, event.fields.gtd)} compact /></td>
                        <td className="px-3 py-2 align-top"><FieldButton field={event.fields.entries} onSelect={() => openField(event, event.fields.entries)} compact /></td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-col items-start gap-1.5">
                            <EvidenceStateBadge state={state} compact />
                            <Badge variant="outline" className="border-amber-500/35 text-[10px] text-amber-200">Unverified</Badge>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="md:hidden">
              {events.map((event) => <EventMobileCard key={event.id} event={event} onSelect={(field) => openField(event, field)} />)}
            </div>
          </>
        )}
      </section>

      <section className="border-t border-border/70 py-6" aria-labelledby="data-quality">
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-cyan-300" aria-hidden="true" />
              <h2 id="data-quality" className="text-sm font-semibold">Data quality</h2>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Release range {model.quality.eventDateMin} to {model.quality.eventDateMax}. All claims use the single committed source revision.</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {model.festivals.length + model.events.length} entities (Derived UI Count) · {model.quality.nonMissingClaims} non-missing · {model.quality.missingClaims} missing · 1 source document · 1 source revision · {model.quality.conflicts} conflicts
            </p>
            <div className="mt-4 grid grid-cols-3 border-y border-border/60 py-3 text-center">
              <div><p className="font-mono text-lg">{model.quality.missingCountByField.buy_in_prize}</p><p className="text-[10px] text-muted-foreground">Prize contribution missing</p></div>
              <div><p className="font-mono text-lg">{model.quality.missingCountByField.organizer_fee}</p><p className="text-[10px] text-muted-foreground">Organizer fee missing</p></div>
              <div><p className="font-mono text-lg">{model.quality.missingCountByField.gtd}</p><p className="text-[10px] text-muted-foreground">GTD missing</p></div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="border-l-2 border-amber-400/70 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-100"><AlertTriangle className="h-4 w-4" /> Unverified Seed</div>
              <p className="mt-2 text-xs leading-relaxed text-amber-100/80">No row-level official URLs are available. Do not interpret this release as official, predictive, causal, or a recommendation.</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold">Intentionally omitted legacy columns</h3>
              <dl className="mt-2 divide-y divide-border/50 border-y border-border/50">
                {Object.entries(model.quality.omittedLegacyColumns).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([field, reason]) => (
                  <div key={field} className="grid gap-1 py-2 text-xs sm:grid-cols-[120px_1fr]">
                    <dt className="font-mono text-foreground">{field}</dt>
                    <dd className="text-muted-foreground">{reason}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      <VerifiedMarketEvidenceSheet
        field={selected?.field ?? null}
        eventTitle={selected?.eventTitle ?? ""}
        model={model}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
      />
    </main>
  );
}
