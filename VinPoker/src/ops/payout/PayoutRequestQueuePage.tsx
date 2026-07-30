import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FEATURES } from "@/lib/featureFlags";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import {
  listPayoutRequests,
  payoutRequestErrorMessage,
  reviewPayoutRequest,
  type PayoutRequestRow,
  type PayoutRequestStatus,
} from "@/ops/payout/payoutRequestApi";

const money = (value: number | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
      maximumFractionDigits: 0,
    }).format(value);

const statusLabel: Record<PayoutRequestStatus, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  cancelled: "Đã hủy",
  stale: "Dữ liệu đã đổi",
  superseded: "Đã được trả trực tiếp",
};

export default function PayoutRequestQueuePage() {
  const navigate = useNavigate();
  const client = useSupabaseClient();
  const { user } = useOpsAuth();
  const { cashierClubIds, clubs } = useOpsCapabilities();
  const [clubId, setClubId] = useState(cashierClubIds[0] ?? "");
  const [status, setStatus] = useState<PayoutRequestStatus | "all">("pending");
  const [rows, setRows] = useState<PayoutRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<PayoutRequestRow | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const availableClubs = useMemo(
    () => cashierClubIds.map((id) => ({
      id,
      name: clubs.find((club) => club.id === id)?.name ?? `CLB ${id.slice(0, 8)}`,
    })),
    [cashierClubIds, clubs],
  );

  useEffect(() => {
    if (!clubId && cashierClubIds[0]) setClubId(cashierClubIds[0]);
  }, [cashierClubIds, clubId]);

  useEffect(() => {
    if (!clubId || !FEATURES.floorPayoutRequestFlow) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void listPayoutRequests(client, clubId, status === "all" ? null : status)
      .then((result) => {
        if (!active) return;
        setRows(result.requests);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setRows([]);
        setError(payoutRequestErrorMessage(cause));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, clubId, revision, status]);

  if (!FEATURES.floorPayoutRequestFlow) {
    return <Navigate to="/ops/cashier" replace />;
  }

  const submitReview = async (decision: "approve" | "reject") => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      await reviewPayoutRequest(client, {
        requestId: selected.id,
        decision,
        reviewNote: reviewNote.trim() || null,
      });
      toast.success(decision === "approve"
        ? "Đã kiểm tra và xử lý đề nghị"
        : "Đã từ chối đề nghị");
      setSelected(null);
      setReviewNote("");
      refresh();
    } catch (cause) {
      toast.error(payoutRequestErrorMessage(cause));
      setSelected(null);
      setReviewNote("");
      refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate("/ops/cashier")}
            className="mb-3 flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-[#91a49b] hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Quay lại Cashier
          </button>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">Dual control</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Đề nghị trả thưởng</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#91a49b]">
            Chỉ ghi ledger sau khi một Owner/Cashier khác đối chiếu snapshot server. Hệ thống không chuyển tiền.
          </p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={refresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Làm mới
        </Button>
      </header>

      <div className="grid gap-3 rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:grid-cols-2">
        <label className="text-sm text-[#b9c8c0]">
          <span className="mb-2 block">CLB</span>
          <select
            value={clubId}
            onChange={(event) => setClubId(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-white"
          >
            {availableClubs.map((club) => (
              <option key={club.id} value={club.id}>{club.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-[#b9c8c0]">
          <span className="mb-2 block">Trạng thái</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as PayoutRequestStatus | "all")}
            className="min-h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-white"
          >
            <option value="pending">Chờ duyệt</option>
            <option value="approved">Đã duyệt</option>
            <option value="rejected">Từ chối</option>
            <option value="cancelled">Đã hủy</option>
            <option value="stale">Dữ liệu đã đổi</option>
            <option value="superseded">Đã được trả trực tiếp</option>
            <option value="all">Tất cả</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex min-h-44 items-center justify-center rounded-3xl border border-white/10"
        >
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-amber-300" />
          <span className="text-sm text-[#91a49b]">Đang tải hàng chờ…</span>
        </div>
      ) : error ? (
        <div role="alert" className="rounded-3xl border border-rose-300/20 bg-rose-300/5 p-5 text-rose-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm leading-6">{error}</p>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
          <p className="mt-3 text-sm text-[#91a49b]">Không có đề nghị trong bộ lọc này.</p>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {rows.map((row) => {
            const requesterIsReviewer = row.requestedBy === user?.id;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  setSelected(row);
                  setReviewNote("");
                }}
                className="min-h-36 rounded-3xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.04]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{row.tournamentName}</p>
                    <p className="mt-1 text-sm text-[#91a49b]">
                      Hạng #{row.finishedPlace} · {row.recipientName}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
                <p className="mt-4 font-mono text-lg font-semibold text-emerald-200">
                  {money(row.prizeAmount)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#789084]">
                  <span>Floor: {row.requesterName}</span>
                  {requesterIsReviewer && <span className="text-amber-300">· Bạn không thể tự duyệt</span>}
                  {!row.snapshotMatches && <span className="text-rose-300">· Snapshot đã đổi</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog
        open={selected != null}
        onOpenChange={(open) => !open && !submitting && setSelected(null)}
      >
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto border-white/10 bg-[#0a110e] text-white [&>button:last-child]:grid [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:place-items-center">
          <DialogHeader>
            <DialogTitle>Đối chiếu đề nghị hạng #{selected?.finishedPlace}</DialogTitle>
            <DialogDescription className="text-[#91a49b]">
              Số tiền và người nhận do server suy ra; người duyệt phải khác người tạo.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <SnapshotCard
                  title="Snapshot lúc Floor tạo"
                  recipient={selected.recipientName}
                  amount={selected.prizeAmount}
                />
                <SnapshotCard
                  title="Dữ liệu server hiện tại"
                  recipient={selected.currentRecipientName}
                  amount={selected.currentPrizeAmount}
                  changed={!selected.snapshotMatches}
                />
              </div>

              {!selected.snapshotMatches && (
                <div className="flex items-start gap-3 rounded-2xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-100">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>
                    Dữ liệu đã đổi. Khi bấm kiểm tra lại, server sẽ chuyển request sang stale và không ghi ledger.
                  </p>
                </div>
              )}

              {selected.requestedBy === user?.id && (
                <div className="rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
                  Bạn là người tạo đề nghị này nên không thể duyệt hoặc từ chối.
                </div>
              )}

              <dl className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[#789084]">Floor đề nghị</dt>
                  <dd className="mt-1 text-white">{selected.requesterName}</dd>
                </div>
                <div>
                  <dt className="text-[#789084]">Phương thức</dt>
                  <dd className="mt-1 text-white">{selected.method ?? "Chưa ghi"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[#789084]">Ghi chú Floor</dt>
                  <dd className="mt-1 text-white">{selected.notes ?? "Không có"}</dd>
                </div>
              </dl>

              <label className="block text-sm">
                <span className="mb-2 block text-[#b9c8c0]">Ghi chú duyệt (không bắt buộc)</span>
                <textarea
                  value={reviewNote}
                  maxLength={1000}
                  rows={3}
                  onChange={(event) => setReviewNote(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white"
                />
              </label>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="min-h-11" disabled={submitting} onClick={() => setSelected(null)}>
              Đóng
            </Button>
            {selected?.status === "pending" && selected.requestedBy !== user?.id && (
              <>
                <Button
                  variant="destructive"
                  className="min-h-11"
                  disabled={submitting}
                  onClick={() => void submitReview("reject")}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Từ chối
                </Button>
                <Button
                  className="min-h-11 bg-emerald-400 text-emerald-950 hover:bg-emerald-300"
                  disabled={submitting}
                  onClick={() => void submitReview("approve")}
                >
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  {selected.snapshotMatches ? "Duyệt & ghi ledger" : "Kiểm tra lại, không ghi"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: PayoutRequestStatus }) {
  const className = status === "pending"
    ? "bg-amber-300/10 text-amber-200"
    : status === "approved"
      ? "bg-emerald-300/10 text-emerald-200"
      : status === "stale"
        ? "bg-rose-300/10 text-rose-200"
        : "bg-white/8 text-[#b9c8c0]";
  return (
    <span className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs ${className}`}>
      {status === "pending" && <Clock3 className="h-3.5 w-3.5" />}
      {statusLabel[status]}
    </span>
  );
}

function SnapshotCard({
  title,
  recipient,
  amount,
  changed = false,
}: {
  title: string;
  recipient: string | null;
  amount: number | null;
  changed?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${changed ? "border-rose-300/30 bg-rose-300/5" : "border-white/10 bg-white/[0.025]"}`}>
      <p className="text-xs uppercase tracking-[0.12em] text-[#789084]">{title}</p>
      <p className="mt-3 font-semibold text-white">{recipient ?? "Không còn dữ liệu"}</p>
      <p className="mt-1 font-mono text-emerald-200">{money(amount)}</p>
    </div>
  );
}
