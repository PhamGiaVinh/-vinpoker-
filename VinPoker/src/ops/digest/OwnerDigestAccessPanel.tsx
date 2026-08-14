import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  OwnerDailyDigestManager,
  OwnerDailyDigestV2Source,
} from "@/ops/digest/ownerDailyDigestV2Source";

export function OwnerDigestAccessPanel({
  clubId,
  source,
}: {
  clubId: string;
  source: OwnerDailyDigestV2Source;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [managers, setManagers] = useState<OwnerDailyDigestManager[]>([]);
  const [candidates, setCandidates] = useState<OwnerDailyDigestManager[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextManagers, nextCandidates] = await Promise.all([
        source.listManagers(clubId),
        source.listCandidates(clubId),
      ]);
      setManagers(nextManagers);
      setCandidates(nextCandidates);
    } catch {
      setError("Không tải được danh sách quyền xem. Không có thay đổi nào được thực hiện.");
    } finally {
      setLoading(false);
    }
  }, [clubId, source]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  async function changeAccess(action: "grant" | "revoke", user: OwnerDailyDigestManager) {
    setBusyUserId(user.userId);
    setError(null);
    try {
      if (action === "grant") await source.grantManager(clubId, user.userId);
      else await source.revokeManager(clubId, user.userId);
      await reload();
    } catch {
      setError("Yêu cầu bị từ chối hoặc chưa thể lưu. Quyền hiện tại vẫn được giữ nguyên.");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-[#d7e3dc] transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <Users className="h-4 w-4" aria-hidden="true" /> Quản lý quyền xem
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[86vh] overflow-y-auto border-white/10 bg-[#07100c] text-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="h-5 w-5 text-emerald-300" aria-hidden="true" /> Quyền xem Báo cáo ngày
          </DialogTitle>
          <DialogDescription className="leading-6 text-[#91a49b]">
            Chỉ gán quyền đọc tổng hợp cho tài khoản đã được Super Admin chuẩn bị sẵn cho CLB này. Không thay đổi role và không cho phép sửa tiền.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-2xl border border-rose-300/20 bg-rose-300/8 px-4 py-3 text-sm text-rose-100">
            {error}
          </p>
        )}

        {loading ? (
          <div className="grid min-h-48 place-items-center" aria-label="Đang tải quyền xem">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-300" aria-hidden="true" />
          </div>
        ) : (
          <div className="space-y-5">
            <AccessList
              title="Đang có quyền xem"
              empty="Chưa có Quản lý CLB nào được gán."
              users={managers}
              busyUserId={busyUserId}
              action="revoke"
              onChange={changeAccess}
            />
            <AccessList
              title="Có thể gán"
              empty="Chưa có ứng viên. Super Admin cần chuẩn bị một tài khoản club_admin cho đúng CLB trước."
              users={candidates}
              busyUserId={busyUserId}
              action="grant"
              onChange={changeAccess}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccessList({
  title,
  empty,
  users,
  busyUserId,
  action,
  onChange,
}: {
  title: string;
  empty: string;
  users: OwnerDailyDigestManager[];
  busyUserId: string | null;
  action: "grant" | "revoke";
  onChange: (action: "grant" | "revoke", user: OwnerDailyDigestManager) => void;
}) {
  return (
    <section aria-labelledby={`digest-access-${action}`}>
      <h3 id={`digest-access-${action}`} className="text-sm font-semibold text-[#d7e3dc]">{title}</h3>
      {users.length === 0 ? (
        <p className="mt-2 rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm leading-6 text-[#7f9388]">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-white/7 rounded-2xl border border-white/8 bg-white/[0.025]">
          {users.map((user) => (
            <li key={user.userId} className="flex items-center gap-3 px-3 py-3 sm:px-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-300/10 text-sm font-bold text-emerald-200">
                {initials(user.displayName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{user.displayName}</span>
                <span className="block text-xs text-[#7f9388]">Mã {user.shortIdentifier}</span>
              </span>
              <button
                type="button"
                disabled={busyUserId !== null}
                onClick={() => onChange(action, user)}
                className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50 ${
                  action === "grant"
                    ? "border-emerald-300/20 bg-emerald-300/8 text-emerald-200"
                    : "border-rose-300/20 bg-rose-300/8 text-rose-100"
                }`}
              >
                {busyUserId === user.userId
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : action === "grant"
                    ? <UserPlus className="h-4 w-4" aria-hidden="true" />
                    : <UserMinus className="h-4 w-4" aria-hidden="true" />}
                {action === "grant" ? "Gán quyền" : "Thu hồi"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function initials(value: string): string {
  return value.split(/\s+/u).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "QL";
}
