import { lazy, Suspense, useEffect, useState } from "react";
import { AlertTriangle, Database, Loader2, MapPinned } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import canonicalImport from "@/lib/series-market/datasets/jeju/v1/canonical/jeju_import_v1.json";
import dataQuality from "@/lib/series-market/datasets/jeju/v1/data-quality.json";
import release from "@/lib/series-market/datasets/jeju/v1/release.json";
import sourceManifest from "@/lib/series-market/datasets/jeju/v1/source-manifest.json";
import { FEATURES } from "@/lib/featureFlags";
import {
  countGtdStressReadyEvents,
  createGtdStressEventReadModel,
  createJejuGtdStressResearchContext,
  type JejuGtdStressResearchContext,
} from "@/lib/series-market/gtdStressUiReadModel";
import {
  createVerifiedJejuReadModel,
  VerifiedMarketIntegrityError,
  type VerifiedMarketReadModel,
} from "@/lib/series-market/verifiedMarketReadModel";
import { VerifiedMarketDashboard } from "./VerifiedMarketDashboard";

const VietnamSupplyContent = lazy(() => import("./VietnamSupplyContent"));

let cachedModel: Promise<VerifiedMarketReadModel> | null = null;
let cachedGtdStressContext: Promise<JejuGtdStressResearchContext> | null = null;

function loadModel(): Promise<VerifiedMarketReadModel> {
  cachedModel ??= createVerifiedJejuReadModel({ canonicalImport, dataQuality, release, sourceManifest });
  return cachedModel;
}

function loadGtdStressContext(model: VerifiedMarketReadModel): Promise<JejuGtdStressResearchContext> {
  cachedGtdStressContext ??= import(
    "@/lib/series-market/datasets/jeju/v1/research/comparable-v0-exact-v1.json?raw"
  ).then(({ default: rawBundle }) =>
    createJejuGtdStressResearchContext({
      model,
      rawBundle,
      canonicalImport,
      datasetRelease: release,
    })
  );
  return cachedGtdStressContext;
}

export function VerifiedMarketJejuContent({
  forceIntegrityError = false,
  forceGtdStress = false,
  forceVietnamSupply = false,
}: {
  forceIntegrityError?: boolean;
  forceGtdStress?: boolean;
  forceVietnamSupply?: boolean;
}) {
  const [model, setModel] = useState<VerifiedMarketReadModel | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const task = forceIntegrityError
      ? Promise.reject(new VerifiedMarketIntegrityError("DEV integrity seam", "DEV_INTEGRITY_SEAM"))
      : loadModel();
    task.then((next) => {
      if (active) setModel(next);
    }).catch((error: unknown) => {
      if (active) setErrorCode(error instanceof VerifiedMarketIntegrityError ? error.code : "INTEGRITY_CHECK_FAILED");
    });
    return () => { active = false; };
  }, [forceIntegrityError]);

  if (errorCode) {
    return (
      <div className="mx-auto max-w-3xl border border-rose-500/40 bg-rose-500/5 p-6" data-testid="verified-market-integrity-error">
        <AlertTriangle className="h-7 w-7 text-rose-300" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">Release integrity check failed</h1>
        <p className="mt-2 text-sm text-muted-foreground">Trusted market evidence was not rendered. No partial or fallback values are shown.</p>
        <p className="mt-3 font-mono text-xs text-rose-300">{errorCode}</p>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-muted-foreground" data-testid="verified-market-loading">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        Validating committed Public Evidence...
      </div>
    );
  }

  const gtdStressEnabled =
    FEATURES.seriesMarketGtdStress || (import.meta.env.DEV && forceGtdStress);
  const vietnamSupplyEnabled =
    FEATURES.seriesMarketVietnamSupply || (import.meta.env.DEV && forceVietnamSupply);

  const jejuDashboard = (
    <VerifiedMarketDashboard
      model={model}
      gtdStress={gtdStressEnabled
        ? {
          readyEventCount: countGtdStressReadyEvents(model.events),
          loadEvent: async (eventId) =>
            createGtdStressEventReadModel(await loadGtdStressContext(model), eventId),
        }
        : undefined}
    />
  );

  if (!vietnamSupplyEnabled) return jejuDashboard;

  return (
    <Tabs defaultValue="jeju" className="min-w-0" data-testid="market-intelligence-surfaces">
      <div className="mb-5 overflow-x-auto border-b border-border/70 pb-3">
        <TabsList className="h-auto min-w-max bg-muted/25 p-1">
          <TabsTrigger value="jeju" className="min-h-10 gap-2 px-4">
            <Database className="h-4 w-4" aria-hidden="true" />
            Jeju Explorer
          </TabsTrigger>
          <TabsTrigger value="vietnam" className="min-h-10 gap-2 px-4">
            <MapPinned className="h-4 w-4" aria-hidden="true" />
            Vietnam Supply
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="jeju" className="mt-0">{jejuDashboard}</TabsContent>
      <TabsContent value="vietnam" className="mt-0">
        <Suspense fallback={(
          <div className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            Loading Vietnam supply evidence...
          </div>
        )}>
          <VietnamSupplyContent />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
