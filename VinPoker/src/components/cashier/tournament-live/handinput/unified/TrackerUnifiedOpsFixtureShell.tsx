import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Clock3,
  FlaskConical,
  LockKeyhole,
  RadioTower,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  TRACKER_OPS_ROLE_CAPABILITIES,
  type TrackerLauncherGroupV2,
  type TrackerOpsFailureCodeV2,
  type TrackerOpsRole,
  type TrackerTableContextV2,
  type TrackerTableSummaryV2,
} from "@/lib/tracker-unified-ops/contracts";
import {
  TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE,
  TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE,
  TRACKER_READY_CONTEXT_FIXTURE,
} from "@/lib/tracker-unified-ops/fixtures";
import { getTrackerFixtureTables } from "@/lib/tracker-unified-ops/fixturePresentation";
import { buildTrackerHandInputHrefV2 } from "@/lib/tracker-unified-ops/navigation";
import { TrackerOpsStatusRail } from "./TrackerOpsStatusRail";
import { TrackerReadOnlyRoster } from "./TrackerReadOnlyRoster";

const groupMeta: Record<
  TrackerLauncherGroupV2,
  { title: string; subtitle: string; accent: string }
> = {
  ready: {
    title: "Sẵn sàng",
    subtitle: "Floor đã bàn giao, Tracker có thể vào đúng bàn.",
    accent: "border-emerald-400/35",
  },
  active_hand: {
    title: "Đang có hand",
    subtitle: "Tiếp tục hand hiện tại, không mở hand mới.",
    accent: "border-[#d7b66f]/40",
  },
  needs_floor: {
    title: "Cần Floor xử lý",
    subtitle: "Tracker không tự sửa roster, mode hoặc stack.",
    accent: "border-amber-300/35",
  },
};

const contextTemplates = [
  TRACKER_READY_CONTEXT_FIXTURE,
  TRACKER_ACTIVE_HAND_CONTEXT_FIXTURE,
  TRACKER_NEEDS_FLOOR_CONTEXT_FIXTURE,
] as const;

function getTrackerFixtureContext(
  tournamentId: string,
  tournamentTableId: string,
  role: TrackerOpsRole,
): TrackerTableContextV2 | null {
  const template = contextTemplates.find(
    (context) => context.tournament_table_id === tournamentTableId,
  );
  if (!template) return null;
  return {
    ...template,
    tournament_id: tournamentId,
    capabilities: TRACKER_OPS_ROLE_CAPABILITIES[role],
  };
}

export function TrackerUnifiedOpsFixtureShell({
  tournamentId,
  tournamentTableId,
  role,
  embedded = false,
  routeError = null,
}: {
  tournamentId: string;
  tournamentTableId?: string | null;
  role: TrackerOpsRole;
  embedded?: boolean;
  routeError?: TrackerOpsFailureCodeV2 | "missing_tournament" | null;
}) {
  const tables = getTrackerFixtureTables(tournamentId);
  const context = tournamentTableId
    ? getTrackerFixtureContext(tournamentId, tournamentTableId, role)
    : null;

  return (
    <main
      className={`relative isolate overflow-hidden bg-[#0a080b] text-[#f4eee5] ${
        embedded
          ? "min-h-[620px] rounded-[28px] border border-white/10"
          : "min-h-[100dvh]"
      }`}
      data-testid="tracker-unified-ops-shell"
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 12% 8%, rgba(76, 17, 36, 0.38), transparent 32%), radial-gradient(circle at 86% 18%, rgba(25, 100, 72, 0.16), transparent 28%), linear-gradient(155deg, #0a080b 0%, #110a0f 48%, #08090a 100%)",
        }}
      />
      <div className="mx-auto w-full max-w-[1480px] px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 lg:px-7">
        <header className="mb-4 flex flex-col gap-3 border-b border-white/8 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.24em] text-[#d7b66f]">
                VinPoker Live Operations
              </span>
              <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-100">
                <FlaskConical className="h-3 w-3" />
                Bản mẫu an toàn
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">
              Tracker Unified Ops
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#a99fa6]">
              Floor giữ roster và stack. Tracker vận hành hand. ChipMaster ghi nhận chip vật lý.
            </p>
          </div>
          <div className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-xs text-[#b8adb4]">
            <LockKeyhole className="h-4 w-4 text-emerald-300" />
            Không có nút ghi dữ liệu trong PR này
          </div>
        </header>

        {routeError ? (
          <RouteError error={routeError} />
        ) : context ? (
          <ExactTableView context={context} role={role} />
        ) : tournamentTableId ? (
          <RouteError error="table_not_found" />
        ) : (
          <Launcher tournamentId={tournamentId} tables={tables} />
        )}
      </div>
    </main>
  );
}

