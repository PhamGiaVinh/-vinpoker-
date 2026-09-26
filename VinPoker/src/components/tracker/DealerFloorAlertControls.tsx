import { useEffect, useState } from "react";
import { AlertTriangle, PhoneCall } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type AlertKind = "call_floor" | "display_issue";
type CanonicalAction = {
  id: string;
  hand_id: string;
  action_order: number;
  street: string;
  player_id: string;
  entry_number: number;
  action_type: string;
  action_amount: number | null;
};
type PendingAlert = {
  requestId: string;
  tournamentId: string;
  tournamentTableId: string;
  handId: string | null;
  action: CanonicalAction | null;
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
    const action = value.action ?? null;
    const sourceRevision = value.sourceRevision ?? null;
    return typeof value.requestId === "string" && typeof value.tournamentId === "string"
      && typeof value.tournamentTableId === "string" && (value.kind === "call_floor" || value.kind === "display_issue")
      && typeof value.message === "string" && (value.handId === null || typeof value.handId === "string")
      && (action === null || (typeof action === "object" && typeof action.id === "string"))
      && (sourceRevision === null || Number.isSafeInteger(sourceRevision))
      ? { ...value, action, sourceRevision } as PendingAlert : null;
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
  const [actions, setActions] = useState<CanonicalAction[]>([]);
  const [sourceRevision, setSourceRevision] = useState<number | null>(null);
  const [selectedAction, setSelectedAction] = useState<CanonicalAction | null>(null);
  const [seatByEntry, setSeatByEntry] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    setActions([]);
    setSourceRevision(null);
    setSelectedAction(null);
    setSeatByEntry({});
    if (!enabled || !handId) return () => { active = false; };
    const load = async () => {
      const actionResult = await supabase.from("hand_actions")
        .select("id,hand_id,action_order,street,player_id,entry_number,action_type,action_amount")
        .eq("hand_id", handId).order("action_order", { ascending: true });
      const playerResult = await supabase.from("hand_players")
        .select("player_id,entry_number,seat_number").eq("hand_id", handId);
      const handResult = await supabase.from("tournament_hands")
        .select("id,source_revision")
        .eq("id", handId).eq("tournament_id", tournamentId)
        .eq("tournament_table_id", tournamentTableId).maybeSingle();
      if (!active || actionResult.error || playerResult.error || handResult.error || !handResult.data
        || !Number.isSafeInteger(handResult.data.source_revision)) return;
      setActions((actionResult.data ?? []) as CanonicalAction[]);
      setSeatByEntry(Object.fromEntries((playerResult.data ?? []).map((player) => [`${player.player_id}:${player.entry_number}`, player.seat_number])));
      setSourceRevision(handResult.data.source_revision);
    };
    void load();
    return () => { active = false; };
  }, [enabled, handId, tournamentId, tournamentTableId]);

  async function submit(kind: AlertKind) {
    if (!enabled || status === "sending") return;
    const request = pending ?? {
      requestId: crypto.randomUUID(), tournamentId, tournamentTableId,
      handId, action: selectedAction, sourceRevision: selectedAction ? sourceRevision : null,
      kind, message: "",
    };
    if (!pending && selectedAction && sourceRevision === null) {
      setStatus("rejected");
      setDetail("Chưa xác minh được phiên bản action từ máy chủ; chưa gửi Floor.");
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
      const { data, error } = await supabase.rpc("report_tracker_floor_operational_alert_v2" as never, {
        p_tournament_id: request.tournamentId,
        p_tournament_table_id: request.tournamentTableId,
        p_hand_id: request.handId,
        p_action_id: request.action?.id ?? null,
        p_kind: request.kind,
        p_message: request.message,
        p_request_id: request.requestId,
        p_expected_action: request.action,
        p_source_revision: request.sourceRevision,
      } as never);
      const receipt = data as { ok?: boolean; alert_id?: string; request_id?: string; error?: string } | null;
      if (error) throw error;
      if (receipt?.ok && typeof receipt.alert_id === "string" && receipt.request_id === request.requestId) {
        setPending(null);
        persistPending(key, null);
        setStatus("sent");
        setDetail(`Mã cảnh báo: ${receipt.alert_id}`);
      } else {
        if (pending && ["stale_tracker_context", "dealer_assignment_not_unique", "dealer_assignment_changed"].includes(receipt?.error ?? "")) {
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
    {handId && <div className="dealer-floor-action-picker">
      <span>Action cần Floor xem: {selectedAction ? `#${selectedAction.action_order} · ${selectedAction.street} · ${selectedAction.action_type}` : "Chưa chỉ định action"}</span>
      {selectedAction && <button type="button" onClick={() => setSelectedAction(null)}>Bỏ chọn</button>}
      {actions.length > 0 && <details className="dealer-floor-action-chooser"><summary>Chọn action đã lưu</summary><div className="dealer-floor-action-list" aria-label="Chọn action đã lưu">
        {actions.map((action) => <button key={action.id} type="button" aria-pressed={selectedAction?.id === action.id}
          disabled={Boolean(pending) || status === "sending"} onClick={() => setSelectedAction(action)}>
          #{action.action_order} · {action.street} · Ghế {seatByEntry[`${action.player_id}:${action.entry_number}`] ?? "?"} · {action.action_type} {(action.action_amount ?? 0).toLocaleString("vi-VN")}
        </button>)}
      </div></details>}
    </div>}
    <div className="dealer-floor-actions">
      <button type="button" disabled={!enabled || Boolean(pending) || status === "sending"} onClick={() => void submit("call_floor")}>
        <PhoneCall size={16} /> Gọi Floor
      </button>
      <button type="button" disabled={!enabled || Boolean(pending) || status === "sending"} onClick={() => void submit("display_issue")}>
        <AlertTriangle size={16} /> Vấn đề hiển thị
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
        "Gọi Floor không dừng hand. Báo sai poker state sẽ có luồng sửa riêng."}
    </p>
    {pending && <small className="dealer-floor-request-id">Mã yêu cầu: {pending.requestId}</small>}
  </section>;
}
