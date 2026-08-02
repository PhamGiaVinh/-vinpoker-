import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
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
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import {
  cancelFloorPayoutRequest,
  createFloorPayoutRequest,
  getFloorPayoutRequestablePlaces,
  payoutRequestErrorMessage,
  type FloorRequestablePlace,
} from "@/ops/payout/payoutRequestApi";

const money = (value: number) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);

type ComposerState = {
  place: FloorRequestablePlace;
  method: "cash" | "bank" | "app" | "other";
  notes: string;
};

export default function FloorPayoutRequestPanel({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const client = useSupabaseClient();
  const idempotencyKeys = useRef(new Map<number, string>());
  const [places, setPlaces] = useState<FloorRequestablePlace[]>([]);
  const [integrityErrors, setIntegrityErrors] = useState<{ finishedPlace: number; error: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [cancelTarget, setCancelTarget] = useState<FloorRequestablePlace | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getFloorPayoutRequestablePlaces(client, tournamentId)
      .then((result) => {
        if (!active) return;
        setPlaces(result.places);
        setIntegrityErrors(result.integrityErrors);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setPlaces([]);
        setIntegrityErrors([]);
        setError(payoutRequestErrorMessage(cause));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, revision, tournamentId]);

  const submitRequest = async () => {
    if (!composer || submitting) return;
    setSubmitting(true);
    const place = composer.place;
    let idempotencyKey = idempotencyKeys.current.get(place.finishedPlace);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      idempotencyKeys.current.set(place.finishedPlace, idempotencyKey);
    }
    try {
      await createFloorPayoutRequest(client, {
        tournamentId,
        finishedPlace: place.finishedPlace,
        method: composer.method,
        notes: composer.notes.trim() || null,
        idempotencyKey,
        expectedFingerprint: place.fingerprint,
      });
      idempotencyKeys.current.delete(place.finishedPlace);
      setComposer(null);
      toast.success("Đã gửi đề nghị chờ Owner/Cashier duyệt");
      refresh();
    } catch (cause) {
      toast.error(payoutRequestErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async () => {
    if (!cancelTarget?.pendingRequestId || submitting) return;
    setSubmitting(true);
    try {
      await cancelFloorPayoutRequest(client, cancelTarget.pendingRequestId);
      setCancelTarget(null);
      toast.success("Đã hủy đề nghị");
      refresh();
    } catch (cause) {
      toast.error(payoutRequestErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex min-h-36 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.025]"
      >
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-300" />
        <span className="text-sm text-[#91a49b]">Đang tải hạng có thể đề nghị…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-3xl border border-amber-300/20 bg-amber-300/5 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-amber-100">Chưa thể tạo đề nghị</p>
            <p className="mt-1 text-sm leading-6 text-amber-100/70">{error}</p>
          </div>
          <Button variant="outline" size="icon" className="min-h-11 min-w-11" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Tải lại</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="floor-payout-request-heading">
      <div className="rounded-3xl border border-sky-300/20 bg-sky-300/5 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
          <div>
            <h3 id="floor-payout-request-heading" className="font-semibold text-sky-100">
              Đề nghị ghi nhận trả thưởng
            </h3>
            <p className="mt-1 text-sm leading-6 text-sky-100/70">
              Floor chỉ gửi đề nghị sau khi tiền đã được trao bên ngoài. Hệ thống không chuyển tiền;
              một Owner/Cashier khác phải kiểm tra lại người nhận và số tiền trước khi ghi ledger.
            </p>
          </div>
        </div>
      </div>

      {integrityErrors.length > 0 && (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-100">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Có hạng chưa đủ dữ liệu
          </div>
          <ul className="mt-2 space-y-1 text-rose-100/70">
            {integrityErrors.map((item) => (
              <li key={`${item.finishedPlace}:${item.error}`}>
                Hạng {item.finishedPlace}: {item.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {places.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 p-8 text-center text-sm text-[#91a49b]">
          Chưa có hạng đã chốt và có giải thưởng để đề nghị.
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {places.map((place) => (
            <article
              key={place.finishedPlace}
              className="rounded-3xl border border-white/10 bg-white/[0.025] p-4"
            >
              <div className="flex items-start gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-300/10 font-mono font-bold text-amber-200">
                  #{place.finishedPlace}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{place.recipientName}</p>
                  <p className="mt-1 font-mono text-sm text-emerald-200">{money(place.prizeAmount)}</p>
                </div>
                {place.isPaid ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-300/10 px-2.5 py-1 text-xs text-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Đã ghi nhận
                  </span>
                ) : place.pendingRequestId ? (
                  <span className="flex items-center gap-1 rounded-full bg-amber-300/10 px-2.5 py-1 text-xs text-amber-200">
                    <Clock3 className="h-3.5 w-3.5" />
                    Chờ duyệt
                  </span>
                ) : null}
              </div>

              <div className="mt-4">
                {place.canRequest ? (
                  <Button
                    className="min-h-11 w-full bg-emerald-400 text-emerald-950 hover:bg-emerald-300"
                    onClick={() => setComposer({ place, method: "cash", notes: "" })}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Tạo đề nghị
                  </Button>
                ) : place.pendingRequestId && place.pendingRequestedByMe ? (
                  <Button
                    variant="outline"
                    className="min-h-11 w-full border-rose-300/20 text-rose-200"
                    onClick={() => setCancelTarget(place)}
                  >
                    <Ban className="mr-2 h-4 w-4" />
                    Hủy đề nghị của tôi
                  </Button>
                ) : place.pendingRequestId ? (
                  <p className="rounded-2xl bg-white/5 px-3 py-3 text-center text-sm text-[#91a49b]">
                    Một Floor khác đã gửi đề nghị cho hạng này.
                  </p>
                ) : (
                  <p className="rounded-2xl bg-white/5 px-3 py-3 text-center text-sm text-[#91a49b]">
                    Không còn thao tác cần làm.
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={composer != null} onOpenChange={(open) => !open && !submitting && setComposer(null)}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto border-white/10 bg-[#0a110e] text-white [&>button:last-child]:grid [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:place-items-center">
          <DialogHeader>
            <DialogTitle>Gửi đề nghị hạng #{composer?.place.finishedPlace}</DialogTitle>
            <DialogDescription className="text-[#91a49b]">
              Đây không phải lệnh chuyển tiền. Owner/Cashier sẽ đối chiếu snapshot server trước khi duyệt.
            </DialogDescription>
          </DialogHeader>
          {composer && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="font-semibold">{composer.place.recipientName}</p>
                <p className="mt-1 font-mono text-emerald-200">{money(composer.place.prizeAmount)}</p>
              </div>
              <label className="block text-sm">
                <span className="mb-2 block text-[#b9c8c0]">Phương thức đã trao bên ngoài</span>
                <select
                  value={composer.method}
                  onChange={(event) => setComposer({
                    ...composer,
                    method: event.target.value as ComposerState["method"],
                  })}
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-white"
                >
                  <option value="cash">Tiền mặt</option>
                  <option value="bank">Chuyển khoản</option>
                  <option value="app">Ứng dụng</option>
                  <option value="other">Khác</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-2 block text-[#b9c8c0]">Ghi chú đối chiếu (không bắt buộc)</span>
                <textarea
                  value={composer.notes}
                  maxLength={1000}
                  rows={3}
                  onChange={(event) => setComposer({ ...composer, notes: event.target.value })}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white"
                  placeholder="Ví dụ: đã trao trực tiếp tại quầy"
                />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" disabled={submitting} onClick={() => setComposer(null)}>
              Quay lại
            </Button>
            <Button className="min-h-11 bg-emerald-400 text-emerald-950" disabled={submitting} onClick={() => void submitRequest()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Gửi chờ duyệt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelTarget != null} onOpenChange={(open) => !open && !submitting && setCancelTarget(null)}>
        <DialogContent className="max-w-md border-white/10 bg-[#0a110e] text-white [&>button:last-child]:grid [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:place-items-center">
          <DialogHeader>
            <DialogTitle>Hủy đề nghị hạng #{cancelTarget?.finishedPlace}?</DialogTitle>
            <DialogDescription className="text-[#91a49b]">
              Chỉ đề nghị đang chờ sẽ bị hủy; ledger trả thưởng không thay đổi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" disabled={submitting} onClick={() => setCancelTarget(null)}>
              Giữ lại
            </Button>
            <Button variant="destructive" className="min-h-11" disabled={submitting} onClick={() => void cancelRequest()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Hủy đề nghị
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
