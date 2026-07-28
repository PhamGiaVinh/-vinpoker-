import { useMemo, useState } from "react";
import { FilterX, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  EMPTY_VIETNAM_SUPPLY_FILTERS,
  filterVietnamSupplyEvents,
  type VietnamSupplyEventFilters,
  type VietnamSupplyEventReadModel,
  type VietnamSupplyReadModel,
} from "@/lib/series-market/vietnamSupplyReadModel";

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
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function EventEvidenceBadge({ event }: { event: VietnamSupplyEventReadModel }) {
  if (event.conflictingClaimCount > 0) {
    return <Badge variant="outline" className="border-rose-500/40 text-rose-200">Conflict</Badge>;
  }
  if (event.uncertainClaimCount > 0) {
    return <Badge variant="outline" className="border-amber-500/40 text-amber-200">Uncertain</Badge>;
  }
  if (event.missingClaimCount > 0) {
    return <Badge variant="outline" className="border-amber-500/40 text-amber-200">{event.missingClaimCount} missing</Badge>;
  }
  return <Badge variant="outline" className="border-emerald-500/40 text-emerald-200">Complete row</Badge>;
}

function RequiredField({ event }: { event: VietnamSupplyEventReadModel }) {
  return event.requiredEntries.state === "calculable" ? (
    <span className="font-mono text-sm text-emerald-200">{event.requiredEntries.displayValue}</span>
  ) : (
    <span className="text-xs text-amber-200">Unavailable</span>
  );
}

function EventMobileCard({
  event,
  onOpen,
}: {
  event: VietnamSupplyEventReadModel;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full border-b border-border/70 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
      data-testid="vietnam-supply-event-card"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-cyan-300">
            {event.scheduleDate} · {event.localStartTime}
          </p>
          <p className="mt-1 break-words text-sm font-semibold text-foreground">{event.eventName}</p>
          <p className="mt-1 text-xs text-muted-foreground">{event.sourceLabel} · {event.eventFamily}</p>
        </div>
        <EventEvidenceBadge event={event} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/50 pt-3 text-xs">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Buy-in</p>
          <p className="mt-1 break-words">{event.buyInDisplay}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Announced GTD</p>
          <p className="mt-1 break-words">{event.gtdDisplay}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Required entries</p>
          <p className="mt-1"><RequiredField event={event} /></p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Structure</p>
          <p className="mt-1">{event.startingStack ?? "Missing"} · {event.levelDurationDisplay}</p>
        </div>
      </div>
    </button>
  );
}

