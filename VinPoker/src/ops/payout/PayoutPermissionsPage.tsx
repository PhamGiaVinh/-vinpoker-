import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FEATURES } from "@/lib/featureFlags";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import {
  listFloorPayoutGrants,
  payoutRequestErrorMessage,
  setFloorPayoutGrant,
  type FloorPayoutGrant,
} from "@/ops/payout/payoutRequestApi";

export default function PayoutPermissionsPage() {
  const navigate = useNavigate();
  const client = useSupabaseClient();
  const { scope, clubs, hasOwnerAccess } = useOpsCapabilities();
  const ownerClubIds = useMemo(
    () => scope.filter((row) => row.can_owner).map((row) => row.club_id),
    [scope],
  );
  const [clubId, setClubId] = useState(ownerClubIds[0] ?? "");
  const [rows, setRows] = useState<FloorPayoutGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const availableClubs = ownerClubIds.map((id) => ({
    id,
    name: clubs.find((club) => club.id === id)?.name ?? `CLB ${id.slice(0, 8)}`,
  }));

  useEffect(() => {
    if (!clubId && ownerClubIds[0]) setClubId(ownerClubIds[0]);
  }, [clubId, ownerClubIds]);

  useEffect(() => {
    if (!clubId || !FEATURES.floorPayoutRequestFlow) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void listFloorPayoutGrants(client, clubId)
      .then((result) => {
        if (!active) return;
        setRows(result);
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
  }, [client, clubId, revision]);

  if (!FEATURES.floorPayoutRequestFlow || !hasOwnerAccess) {
    return <Navigate to="/ops/cashier" replace />;
  }

  const toggleGrant = async (row: FloorPayoutGrant) => {
    if (busyUserId) return;
    setBusyUserId(row.floorUserId);
    try {
      await setFloorPayoutGrant(client, {
        clubId,
        floorUserId: row.floorUserId,
        enabled: !row.enabled,
      });
      toast.success(row.enabled ? "Đã thu hồi quyền đề nghị" : "Đã cấp quyền đề nghị");
      refresh();
    } catch (cause) {
      toast.error(payoutRequestErrorMessage(cause));
    } finally {
      setBusyUserId(null);
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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">Owner only</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Quyền đề nghị trả thưởng</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#91a49b]">
            Membership Floor không tự cấp quyền. Owner phải bật riêng từng người; thu hồi quyền không xóa lịch sử.
          </p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={refresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Làm mới
        </Button>
      </header>

      <label className="block rounded-3xl border border-white/10 bg-white/[0.025] p-4 text-sm text-[#b9c8c0]">
        <span className="mb-2 block">CLB do bạn sở hữu</span>
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

      <div className="flex items-start gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="leading-6">
          Quyền này chỉ cho phép Floor tạo đề nghị. Floor vẫn không thể tự duyệt, ghi ledger trực tiếp hoặc gọi dịch vụ thanh toán.
        </p>
      </div>

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex min-h-40 items-center justify-center rounded-3xl border border-white/10"
        >
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-amber-300" />
          <span className="text-sm text-[#91a49b]">Đang tải danh sách Floor…</span>
        </div>
      ) : error ? (
        <div role="alert" className="flex items-start gap-3 rounded-3xl border border-rose-300/20 bg-rose-300/5 p-5 text-rose-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm leading-6">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center text-sm text-[#91a49b]">
          CLB chưa có membership Floor để cấp quyền.
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-white/10">
          {rows.map((row) => (
            <div
              key={row.floorUserId}
              className="flex min-h-20 items-center gap-3 border-b border-white/8 bg-white/[0.025] px-4 py-3 last:border-0"
            >
              <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${row.enabled ? "bg-emerald-300/10 text-emerald-200" : "bg-white/5 text-[#789084]"}`}>
                {row.enabled ? <ShieldCheck className="h-5 w-5" /> : <ShieldOff className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{row.displayName}</p>
                <p className="mt-1 text-xs text-[#789084]">
                  {row.enabled ? "Được tạo đề nghị · vẫn cần người khác duyệt" : "Chưa được tạo đề nghị"}
                </p>
              </div>
              <Button
                variant={row.enabled ? "destructive" : "default"}
                className={`min-h-11 min-w-24 ${row.enabled ? "" : "bg-emerald-400 text-emerald-950 hover:bg-emerald-300"}`}
                disabled={busyUserId != null}
                onClick={() => void toggleGrant(row)}
              >
                {busyUserId === row.floorUserId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {row.enabled ? "Thu hồi" : "Cấp quyền"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
