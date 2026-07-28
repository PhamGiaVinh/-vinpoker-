import { useEffect, useState } from "react";
import { Activity, CheckCircle2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VietnamSupplyIntegrityState } from "@/lib/series-market/vietnamSupplyReadModel";

export type VietnamMarketPulseState = VietnamSupplyIntegrityState | "unavailable";

const STATE_COPY: Readonly<Record<VietnamMarketPulseState, {
  label: string;
  title: string;
  description: string;
  accent: string;
}>> = {
  current: {
    label: "Current",
    title: "Evidence graph is current",
    description: "The active release, artifact and receipt identities agree.",
    accent: "text-cyan-200",
  },
  corrected: {
    label: "Corrected",
    title: "Corrected release is active",
    description: "The superseded release is excluded and correction lineage remains visible.",
    accent: "text-emerald-200",
  },
  unavailable: {
    label: "Unavailable",
    title: "Evidence graph is unavailable",
    description: "The interface failed closed. No partial market values are displayed.",
    accent: "text-rose-200",
  },
};

export function VietnamMarketPulse({
  state,
  releaseShortId,
  sourceCutoff,
  correctionId,
}: {
  state: VietnamMarketPulseState;
  releaseShortId?: string;
  sourceCutoff?: string;
  correctionId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pageHidden, setPageHidden] = useState(
    typeof document !== "undefined" ? document.hidden : false,
  );
  const copy = STATE_COPY[state];

  useEffect(() => {
    const onVisibilityChange = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return (
    <>
      <section
        aria-labelledby="vietnam-market-pulse-title"
        className="relative isolate overflow-hidden border-y border-border/70 bg-[#080b11] px-4 py-7 sm:px-6"
        data-testid="vietnam-market-pulse"
        data-state={state}
        data-page-hidden={pageHidden ? "true" : "false"}
      >
        <style>{`
          @keyframes vietnam-market-pulse-breathe {
            0%, 100% { transform: scale(1); opacity: 0.78; }
            50% { transform: scale(1.02); opacity: 1; }
          }
          .vietnam-market-pulse-core {
            animation: vietnam-market-pulse-breathe 3.2s ease-in-out infinite;
          }
          [data-page-hidden="true"] .vietnam-market-pulse-core {
            animation-play-state: paused;
          }
          @media (prefers-reduced-motion: reduce) {
            .vietnam-market-pulse-core { animation: none !important; }
          }
        `}</style>
        <div className="pointer-events-none absolute inset-0 opacity-55" aria-hidden="true">
          <div className="absolute left-[4%] top-[12%] h-24 w-40 border border-cyan-400/15 [clip-path:polygon(8%_0,100%_22%,74%_100%,0_72%)]" />
          <div className="absolute bottom-[8%] right-[7%] h-28 w-44 border border-emerald-300/15 [clip-path:polygon(28%_0,100%_16%,86%_82%,12%_100%,0_30%)]" />
          <div className="absolute left-[38%] top-[8%] h-20 w-28 border border-slate-500/20 [clip-path:polygon(50%_0,100%_38%,78%_100%,18%_82%,0_28%)]" />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-cyan-500/35 bg-cyan-500/5 text-cyan-200">
                Market Pulse
              </Badge>
              <Badge
                variant="outline"
                className={state === "unavailable"
                  ? "border-rose-500/40 text-rose-200"
                  : state === "corrected"
                    ? "border-emerald-500/40 text-emerald-200"
                    : "border-cyan-500/40 text-cyan-200"}
              >
                {copy.label}
              </Badge>
            </div>
            <h2 id="vietnam-market-pulse-title" className="mt-3 text-lg font-semibold text-foreground sm:text-xl">
              Vietnam schedule supply evidence
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {copy.description} This pulse reports source integrity, not market demand or player turnout.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              className="mt-4 min-h-11 gap-2 border-border/80 bg-background/30"
            >
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              View integrity detail
            </Button>
          </div>

          <div className="flex min-h-44 items-center justify-center" aria-hidden="true">
            <div className="relative h-40 w-40">
              <div className="absolute inset-1 border border-slate-600/50 [clip-path:polygon(50%_0,90%_16%,100%_60%,68%_100%,18%_88%,0_38%)]" />
              <div className="absolute inset-5 border border-cyan-400/35 [clip-path:polygon(44%_0,100%_26%,82%_100%,12%_82%,0_24%)]" />
              <div
                className={`vietnam-market-pulse-core absolute inset-[46px] border ${
                  state === "unavailable"
                    ? "border-rose-400/70 bg-rose-400/10"
                    : state === "corrected"
                      ? "border-emerald-300/70 bg-emerald-300/10"
                      : "border-cyan-300/70 bg-cyan-300/10"
                } [clip-path:polygon(50%_0,100%_36%,78%_100%,16%_84%,0_28%)]`}
              />
            </div>
          </div>
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-background sm:max-w-lg">
          <DialogHeader>
            <div className="mb-2 flex items-center gap-2">
              {state === "unavailable"
                ? <ShieldAlert className="h-5 w-5 text-rose-300" aria-hidden="true" />
                : <CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden="true" />}
              <Badge variant="outline">{copy.label}</Badge>
            </div>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              Read-only lineage for the committed public evidence release.
            </DialogDescription>
          </DialogHeader>
          <dl className="mt-2 border-y border-border/70 text-xs">
            <Detail label="State" value={copy.label} />
            <Detail label="Release" value={releaseShortId ?? "Unavailable"} mono />
            <Detail label="Source cutoff" value={sourceCutoff ?? "Unavailable"} mono />
            <Detail label="Correction" value={correctionId ?? "Unavailable"} mono />
          </dl>
          <p className={`text-xs leading-relaxed ${copy.accent}`}>
            Integrity state never upgrades owner-provided public images to official ground truth.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 border-b border-border/50 py-3 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`${mono ? "break-all font-mono" : "break-words"} text-foreground`}>{value}</dd>
    </div>
  );
}
