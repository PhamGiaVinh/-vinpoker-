import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Building2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { OwnerDailyDigestView, type OwnerDigestViewState } from "@/ops/digest/OwnerDailyDigestView";
import {
  loadOwnerDailyDigestReport,
  type OwnerDailyDigestReadSource,
} from "@/ops/digest/ownerDailyDigestReadAdapter";

type ClubOption = { id: string; name: string };

export default function OwnerDailyDigest() {
  const { user, isAdmin, isClubOwner, loading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const authorized = isAdmin || isClubOwner;
  const [redirectReady, setRedirectReady] = useState(false);
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [clubsLoading, setClubsLoading] = useState(true);
  const [clubsError, setClubsError] = useState(false);
  const [state, setState] = useState<OwnerDigestViewState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (loading || authorized) {
      setRedirectReady(false);
      return;
    }
    const timeout = window.setTimeout(() => setRedirectReady(true), 1500);
    return () => window.clearTimeout(timeout);
  }, [authorized, loading]);

  useEffect(() => {
    if (!user || !authorized) return;
    let current = true;
    setClubsLoading(true);
    setClubsError(false);

    const query = isAdmin
      ? supabase.from("clubs").select("id, name").order("name").limit(100)
      : supabase.from("clubs").select("id, name").eq("owner_id", user.id).order("name");

    void query.then(({ data, error }) => {
      if (!current) return;
      if (error) {
        setClubs([]);
        setClubsError(true);
      } else {
        setClubs((data ?? []).map((club) => ({ id: club.id, name: club.name })));
      }
      setClubsLoading(false);
    });

    return () => {
      current = false;
    };
  }, [authorized, isAdmin, user]);

  const requestedClubId = searchParams.get("club");
  const selectedClub = useMemo(
    () => clubs.find((club) => club.id === requestedClubId) ?? clubs[0] ?? null,
    [clubs, requestedClubId],
  );

  useEffect(() => {
    if (!selectedClub || clubsLoading || clubsError) return;
    let current = true;
    setRefreshing(true);
    setState({ kind: "loading" });

    void resolveReadSource()
      .then((source) => loadOwnerDailyDigestReport(source, { clubId: selectedClub.id }))
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
  }, [clubsError, clubsLoading, revision, selectedClub]);

  if (loading || (!authorized && !redirectReady)) return null;
  if (!user) {
    return <Navigate to="/auth?next=%2Fclub%2Fadmin%2Fdaily-digest" replace />;
  }
  if (!authorized) return <Navigate to="/" replace />;

  return (
    <main className="mx-auto w-full max-w-[1500px] px-3 py-5 sm:px-5 lg:px-8 lg:py-8">
      {clubs.length > 1 && selectedClub && (
        <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#07100c] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label htmlFor="daily-digest-club" className="flex items-center gap-2 text-sm font-semibold text-[#d7e3dc]">
            <Building2 className="h-4 w-4 text-emerald-300" aria-hidden="true" /> CLB đang xem
          </label>
          <select
            id="daily-digest-club"
            value={selectedClub.id}
            onChange={(event) => setSearchParams({ club: event.target.value }, { replace: true })}
            className="min-h-11 min-w-64 rounded-xl border border-emerald-300/20 bg-[#0b1711] px-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
          </select>
        </div>
      )}

      {clubsLoading ? (
        <div className="h-80 animate-pulse rounded-3xl border border-white/7 bg-[#07100c]" aria-label="Đang tải danh sách CLB" />
      ) : clubsError ? (
        <PageMessage title="Không tải được CLB" body="Phiên đăng nhập vẫn được giữ nguyên. Hãy thử tải lại trang sau ít phút." />
      ) : !selectedClub ? (
        <PageMessage title="Chưa có CLB để xem" body="Tài khoản này chưa sở hữu CLB nào có Báo cáo ngày." />
      ) : (
        <OwnerDailyDigestView
          clubName={selectedClub.name}
          state={state}
          refreshing={refreshing}
          environmentLabel={import.meta.env.DEV ? "TEST" : undefined}
          onRefresh={() => setRevision((value) => value + 1)}
        />
      )}
    </main>
  );
}

function PageMessage({ title, body }: { title: string; body: string }) {
  return (
    <section role="status" className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-amber-300/20 bg-amber-300/8 px-5 text-center">
      <ShieldCheck className="h-8 w-8 text-amber-200" aria-hidden="true" />
      <h1 className="mt-4 text-xl font-semibold text-white">{title}</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#b9c8c0]">{body}</p>
    </section>
  );
}

async function resolveReadSource(): Promise<OwnerDailyDigestReadSource> {
  if (import.meta.env.DEV) {
    const fixture = await import("@/ops/digest/ownerDailyDigestFixtures");
    return fixture.ownerDailyDigestFixtureSource;
  }
  const source = await import("@/ops/digest/ownerDailyDigestPrimaryRuntimeSource");
  return source.ownerDailyDigestPrimarySupabaseSource;
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error) || !/^[A-Z0-9_]+$/u.test(error.message)) {
    return "OWNER_DIGEST_READ_FAILED";
  }
  return error.message;
}
