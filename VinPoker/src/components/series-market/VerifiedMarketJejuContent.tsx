import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import canonicalImport from "@/lib/series-market/datasets/jeju/v1/canonical/jeju_import_v1.json";
import dataQuality from "@/lib/series-market/datasets/jeju/v1/data-quality.json";
import release from "@/lib/series-market/datasets/jeju/v1/release.json";
import sourceManifest from "@/lib/series-market/datasets/jeju/v1/source-manifest.json";
import {
  createVerifiedJejuReadModel,
  VerifiedMarketIntegrityError,
  type VerifiedMarketReadModel,
} from "@/lib/series-market/verifiedMarketReadModel";
import { VerifiedMarketDashboard } from "./VerifiedMarketDashboard";

let cachedModel: Promise<VerifiedMarketReadModel> | null = null;

function loadModel(): Promise<VerifiedMarketReadModel> {
  cachedModel ??= createVerifiedJejuReadModel({ canonicalImport, dataQuality, release, sourceManifest });
  return cachedModel;
}

export function VerifiedMarketJejuContent({ forceIntegrityError = false }: { forceIntegrityError?: boolean }) {
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

  return <VerifiedMarketDashboard model={model} />;
}
