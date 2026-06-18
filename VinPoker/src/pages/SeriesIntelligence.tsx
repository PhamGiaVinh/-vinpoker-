import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, FileSpreadsheet, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import { SERIES_INTEL } from "@/lib/seriesIntelligence";

/**
 * Club Admin → Series Intelligence (frontend-only demo shell).
 * Role-guarded (club admin / club owner / super_admin). NOT blocked by the
 * feature flag so the owner can preview the direct route; when the flag is off
 * it shows a small "internal demo" note. No data, no backend, no calculation.
 */
export default function SeriesIntelligence() {
  const nav = useNavigate();
  const { isAdmin, isClubAdmin, isClubOwner, loading } = useAuth();

  if (loading) return null;
  if (!(isClubAdmin || isClubOwner || isAdmin)) return <Navigate to="/" replace />;

  return (
    <div className="container max-w-3xl mx-auto p-4 space-y-4">
      {/* header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(-1)} aria-label="Quay lại">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="font-display text-2xl text-primary flex items-center gap-2">
            <Sparkles className="w-5 h-5" /> {SERIES_INTEL.title}
          </h1>
          <p className="text-xs text-muted-foreground">{SERIES_INTEL.subtitle}</p>
        </div>
      </div>

      {!FEATURES.clubSeriesIntelligence && (
        <Card className="p-3 border-primary/40 bg-primary/5 flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="w-4 h-4 text-primary shrink-0" />
          <span>{SERIES_INTEL.previewNote}</span>
        </Card>
      )}

      {/* safety boundary */}
      <Card className="p-4 gradient-card border-primary/40">
        <p className="text-sm text-muted-foreground">{SERIES_INTEL.safetyBoundary}</p>
      </Card>

      {/* 4 steps */}
      <div className="space-y-3">
        {SERIES_INTEL.steps.map((s) => (
          <Card key={s.n} className="p-4 gradient-card border-primary/40 flex items-start gap-3">
            <div className="grid place-items-center w-7 h-7 rounded-full bg-primary/15 text-primary text-sm font-semibold shrink-0">
              {s.n}
            </div>
            <div>
              <h3 className="font-display text-base">{s.label}</h3>
              <p className="text-xs text-muted-foreground">{s.desc}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* CSV checklist */}
      <Card className="p-4 gradient-card border-primary/40">
        <h3 className="font-display text-base flex items-center gap-2 mb-2">
          <FileSpreadsheet className="w-4 h-4 text-primary" /> Cột CSV cần chuẩn bị
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {SERIES_INTEL.requiredColumns.map((c) => (
            <Badge key={c} variant="secondary" className="font-mono text-[11px]">
              {c}
            </Badge>
          ))}
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{SERIES_INTEL.eventIdNote}</span>
        </p>
      </Card>

      {/* demo note */}
      <Card className="p-4 border-primary/30">
        <ul className="space-y-1 text-xs text-muted-foreground">
          {SERIES_INTEL.demoNotes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* CTA — disabled until a public demo URL exists */}
      <Button disabled variant="outline" className="w-full gap-2">
        <FileSpreadsheet className="w-4 h-4" /> {SERIES_INTEL.ctaDisabledLabel}
      </Button>
    </div>
  );
}
