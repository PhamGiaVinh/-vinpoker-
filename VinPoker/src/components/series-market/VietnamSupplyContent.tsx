import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import release from "@/lib/series-market/datasets/vietnam/schedule-supply/v1/release.json";
import rawArtifact from "@/lib/series-market/datasets/vietnam/schedule-supply/v1/research/schedule-supply-v1.json?raw";
import receipt from "@/lib/series-market/datasets/vietnam/schedule-supply/v1/research/schedule-supply-v1.receipt.json";
import correction from "@/lib/series-market/datasets/vietnam/schedule-supply/v1/corrections/d1a-correction-001-center-p-after-dark.json";
import { SeriesMarketValidationError } from "@/lib/series-market/normalization";
import {
  createVietnamSupplyReadModel,
  type VietnamSupplyReadModel,
} from "@/lib/series-market/vietnamSupplyReadModel";
import { VietnamMarketPulse } from "./VietnamMarketPulse";
import { VietnamSupplyDashboard } from "./VietnamSupplyDashboard";

let cachedModel: Promise<VietnamSupplyReadModel> | null = null;

function loadModel(): Promise<VietnamSupplyReadModel> {
  cachedModel ??= createVietnamSupplyReadModel({
    rawArtifact,
    release,
    receipt,
    correction,
  });
  return cachedModel;
}

export function VietnamSupplyContent({
  forceIntegrityError = false,
}: {
  forceIntegrityError?: boolean;
}) {
  const [model, setModel] = useState<VietnamSupplyReadModel | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const task = forceIntegrityError
      ? Promise.reject(new SeriesMarketValidationError(
          "DEV Vietnam supply integrity seam",
          "DEV_VIETNAM_SUPPLY_INTEGRITY_SEAM",
        ))
      : loadModel();
    task
      .then((next) => {
        if (active) setModel(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setErrorCode(
          error instanceof SeriesMarketValidationError
            ? error.code
            : "VIETNAM_SUPPLY_INTEGRITY_CHECK_FAILED",
        );
      });
    return () => { active = false; };
  }, [forceIntegrityError]);

  if (errorCode) {
    return (
      <div data-testid="vietnam-supply-integrity-error">
        <VietnamMarketPulse state="unavailable" />
        <div className="mx-auto mt-6 max-w-3xl border border-rose-500/40 bg-rose-500/5 p-6">
          <AlertTriangle className="h-7 w-7 text-rose-300" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">Vietnam supply integrity check failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The corrected artifact did not pass its trusted evidence adapter. No partial or fallback market values are shown.
          </p>
          <p className="mt-3 break-all font-mono text-xs text-rose-300">{errorCode}</p>
        </div>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-muted-foreground" data-testid="vietnam-supply-loading">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        Validating corrected Vietnam supply evidence...
      </div>
    );
  }

  return <VietnamSupplyDashboard model={model} />;
}

export default VietnamSupplyContent;
