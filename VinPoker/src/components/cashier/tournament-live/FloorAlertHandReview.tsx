import { useEffect, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

type Review = {
  number: number;
  status: string;
  board: string[];
  pot: number | null;
  actions: { id: string; order: number; street: string | null; seat: number | null; type: string; amount: number | null }[];
};

export function FloorAlertHandReview({ tournamentId, handId, physicalTableId, tournamentTableId }: {
  tournamentId: string;
  handId: string;
  physicalTableId: string;
  tournamentTableId: string;
}) {
  const client = useSupabaseClient();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReview(null);
    setError(null);
    const load = async () => {
      const [handResult, actionResult, playerResult] = await Promise.all([
        client.from("tournament_hands")
          .select("hand_number,status,community_cards,pot_size,table_id")
          .eq("id", handId).eq("tournament_id", tournamentId).maybeSingle(),
        client.from("hand_actions")
          .select("id,action_order,street,player_id,entry_number,action_type,action_amount")
          .eq("hand_id", handId).order("action_order", { ascending: true }),
        client.from("hand_players")
          .select("player_id,entry_number,seat_number").eq("hand_id", handId),
      ]);
      if (!active) return;
      const hand = handResult.data;
      if (handResult.error || actionResult.error || playerResult.error || !hand ||
          ![physicalTableId, tournamentTableId].includes(hand.table_id)) {
        setError("Không tải được nhật ký ván hoặc bàn/giải không khớp. Chưa có thao tác sửa nào được thực hiện.");
        return;
      }
      const seats = new Map((playerResult.data ?? []).map((player) => [
        `${player.player_id}:${player.entry_number}`, player.seat_number,
      ]));
      setReview({
        number: hand.hand_number,
        status: hand.status,
        board: Array.isArray(hand.community_cards) ? hand.community_cards.filter((card): card is string => typeof card === "string") : [],
        pot: hand.pot_size,
        actions: (actionResult.data ?? []).map((action) => ({
          id: action.id,
          order: action.action_order,
          street: action.street,
          seat: seats.get(`${action.player_id}:${action.entry_number}`) ?? null,
          type: action.action_type,
          amount: action.action_amount,
        })),
      });
    };
    void load();
    return () => { active = false; };
  }, [client, tournamentId, handId, physicalTableId, tournamentTableId]);

  if (error) return <p role="alert" className="text-sm text-rose-300">{error}</p>;
  if (!review) return <p className="text-sm text-muted-foreground">Đang tải nhật ký ván...</p>;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">Hand #{review.number} · {review.status} · Pot {review.pot?.toLocaleString("vi-VN") ?? "chưa chốt"} · Board {review.board.join(" ") || "chưa có"}</p>
      <p className="text-xs text-amber-200">Đây là nhật ký chỉ xem. Cảnh báo chưa chỉ rõ action sai; không sửa theo suy đoán.</p>
      {review.actions.length === 0 ? <p>Chưa có action được ghi.</p> : (
        <ol className="space-y-1" aria-label="Action toàn ván">
          {review.actions.map((action) => (
            <li key={action.id} className="flex gap-3 rounded-lg border border-white/10 px-3 py-2">
              <span className="w-8 shrink-0 text-muted-foreground">#{action.order}</span>
              <span className="w-20 shrink-0 capitalize">{action.street ?? "-"}</span>
              <span>{action.seat == null ? "Ghế chưa rõ" : `Ghế ${action.seat}`} · {action.type}{action.amount != null ? ` ${action.amount.toLocaleString("vi-VN")}` : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