function Launcher({
  tournamentId,
  tables,
}: {
  tournamentId: string;
  tables: readonly TrackerTableSummaryV2[];
}) {
  const groups: TrackerLauncherGroupV2[] = [
    "ready",
    "active_hand",
    "needs_floor",
  ];

  return (
    <div className="space-y-4" data-testid="tracker-table-launcher">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#d8cfd4]">Chọn đúng bàn để tiếp tục</p>
          <p className="mt-1 text-xs text-[#8f858c]">
            Console exact-table không hỏi lại giải hoặc bàn.
          </p>
        </div>
        <span className="font-mono text-[11px] text-[#786f75]">
          t={tournamentId.slice(0, 8)}…
        </span>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        {groups.map((group) => {
          const meta = groupMeta[group];
          const groupTables = tables.filter(
            (table) => table.launcher_group === group,
          );
          return (
            <section
              key={group}
              className={`overflow-hidden rounded-[24px] border bg-[#100d12]/90 ${meta.accent}`}
            >
              <div className="border-b border-white/8 px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-[#f4eee5]">{meta.title}</h2>
                  <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white/[0.06] px-2 font-mono text-xs text-[#cfc4ca]">
                    {groupTables.length}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-[#968c92]">{meta.subtitle}</p>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {groupTables.map((table) => (
                  <LauncherRow
                    key={table.tournament_table_id}
                    tournamentId={tournamentId}
                    table={table}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LauncherRow({
  tournamentId,
  table,
}: {
  tournamentId: string;
  table: TrackerTableSummaryV2;
}) {
  const needsFloor = table.launcher_group === "needs_floor";
  const href = needsFloor
    ? `/ops/tournaments/${tournamentId}?tab=tables`
    : buildTrackerHandInputHrefV2(tournamentId, table.tournament_table_id);
  const actionLabel = needsFloor
    ? "Mở Floor"
    : table.active_hand
      ? `Tiếp tục Hand #${table.active_hand.hand_number}`
      : `Mở Hand #${table.next_hand_number}`;

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-[#f4eee5]">{table.table_name}</p>
          <p className="mt-1 flex items-center gap-3 text-xs text-[#93898f]">
            <span className="inline-flex items-center gap-1">
              <UsersRound className="h-3.5 w-3.5" />
              {table.player_count} người
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              Hand #{table.next_hand_number}
            </span>
          </p>
        </div>
        <span className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-[#8f858c]">
          #{table.table_number}
        </span>
      </div>
      <Link
        to={href}
        className={`mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b66f] ${
          needsFloor
            ? "border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15"
            : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15"
        }`}
      >
        {actionLabel}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function ExactTableView({
  context,
  role,
}: {
  context: TrackerTableContextV2;
  role: TrackerOpsRole;
}) {
  const canStart = context.capabilities.includes("start_hand");
  const floorBlocker = context.readiness.blockers.find(
    (item) => item.owner === "floor",
  );

  return (
    <div className="space-y-4" data-testid="tracker-exact-table">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            to={buildTrackerHandInputHrefV2(context.tournament_id)}
            aria-label="Quay lại danh sách bàn"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-[#d8cfd4] hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b66f]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black sm:text-2xl">{context.table_name}</h2>
              <span className="rounded-full border border-[#d7b66f]/30 bg-[#d7b66f]/10 px-2.5 py-1 font-mono text-[10px] font-bold text-[#e7ca88]">
                TT · {context.tournament_table_id.slice(0, 8)}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#93898f]">
              Level {context.level?.number ?? "—"} · {context.level?.small_blind.toLocaleString("vi-VN") ?? "—"}/
              {context.level?.big_blind.toLocaleString("vi-VN") ?? "—"} · BBA {context.level?.ante.toLocaleString("vi-VN") ?? "—"}
            </p>
          </div>
        </div>
        <span className="inline-flex min-h-10 items-center gap-2 self-start rounded-xl border border-white/10 bg-white/[0.035] px-3 text-xs text-[#b8adb4] sm:self-auto">
          <RadioTower className="h-4 w-4 text-emerald-300" />
          Vai trò xem: {role}
        </span>
      </div>

      <TrackerOpsStatusRail context={context} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <TrackerReadOnlyRoster roster={context.roster} />
        <aside className="space-y-3">
          <section className="rounded-[24px] border border-white/10 bg-[#100d12]/90 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d7b66f]">
              Bước hiện tại
            </p>
            <h3 className="mt-2 text-lg font-black text-[#f4eee5]">
              {context.active_hand
                ? `Tiếp tục Hand #${context.active_hand.hand_number}`
                : floorBlocker
                  ? "Chờ Floor hoàn tất bàn giao"
                  : `Mở Hand #${context.next_hand_number}`}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[#9d9399]">
              {canStart
                ? "Tracker có quyền vận hành hand, nhưng PR1 chỉ là fixture nên mọi writer đang khóa."
                : "Vai trò này chỉ xem và bàn giao. Server vẫn là nơi xác minh quyền thật."}
            </p>

            {canStart ? (
              <button
                type="button"
                disabled
                className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 font-bold text-emerald-200 opacity-70"
              >
                <LockKeyhole className="h-4 w-4" />
                {context.active_hand
                  ? `Tiếp tục Hand #${context.active_hand.hand_number}`
                  : `Bắt đầu Hand #${context.next_hand_number}`}
                <span className="rounded bg-black/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                  Chờ RPC V2
                </span>
              </button>
            ) : role === "chipmaster" ? (
              <Link
                to="/ops/chip-ops"
                className="mt-4 flex min-h-12 w-full items-center justify-between rounded-xl border border-[#d7b66f]/30 bg-[#d7b66f]/10 px-4 font-bold text-[#ecd69d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b66f]"
              >
                Mở Chip Ops
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link
                to={`/ops/tournaments/${context.tournament_id}?tab=tables`}
                className="mt-4 flex min-h-12 w-full items-center justify-between rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 font-bold text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                Mở Floor xử lý bàn
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </section>

          <section className="rounded-[24px] border border-white/10 bg-[#100d12]/90 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#cfc4ca]">
                Readiness
              </p>
              <span className="font-mono text-[10px] text-[#786f75]">
                {context.context_version}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {context.readiness.blockers.length === 0 &&
              context.readiness.warnings.length === 0 ? (
                <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2.5 text-sm text-emerald-200">
                  Không có blocker.
                </p>
              ) : (
                [...context.readiness.blockers, ...context.readiness.warnings].map(
                  (item) => (
                    <div
                      key={`${item.severity}-${item.code}`}
                      className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2.5"
                    >
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                      <div>
                        <p className="text-sm font-semibold text-[#e7dde2]">
                          {readinessLabel(item.code)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#8f858c]">
                          Chủ trì: {item.owner}
                        </p>
                      </div>
                    </div>
                  ),
                )
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function RouteError({
  error,
}: {
  error: TrackerOpsFailureCodeV2 | "missing_tournament";
}) {
  const copy =
    error === "missing_tournament"
      ? "Thiếu mã giải. Hãy mở từ Tracker hoặc dùng tham số ?t=<tournament_id>."
      : error === "ambiguous_table_identity"
        ? "ID bàn khớp nhiều bản ghi. V2 dừng lại để Floor xác minh, không tự chọn bàn đầu tiên."
        : "Không tìm thấy exact tournament table trong fixture. Writer cũ không được mở thay thế.";

  return (
    <section className="mx-auto max-w-xl rounded-[26px] border border-amber-300/30 bg-amber-300/[0.07] p-6 text-center">
      <CircleAlert className="mx-auto h-9 w-9 text-amber-300" />
      <h2 className="mt-3 text-lg font-black">Không thể mở bàn an toàn</h2>
      <p className="mt-2 text-sm leading-6 text-[#b5a9b0]">{copy}</p>
      <Link
        to="/tracker"
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm font-bold text-[#eee5e9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b66f]"
      >
        <RefreshCw className="h-4 w-4" />
        Quay lại Tracker
      </Link>
    </section>
  );
}

function readinessLabel(code: string): string {
  const labels: Record<string, string> = {
    tracker_mode_required: "Chuyển bàn sang Live Tracker",
    not_enough_players: "Xếp đủ người chơi",
    chip_set_not_bound: "Chip set chưa được gắn",
    active_hand_exists: "Bàn đang có hand",
  };
  return labels[code] ?? code.replace(/_/g, " ");
}
