import { useEffect, useState } from "react";
import { AlertTriangle, PhoneCall } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type AlertKind = "call_floor" | "display_issue" | "wrong_action";
type PendingAlert = {
  requestId: string;
  tournamentId: string;
  tournamentTableId: string;
  handId: string | null;
  sourceRevision: number | null;
  kind: AlertKind;
  message: string;
};

const storageKey = (tournamentId: string, tournamentTableId: string) =>
  `dealer-floor-alert:${tournamentId}:${tournamentTableId}`;

function loadPending(key: string): PendingAlert | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingAlert>;
    const sourceRevision = value.sourceRevision ?? null;
    return typeof value.requestId === "string" && typeof value.tournamentId === "string"
      && typeof value.tournamentTableId === "string"
      && (value.kind === "call_floor" || value.kind === "display_issue" || value.kind === "wrong_action")
      && typeof value.message === "string" && (value.handId === null || typeof value.handId === "string")
      && (sourceRevision === null || Number.isSafeInteger(sourceRevision))
      ? { ...value, sourceRevision } as PendingAlert : null;
  } catch { return null; }
}

function persistPending(key: string, value: PendingAlert | null): boolean {
  try {
    if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
    else window.sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}

type Props = {
  tournamentId: string;
  tournamentTableId: string;
  handId: string | null;
  enabled: boolean;
};

export function DealerFloorAlertControls({ tournamentId, tournamentTableId, handId, enabled }: Props) {
  const key = storageKey(tournamentId, tournamentTableId);
  const [pending, setPending] = useState<PendingAlert | null>(() => loadPending(key));
  const [status, setStatus] = useState<"idle" | "sending" | "unknown" | "sent" | "rejected">(
    pending ? "unknown" : "idle",
  );
  const [detail, setDetail] = useState("");
  const [sourceRevision, setSourceRevision] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setSourceRevision(null);
    if (!enabled || !handId) return () => { active = false; };
    const load = async () => {
      const handResult = await supabase.from("tournament_hands")
        .select("id,source_revision")
        .eq("id", handId).eq("tournament_id", tournamentId)
        .eq("tournament_table_id", tournamentTableId).maybeSingle();
      if (!active || handResult.error || !handResult.data
        || !Number.isSafeInteger(handResult.data.source_revision)) return;
      setSourceRevision(handResult.data.source_revision);
    };
    void load();
    return () => { active = false; };
  }, [enabled, handId, tournamentId, tournamentTableId]);

  async function submit(kind: AlertKind) {
    if (!enabled || status === "sending") return;
    const request = pending ?? {
      requestId: crypto.randomUUID(), tournamentId, tournamentTableId,
      handId, sourceRevision: kind === "wrong_action" ? sourceRevision : null,
      kind, message: "",
    };
    if (!pending && kind === "wrong_action" && (!handId || sourceRevision === null)) {
      setStatus("rejected");
      setDetail("Chưa xác minh được hand và phiên bản máy chủ; chưa gửi Floor.");
      return;
    }
    if (!pending) {
      if (!persistPending(key, request)) {
        setStatus("rejected");
        setDetail("Chưa gửi yêu cầu: không lưu được mã trong trình duyệt. Hãy gọi Floor trực tiếp.");
        return;
      }
      setPending(request);
    }
    setStatus("sending");
    setDetail("");
    try {
      const { data, error } = request.kind === "wrong_action"
        ? await supabase.rpc("report_tracker_wrong_hand_v1" as never, {
          p_tournament_id: request.tournamentId,
          p_tournament_table_id: request.tournamentTableId,
          p_hand_id: request.handId,
          p_expected_source_revision: request.sourceRevision,
          p_request_id: request.requestId,
        } as never)
        : await supabase.rpc("report_tracker_floor_operational_alert_v2" as never, {
          p_tournament_id: request.tournamentId,
          p_tournament_table_id: request.tournamentTableId,
          p_hand_id: request.handId,
          p_action_id: null,
          p_kind: request.kind,
          p_message: request.message,
          p_request_id: request.requestId,
          p_expected_action: null,
          p_source_revision: null,
        } as never);
      const receipt = data as { ok?: boolean; alert_id?: string; request_id?: string; error?: string } | null;
      if (error) throw error;
      if (receipt?.ok && typeof receipt.alert_id === "string" && receipt.request_id === request.requestId) {
        setPending(null);
        persistPending(key, null);
        setStatus("sent");
        setDetail(`Mã cảnh báo: ${receipt.alert_id}`);
      } else {
        if (pending && ["stale_tracker_context", "tracker_lock_not_owned", "actor_not_allowed"].includes(receipt?.error ?? "")) {
          setStatus("unknown");
          setDetail("Không còn quyền xác minh yêu cầu cũ. Liên hệ Floor bằng kênh khác và cung cấp mã yêu cầu; không gửi lại bằng mã mới.");
          return;
        }
        setPending(null);
        persistPending(key, null);
        setStatus("rejected");
        setDetail(receipt?.error ?? "Máy chủ từ chối yêu cầu.");
      }
    } catch {
      setStatus("unknown");
      setDetail("Chưa biết máy chủ đã nhận chưa. Kiểm tra lại bằng cùng mã yêu cầu; không gửi yêu cầu mới.");
    }
  }

  return <section className="dealer-floor-controls" aria-label="Liên hệ Floor">
    <div className="dealer-floor-heading">
      <strong>Floor hỗ trợ</strong>
      <span>Độc lập Voice · không đổi action</span>
    </div>
    <div className="dealer-floor-actions">
      <button type="button" disabled={!enabled || Boolean(pending) || status === "sending"} onClick={() => void submit("call_floor")}>
        <PhoneCall size={16} /> Gọi Floor
      </button>
      <button type="button" disabled={!enabled || Boolean(pending) || status === "sending"} onClick={() => void submit("display_issue")}>
        <AlertTriangle size={16} /> Vấn đề hiển thị
      </button>
      <button type="button" disabled={!enabled || !handId || sourceRevision === null || Boolean(pending) || status === "sending"}
        onClick={() => void submit("wrong_action")}>
        <AlertTriangle size={16} /> Báo sai hand
      </button>
    </div>
    {pending && status !== "sending" && <button type="button" className="dealer-floor-retry" disabled={!enabled}
      onClick={() => void submit(pending.kind)}>Kiểm tra lại yêu cầu đang chờ</button>}
    <p role="status" className={`dealer-floor-status dealer-floor-status-${status}`}>
      {!enabled ? "Cảnh báo Floor mới chưa được bật; dùng quy trình Floor hiện tại." :
        status === "sending" ? "Đang gửi cảnh báo…" :
        status === "unknown" ? detail || "Chưa xác nhận được kết quả; kiểm tra lại bằng cùng mã yêu cầu." :
        status === "sent" ? `Đã gửi Floor. ${detail}` :
        status === "rejected" ? `Chưa gửi được: ${detail}` :
        "Gọi Floor không dừng hand. Báo sai hand sẽ tạm dừng tiến hand sau khi máy chủ trả receipt."}
    </p>
    {pending && <small className="dealer-floor-request-id">Mã yêu cầu: {pending.requestId}</small>}
  </section>;
}
