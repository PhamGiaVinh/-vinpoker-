import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { OwnerDailyDigestView, type OwnerDigestViewState } from "@/ops/digest/OwnerDailyDigestView";
import {
  loadOwnerDailyDigestReport,
  type OwnerDailyDigestReadSource,
} from "@/ops/digest/ownerDailyDigestReadAdapter";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";

export default function OpsOwnerDailyDigest() {
  const navigate = useNavigate();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const allowedClubIds = capabilities.moduleClubIds("daily-digest");
  const clubId = selectedClubId
    && (capabilities.isSuperAdmin || allowedClubIds.includes(selectedClubId))
    ? selectedClubId
    : null;
  const [state, setState] = useState<OwnerDigestViewState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!clubId || capabilities.loading || capabilities.scopeError) return;
    let current = true;
    setRefreshing(true);
    setState({ kind: "loading" });

    void resolveReadSource()
      .then((source) => loadOwnerDailyDigestReport(source, { clubId }))
      .then((report) => {
        if (current) setState(report ? { kind: "ready", report } : { kind: "empty" });
      })
      .catch((error: unknown) => {
        if (!current) return;
        const code = safeErrorCode(error);
        setState(code === "OWNER_DIGEST_READ_BOUNDARY_NOT_LIVE"
          ? { kind: "unavailable", code }
          : { kind: "error", code });
      })
      .finally(() => {
        if (current) setRefreshing(false);
      });

    return () => {
      current = false;
    };
  }, [capabilities.loading, capabilities.scopeError, clubId, revision]);

  const clubName = capabilities.clubs.find((club) => club.id === clubId)?.name ?? "CLB đã chọn";

  return (
    <OwnerDailyDigestView
      clubName={clubName}
      state={capabilities.scopeError ? { kind: "error", code: "OWNER_DIGEST_SCOPE_UNAVAILABLE" } : state}
      refreshing={refreshing}
      environmentLabel={import.meta.env.DEV ? "TEST" : undefined}
      onRefresh={() => setRevision((value) => value + 1)}
      onChangeClub={() => navigate("/ops/daily-digest")}
    />
  );
}

async function resolveReadSource(): Promise<OwnerDailyDigestReadSource> {
  if (import.meta.env.DEV) {
    const fixture = await import("@/ops/digest/ownerDailyDigestFixtures");
    return fixture.ownerDailyDigestFixtureSource;
  }
  const source = await import("@/ops/digest/ownerDailyDigestSupabaseRuntimeSource");
  return source.ownerDailyDigestSupabaseSource;
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error) || !/^[A-Z0-9_]+$/u.test(error.message)) {
    return "OWNER_DIGEST_READ_FAILED";
  }
  return error.message;
}