export function VietnamSupplyEventExplorer({ model }: { model: VietnamSupplyReadModel }) {
  const [filters, setFilters] = useState<VietnamSupplyEventFilters>(EMPTY_VIETNAM_SUPPLY_FILTERS);
  const [selected, setSelected] = useState<VietnamSupplyEventReadModel | null>(null);
  const events = useMemo(
    () => filterVietnamSupplyEvents(model.events, filters),
    [filters, model.events],
  );
  const update = <K extends keyof VietnamSupplyEventFilters>(
    key: K,
    value: VietnamSupplyEventFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));
  const dates = [...new Set(model.events.map((event) => event.scheduleDate))].sort();
  const families = [...new Set(model.events.map((event) => event.eventFamily))].sort();

  return (
    <section className="border-t border-border/70 py-7" aria-labelledby="vietnam-event-explorer-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase text-cyan-300">Source-backed rows</p>
          <h2 id="vietnam-event-explorer-title" className="mt-1 text-lg font-semibold">Event explorer</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {events.length} of {model.events.length} announced event rows · Missing is never treated as zero.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setFilters(EMPTY_VIETNAM_SUPPLY_FILTERS)}
          className="min-h-10 gap-2"
        >
          <FilterX className="h-4 w-4" aria-hidden="true" />
          Clear filters
        </Button>
      </div>

      <div className="mt-5 grid gap-3 border-y border-border/70 py-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="min-w-0 space-y-1 text-[11px] font-medium text-muted-foreground sm:col-span-2">
          <span>Search</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4" aria-hidden="true" />
            <Input
              value={filters.search}
              onChange={(event) => update("search", event.target.value)}
              placeholder="Event, series, venue, family..."
              className="h-10 bg-background/60 pl-9"
            />
          </span>
        </label>
        <FilterSelect
          label="Series"
          value={filters.sourceId}
          onChange={(value) => update("sourceId", value)}
          options={[
            { value: "all", label: "All series" },
            ...model.series.map((item) => ({ value: item.sourceId, label: item.sourceLabel })),
          ]}
        />
        <FilterSelect
          label="Date"
          value={filters.scheduleDate}
          onChange={(value) => update("scheduleDate", value)}
          options={[{ value: "all", label: "All dates" }, ...dates.map((date) => ({ value: date, label: date }))]}
        />
        <FilterSelect
          label="Event family"
          value={filters.eventFamily}
          onChange={(value) => update("eventFamily", value)}
          options={[{ value: "all", label: "All families" }, ...families.map((family) => ({ value: family, label: family }))]}
        />
        <FilterSelect
          label="GTD type"
          value={filters.gtdKind}
          onChange={(value) => update("gtdKind", value as VietnamSupplyEventFilters["gtdKind"])}
          options={[
            { value: "all", label: "All GTD types" },
            { value: "monetary", label: "Monetary" },
            { value: "seats", label: "Seats" },
            { value: "tickets", label: "Tickets" },
            { value: "missing", label: "Missing" },
          ]}
        />
        <FilterSelect
          label="Buy-in evidence"
          value={filters.monetaryState}
          onChange={(value) => update("monetaryState", value as VietnamSupplyEventFilters["monetaryState"])}
          options={[
            { value: "all", label: "All states" },
            { value: "explicit_split", label: "Prize + fee split" },
            { value: "total_only", label: "Total only" },
            { value: "missing", label: "Missing" },
          ]}
        />
        <FilterSelect
          label="Required entries"
          value={filters.requiredState}
          onChange={(value) => update("requiredState", value as VietnamSupplyEventFilters["requiredState"])}
          options={[
            { value: "all", label: "All states" },
            { value: "calculable", label: "Calculable" },
            { value: "unavailable", label: "Unavailable" },
          ]}
        />
        <FilterSelect
          label="Schedule role"
          value={filters.role}
          onChange={(value) => update("role", value as VietnamSupplyEventFilters["role"])}
          options={[
            { value: "all", label: "Main, side & satellite" },
            { value: "main", label: "Main / anchor" },
            { value: "side", label: "Side event" },
            { value: "satellite", label: "Satellite" },
          ]}
        />
        <FilterSelect
          label="Missing fields"
          value={filters.missingState}
          onChange={(value) => update("missingState", value as VietnamSupplyEventFilters["missingState"])}
          options={[
            { value: "all", label: "All rows" },
            { value: "has_missing", label: "Has missing fields" },
            { value: "complete", label: "No missing fields" },
          ]}
        />
      </div>

      {events.length === 0 ? (
        <div className="border-b border-border/70 py-12 text-center">
          <p className="text-sm font-medium">No rows match these filters.</p>
          <p className="mt-1 text-xs text-muted-foreground">The source artifact remains unchanged.</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-border/70 md:hidden">
            {events.map((event) => (
              <EventMobileCard key={event.eventId} event={event} onOpen={() => setSelected(event)} />
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border/80 text-[10px] uppercase text-muted-foreground">
                  <th className="px-3 py-3 font-medium">Date / time</th>
                  <th className="px-3 py-3 font-medium">Event</th>
                  <th className="px-3 py-3 font-medium">Buy-in evidence</th>
                  <th className="px-3 py-3 font-medium">Announced GTD</th>
                  <th className="px-3 py-3 font-medium">Required entries</th>
                  <th className="px-3 py-3 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.eventId} className="border-b border-border/55 align-top hover:bg-muted/20">
                    <td className="whitespace-nowrap px-3 py-3 font-mono">
                      <span className="block text-cyan-300">{event.scheduleDate}</span>
                      <span className="mt-1 block text-muted-foreground">{event.localStartTime}</span>
                    </td>
                    <td className="max-w-[280px] px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setSelected(event)}
                        className="min-h-11 max-w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span className="block break-words font-semibold hover:text-primary">{event.eventName}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {event.sourceLabel} · {event.eventFamily}
                        </span>
                      </button>
                    </td>
                    <td className="max-w-[210px] px-3 py-3">
                      <span className="break-words">{event.buyInDisplay}</span>
                    </td>
                    <td className="max-w-[170px] px-3 py-3">
                      <span className="break-words">{event.gtdDisplay}</span>
                      {event.gtdKind !== "monetary" && (
                        <Badge variant="outline" className="mt-1 block w-fit border-slate-500/40 text-[10px] text-slate-300">
                          Non-monetary
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-3"><RequiredField event={event} /></td>
                    <td className="px-3 py-3"><EventEvidenceBadge event={event} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <EventDetailSheet
        event={selected}
        releaseId={model.releaseId}
        sourceCutoff={model.sourceCutoff}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
      />
    </section>
  );
}

function EventDetailSheet({
  event,
  releaseId,
  sourceCutoff,
  onOpenChange,
}: {
  event: VietnamSupplyEventReadModel | null;
  releaseId: string;
  sourceCutoff: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={event !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-border bg-background sm:max-w-2xl" data-testid="vietnam-event-detail">
        {event && (
          <>
            <SheetHeader className="pr-10 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-cyan-500/35 text-cyan-200">Source detail</Badge>
                <Badge variant="outline" className="border-amber-500/35 text-amber-200">Unverified</Badge>
                <EventEvidenceBadge event={event} />
              </div>
              <SheetTitle>{event.eventName}</SheetTitle>
              <SheetDescription>
                {event.sourceLabel} · {event.scheduleDate} · {event.localStartTime}
              </SheetDescription>
            </SheetHeader>

            <dl className="mt-5 border-y border-border/70 text-xs">
              <Detail label="Series" value={event.seriesName} />
              <Detail label="Organizer" value={event.organizer} />
              <Detail label="Venue" value={event.venue ?? "Missing"} />
              <Detail label="Family / game" value={`${event.eventFamily} · ${event.game}`} />
              <Detail label="Buy-in" value={event.buyInDisplay} />
              <Detail label="Prize contribution" value={event.prizeContribution?.exactValue ?? "Missing"} mono />
              <Detail label="Organizer fee" value={event.organizerFee?.exactValue ?? "Missing"} mono />
              <Detail label="Announced GTD" value={event.gtdMoney?.exactValue ?? event.gtdDisplay} mono />
              <Detail
                label="Required entries"
                value={event.requiredEntries.exactValue ?? event.requiredEntries.reason ?? "Unavailable"}
              />
              <Detail label="Stack / levels" value={`${event.startingStack ?? "Missing"} · ${event.levelDurationDisplay}`} />
              <Detail label="Registration" value={event.registrationCloseDisplay} />
              <Detail label="ITM" value={event.itmStatement ?? "Missing"} />
              <Detail label="Satellite link" value={event.satelliteLinkage ?? "Not applicable / not displayed"} />
              <Detail label="Release" value={releaseId} mono />
              <Detail label="Source cutoff" value={sourceCutoff} mono />
            </dl>

            <section className="mt-6" aria-labelledby="event-claims-title">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <h3 id="event-claims-title" className="text-sm font-semibold">
                  Evidence claims ({event.claims.length})
                </h3>
              </div>
              <div className="mt-3 space-y-3">
                {event.claims.map((claim) => (
                  <article key={claim.claimId} className="border border-border/70 bg-muted/10 p-3 text-xs">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">{claim.field}</p>
                        <p className="mt-1 break-words text-muted-foreground">{claim.displayValue}</p>
                      </div>
                      <Badge variant="outline">{claim.extractionStatus}</Badge>
                    </div>
                    <dl className="mt-3 border-t border-border/50 pt-2">
                      <Detail label="Visual region" value={claim.visualRegion} />
                      <Detail label="Source path" value={claim.sourcePath} mono />
                      <Detail label="Source SHA-256" value={claim.sourceSha256} mono />
                      <Detail label="Claim ID" value={claim.claimId} mono />
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[116px_minmax(0,1fr)] gap-3 border-b border-border/50 py-2.5 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`${mono ? "break-all font-mono" : "break-words"} text-foreground`}>{value}</dd>
    </div>
  );
}
