import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  formatClaimValue,
  type VerifiedField,
  type VerifiedMarketReadModel,
} from "@/lib/series-market/verifiedMarketReadModel";
import { EvidenceStateBadge } from "./EvidenceStateBadge";

function DetailLine({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 border-b border-border/50 py-2.5 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`${mono ? "font-mono break-all" : "break-words"} text-foreground`}>{value ?? "Not provided"}</dd>
    </div>
  );
}

export function VerifiedMarketEvidenceSheet({
  field,
  eventTitle,
  model,
  onOpenChange,
}: {
  field: VerifiedField | null;
  eventTitle: string;
  model: VerifiedMarketReadModel;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={field !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-border bg-background sm:max-w-xl" data-testid="evidence-sheet">
        {field && (
          <>
            <SheetHeader className="pr-12 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-cyan-500/35 text-cyan-300">Source Detail</Badge>
                <EvidenceStateBadge state={field.state} />
              </div>
              <SheetTitle>{field.label}</SheetTitle>
              <SheetDescription>{eventTitle}</SheetDescription>
            </SheetHeader>

            <div className="mt-5 border-y border-border/70">
              <DetailLine label="Resolved value" value={field.displayValue} />
              <DetailLine label="Release" value={model.releaseId} mono />
              <DetailLine label="Source cutoff" value={model.sourceCutoff} mono />
            </div>

            <div className="mt-6 space-y-4">
              {field.evidence.length === 0 ? (
                <div className="border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
                  Missing: no active source claim exists for this field.
                </div>
              ) : field.evidence.map((item, index) => (
                <section key={item.claimId} className="border border-border/80 bg-muted/15 p-4" aria-label={`Evidence claim ${index + 1}`}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Evidence claim {index + 1}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">{item.kind}</Badge>
                      <Badge variant="outline">{item.status}</Badge>
                      <Badge variant="outline">{item.confidence}</Badge>
                    </div>
                  </div>
                  <dl>
                    <DetailLine label="Normalized" value={formatClaimValue(item.normalizedValue)} />
                    <DetailLine label="Raw source cell" value={item.rawValue} mono />
                    <DetailLine label="Missing reason" value={item.missingReason} />
                    <DetailLine label="Claim ID" value={item.claimId} mono />
                    <DetailLine label="Source type" value={item.sourceDocumentType} />
                    <DetailLine label="Document ID" value={item.sourceDocumentId} mono />
                    <DetailLine label="Revision ID" value={item.sourceRevisionId} mono />
                    <DetailLine label="Observed" value={item.observedAt} mono />
                    <DetailLine label="Retrieved" value={item.retrievedAt} mono />
                    <DetailLine label="Supersedes" value={item.supersedesClaimId} mono />
                    <DetailLine label="Reference" value={item.sourceReference} />
                  </dl>
                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex min-h-11 items-center gap-2 text-xs font-medium text-primary hover:underline"
                    >
                      Open public source <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                </section>
              ))}
            </div>

            <div className="mt-6 border-l-2 border-amber-400/70 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-100">
              <p className="font-semibold">Unverified Seed</p>
              <p className="mt-1">{model.evidenceCaveat}</p>
              <p className="mt-2">This verification interface does not upgrade the seed to official ground truth.</p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
