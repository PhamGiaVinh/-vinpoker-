import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Building2, CalendarRange, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import type { OwnerDailyDigestClubScopeSource } from "@/ops/digest/ownerDailyDigestClubScopeSource";
import { OwnerDigestAccessPanel } from "@/ops/digest/OwnerDigestAccessPanel";
import { OwnerDigestRegenerationButton } from "@/ops/digest/OwnerDigestRegenerationButton";
import {
  OwnerDailyDigestView,
  type DigestGenerationNotice,
  type OwnerDigestViewState,
} from "@/ops/digest/OwnerDailyDigestView";
import {
  loadOwnerDailyDigestReport,
  type OwnerDailyDigestReadSource,
} from "@/ops/digest/ownerDailyDigestReadAdapter";
import type {
  OwnerDailyDigestV2Club,
  OwnerDailyDigestV2Source,
} from "@/ops/digest/ownerDailyDigestV2Source";

type DigestClub = Pick<OwnerDailyDigestV2Club, "id" | "name"> & Partial<Pick<OwnerDailyDigestV2Club, "accessLevel" | "canManageAccess">>;

export default function OwnerDailyDigest() {
  const { user, isAdmin, isClubAdmin, isClubOwner, loading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const useV2 = FEATURES.ownerDailyDigestSnapshotV2;
  const authorized = isAdmin || isClubOwner || isClubAdmin;
  const [redirectReady, setRedirectReady] = useState(false);
  const [clubs, setClubs] = useState<DigestClub[]>([]);
  const [clubsLoading, setClubsLoading] = useState(true);
  const [clubsError, setClubsError] = useState(false);
  const [state, setState] = useState<OwnerDigestViewState>({ kind: "loading" });
  const [generationNotice, setGenerationNotice] = useState<DigestGenerationNotice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [revision, setRevision] = useState(0);
  const [v2Source, setV2Source] = useState<OwnerDailyDigestV2Source | null>(null);

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

    const request = useV2
      ? resolveV2Source().then((source) => {
          if (current) setV2Source(source);
          return source.listClubs();
        })
      : resolveClubScopeSource().then((source) => source.listClubs());

    void request.then((data) => {
      if (!current) return;
      setClubs(data);
      setClubsLoading(false);
    }).catch(() => {
      if (!current) return;
      setClubs([]);
      setClubsError(true);
      setClubsLoading(false);
    });

    return () => { current = false; };
  }, [authorized, useV2, user]);

  const requestedClubId = searchParams.get("club");
  const requestedDate = validDate(searchParams.get("date"));
  const selectedClub = useMemo(
    () => requestedClubId
      ? clubs.find((club) => club.id === requestedClubId) ?? null
      : clubs[0] ?? null,
    [clubs, requestedClubId],
  );
  const requestedClubDenied = Boolean(requestedClubId && !selectedClub && clubs.length > 0);

  useEffect(() => {
    if (!selectedClub || clubsLoading || clubsError || (useV2 && !v2Source)) return;
    let current = true;
    setRefreshing(true);
    setState({ kind: "loading" });
    setGenerationNotice(null);

    const request = useV2 && v2Source
      ? v2Source.loadSnapshot({ clubId: selectedClub.id, reportDate: requestedDate ?? undefined })
          .then((result) => {
            if (!current) return;
            setState(result.report ? { kind: "ready", report: result.report } : { kind: "empty" });
            setGenerationNotice(generationNoticeFor(result));
          })
      : resolveReadSource()
          .then((source) => loadOwnerDailyDigestReport(source, { clubId: selectedClub.id }))
          .then((report) => {
            if (current) setState(report ? { kind: "ready", report } : { kind: "empty" });
          });

    void request.catch((error: unknown) => {
      if (!current) return;
      const code = safeErrorCode(error);
      setState(code === "OWNER_DIGEST_READ_BOUNDARY_NOT_LIVE" || code === "OWNER_DIGEST_V2_BOUNDARY_NOT_LIVE"
        ? { kind: "unavailable", code }
        : { kind: "error", code });
    }).finally(() => {
      if (current) setRefreshing(false);
    });

    return () => { current = false; };
  }, [clubsError, clubsLoading, requestedDate, revision, selectedClub, useV2, v2Source]);

  async function requestRegeneration(reportDate: string) {
    if (!v2Source || !selectedClub) return;
    setRegenerating(true);
    try {
      await v2Source.requestRegeneration(selectedClub.id, reportDate, crypto.randomUUID());
      setGenerationNotice({ tone: "info", text: "Yêu cầu tạo lại đã được xếp hàng. Báo cáo cũ vẫn được giữ nguyên cho tới khi server hoàn tất revision mới." });
      toast.success("Đã xếp yêu cầu tạo lại báo cáo");
    } catch {
      toast.error("Chưa thể tạo lại báo cáo. Không có dữ liệu nào bị thay đổi.");
    } finally {
      setRegenerating(false);
    }
  }

  if (loading || (!authorized && !redirectReady)) return null;
  if (!user) return <Navigate to="/auth?next=%2Fclub%2Fadmin%2Fdaily-digest" replace />;
  if (!authorized) return <Navigate to="/" replace />;

  const reportDate = requestedDate ?? (state.kind === "ready" ? state.report.reportDate : null);
  const extraActions = useV2 && v2Source && selectedClub ? (
    <>
      {selectedClub.canManageAccess && <OwnerDigestAccessPanel clubId={selectedClub.id} source={v2Source} />}
      {selectedClub.canManageAccess && reportDate && (
        <OwnerDigestRegenerationButton
          reportDate={reportDate}
          busy={regenerating}
          onConfirm={() => void requestRegeneration(reportDate)}
        />
      )}
    </>
  ) : undefined;

  return (
    <main className="mx-auto w-full max-w-[1500px] px-3 py-5 sm:px-5 lg:px-8 lg:py-8">
      {(clubs.length > 1 || useV2) && selectedClub && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-[#07100c] px-4 py-3 sm:grid-cols-2 lg:flex lg:items-end lg:justify-between">
          <label htmlFor="daily-digest-club" className="grid gap-2 text-sm font-semibold text-[#d7e3dc]">
            <span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-emerald-300" aria-hidden="true" /> CLB đang xem</span>
            <select
              id="daily-digest-club"
              value={selectedClub.id}
              onChange={(event) => updateQuery(setSearchParams, event.target.value, requestedDate)}
              className="min-h-11 min-w-64 rounded-xl border border-emerald-300/20 bg-[#0b1711] px-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
            </select>
          </label>
          {useV2 && (
            <label htmlFor="daily-digest-date" className="grid gap-2 text-sm font-semibold text-[#d7e3dc]">
              <span className="flex items-center gap-2"><CalendarRange className="h-4 w-4 text-emerald-300" aria-hidden="true" /> Ngày báo cáo</span>
              <input
                id="daily-digest-date"
                type="date"
                value={requestedDate ?? ""}
                onChange={(event) => updateQuery(setSearchParams, selectedClub.id, validDate(event.target.value))}
                className="min-h-11 rounded-xl border border-emerald-300/20 bg-[#0b1711] px-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              />
            </label>
          )}
        </div>
      )}

      {clubsLoading ? (
        <div className="h-80 animate-pulse rounded-3xl border border-white/7 bg-[#07100c]" aria-label="Đang tải danh sách CLB" />
      ) : clubsError ? (
        <PageMessage title="Không tải được CLB" body="Phiên đăng nhập vẫn được giữ nguyên. Hãy thử tải lại trang sau ít phút." />
      ) : requestedClubDenied ? (
        <PageMessage title="Bạn không có quyền xem báo cáo này" body="Đường dẫn không thuộc phạm vi CLB được server cấp cho tài khoản hiện tại. Hệ thống không tự chuyển sang một CLB khác." />
      ) : !selectedClub ? (
        <PageMessage title="Chưa được gán CLB" body="Tài khoản này chưa có quyền xem Báo cáo ngày của CLB nào." />
      ) : (
        <OwnerDailyDigestView
          clubName={selectedClub.name}
          state={state}
          refreshing={refreshing}
          environmentLabel={import.meta.env.DEV ? "TEST" : undefined}
          onRefresh={() => setRevision((value) => value + 1)}
          extraActions={extraActions}
          generationNotice={generationNotice}
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
  if (import.meta.env.DEV) return (await import("@/ops/digest/ownerDailyDigestFixtures")).ownerDailyDigestFixtureSource;
  return (await import("@/ops/digest/ownerDailyDigestPrimaryRuntimeSource")).ownerDailyDigestPrimarySupabaseSource;
}

async function resolveClubScopeSource(): Promise<OwnerDailyDigestClubScopeSource> {
  if (import.meta.env.DEV) return (await import("@/ops/digest/ownerDailyDigestFixtures")).ownerDailyDigestFixtureClubScopeSource;
  return (await import("@/ops/digest/ownerDailyDigestClubScopeRuntimeSource")).ownerDailyDigestClubScopeRuntimeSource;
}

async function resolveV2Source(): Promise<OwnerDailyDigestV2Source> {
  if (import.meta.env.DEV) return (await import("@/ops/digest/ownerDailyDigestV2Fixtures")).ownerDailyDigestV2FixtureSource;
  return (await import("@/ops/digest/ownerDailyDigestV2RuntimeSource")).ownerDailyDigestV2RuntimeSource;
}

function generationNoticeFor(result: Awaited<ReturnType<OwnerDailyDigestV2Source["loadSnapshot"]>>): DigestGenerationNotice | null {
  if (result.lastGeneration?.status === "FAILED") {
    return {
      tone: "warning",
      text: result.report
        ? `Đang hiển thị snapshot tạo lúc ${formatDateTime(result.report.generatedAt)}. Lần tạo mới gần nhất thất bại; không thay bằng số 0.`
        : `Chưa thể tạo báo cáo cho ngày đã chọn. Báo cáo gần nhất có sẵn: ${result.latestAvailableBusinessDate ?? "chưa có"}.`,
    };
  }
  if (!result.report && result.latestAvailableBusinessDate) {
    return { tone: "info", text: `Không có snapshot cho ngày đã chọn. Báo cáo gần nhất là ngày ${result.latestAvailableBusinessDate}; hệ thống không tự động chuyển sang ngày đó.` };
  }
  return null;
}

function updateQuery(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  clubId: string,
  reportDate: string | null,
) {
  const next = new URLSearchParams({ club: clubId });
  if (reportDate) next.set("date", reportDate);
  setSearchParams(next, { replace: true });
}

function validDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : null;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error) || !/^[A-Z0-9_]+$/u.test(error.message)) return "OWNER_DIGEST_READ_FAILED";
  return error.message;
}
