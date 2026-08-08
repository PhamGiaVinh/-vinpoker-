/* eslint-disable @typescript-eslint/no-explicit-any -- legacy read-only query rows are outside the auth-boundary scope */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ClipboardList, Banknote, ArrowLeftRight, HandCoins, ShieldCheck,
  Monitor, IdCard, Loader2, LogIn, Users, AlertTriangle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import {
  confirmOfflineBuyIn,
  confirmRegistration,
  confirmSepay,
  confirmStaking,
  ignoreSepay,
  mutationError,
  reviewVerification,
} from "@/ops/opsMutations";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Cashier — thu ngân (mobileOpsV2) — bản NỐI DỮ LIỆU THẬT (reads Q1/Q3/Q4/Q5/Q6).
 * Đọc từ đúng nguồn desktop CashierDashboard dùng (tournament_registrations, RPC
 * sepay_cashier_settlement_worklist, staking_purchases/deals, membership_verification_requests,
 * tournaments). Ngữ cảnh CLB = useOperatorClubs().clubIds (= cashier_club_ids).
 *
 * Module tiền-vào chỉ gửi intent qua RPC/Edge đã kiểm quyền; UI không tự tính tiền, ghế hoặc quyền.
 */
const vnd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN") + "đ");
const hhmm = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";
const ACTIVE_TOUR_STATUSES = ["upcoming", "registering", "drawing", "active", "live", "break", "final_table"];

const PILLS = [
  { key: "queue", label: "Hàng chờ", icon: ClipboardList },
  { key: "buyin", label: "Buy-in", icon: Banknote },
  { key: "sepay", label: "SePay", icon: ArrowLeftRight },
  { key: "staking", label: "Staking", icon: HandCoins },
  { key: "verify", label: "Xác minh", icon: ShieldCheck },
] as const;
type Pill = (typeof PILLS)[number]["key"];
type CashierAction =
  | { kind: "registration"; row: any }
  | { kind: "buyin"; row: any }
  | { kind: "sepay"; row: any; mode: "confirm" | "ignore" }
  | { kind: "staking"; row: any }
  | { kind: "verify"; row: any; decision: "approve" | "reject" };

// ── loaders (reads-only, mirror desktop queries; id-then-name fetch = no FK-alias risk) ──
type OpsSupabaseClient = SupabaseClient<Database>;

async function namesByIds(supabase: OpsSupabaseClient, ids: string[]): Promise<Record<string, { name: string; phone: string | null }>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabase.from("profiles").select("user_id, display_name, phone").in("user_id", uniq);
  const m: Record<string, { name: string; phone: string | null }> = {};
  for (const p of (data ?? []) as any[]) m[p.user_id] = { name: p.display_name ?? "—", phone: p.phone ?? null };
  return m;
}

async function loadQueue(supabase: OpsSupabaseClient, clubIds: string[]) {
  let q = supabase.from("tournament_registrations")
    .select("id, reference_code, status, total_pay, player_id, tournament_id, committed_at")
    .in("status", ["pending", "confirmed"]).order("committed_at", { ascending: true }).limit(100);
  if (clubIds.length) q = q.in("club_id", clubIds);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const names = await namesByIds(supabase, rows.map((r) => r.player_id));
  const tourIds = [...new Set(rows.map((r) => r.tournament_id).filter(Boolean))];
  const tmap: Record<string, string> = {};
  if (tourIds.length) {
    const { data: ts } = await supabase.from("tournaments").select("id, name").in("id", tourIds);
    for (const t of (ts ?? []) as any[]) tmap[t.id] = t.name;
  }
  return rows.map((r) => ({
    id: r.id, ref: r.reference_code, status: r.status, total: r.total_pay,
    name: names[r.player_id]?.name ?? "—", phone: names[r.player_id]?.phone ?? "",
    tour: tmap[r.tournament_id] ?? "", at: r.committed_at,
  }));
}
async function loadTours(supabase: OpsSupabaseClient, clubIds: string[]) {
  let q = supabase.from("tournaments").select("id, name, buy_in, rake_amount, service_fee_amount, start_time")
    .in("status", ACTIVE_TOUR_STATUSES).order("created_at", { ascending: false }).limit(50);
  if (clubIds.length) q = q.in("club_id", clubIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any[];
}
async function loadSepay(supabase: OpsSupabaseClient, scope: "actionable" | "resolved") {
  const { data, error } = await (supabase.rpc as any)("sepay_cashier_settlement_worklist", { p_scope: scope, p_limit: 100 });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as any[];
}
async function loadStaking(supabase: OpsSupabaseClient, clubIds: string[]) {
  let dq = supabase.from("staking_deals").select("id, custom_event_name, player_id").limit(200);
  if (clubIds.length) dq = dq.in("club_id", clubIds);
  const { data: deals, error: de } = await dq;
  if (de) throw de;
  const dealMap: Record<string, any> = {};
  for (const d of (deals ?? []) as any[]) dealMap[d.id] = d;
  const dealIds = Object.keys(dealMap);
  if (!dealIds.length) return [];
  const { data: purchases, error: pe } = await supabase.from("staking_purchases")
    .select("id, deal_id, percent, amount_vnd, status, backer_id, committed_at")
    .in("deal_id", dealIds).eq("status", "committed").order("committed_at", { ascending: true }).limit(100);
  if (pe) throw pe;
  const rows = (purchases ?? []) as any[];
  const names = await namesByIds(supabase, [...rows.map((r) => r.backer_id), ...Object.values(dealMap).map((d: any) => d.player_id)]);
  return rows.map((r) => ({
    id: r.id, amount: r.amount_vnd, pct: r.percent,
    backer: names[r.backer_id]?.name ?? "Nhà đầu tư",
    player: names[dealMap[r.deal_id]?.player_id]?.name ?? dealMap[r.deal_id]?.custom_event_name ?? "—",
  }));
}
async function loadVerify(supabase: OpsSupabaseClient, clubIds: string[]) {
  let q = supabase.from("membership_verification_requests")
    .select("id, member_card_id, created_at, player_user_id")
    .eq("status", "pending").order("created_at", { ascending: true }).limit(100);
  if (clubIds.length) q = q.in("club_id", clubIds);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const names = await namesByIds(supabase, rows.map((r) => r.player_user_id));
  return rows.map((r) => ({
    id: r.id, card: r.member_card_id, at: r.created_at,
    name: names[r.player_user_id]?.name ?? "—", phone: names[r.player_user_id]?.phone ?? "",
  }));
}

const REG_CHIP: Record<string, { label: string; cls: string }> = {
  pending: { label: "Chờ xếp", cls: "bg-amber-400/12 text-amber-300" },
  confirmed: { label: "Đã thu", cls: "bg-sky-400/12 text-sky-300" },
};

export default function OpsCashier() {
  const supabase = useSupabaseClient();
  const { user } = useOpsAuth();
  const {
    loading: clubsLoading,
    clubs,
    cashierClubIds,
    scopeError,
    metadataError,
  } = useOpsCapabilities();
  const [pill, setPill] = useState<Pill>("queue");
  const [sepayTab, setSepayTab] = useState<"todo" | "done">("todo");
  const [state, setState] = useState<{ loading: boolean; error: string | null; rows: any[] }>({ loading: true, error: null, rows: [] });
  const [reload, setReload] = useState(0);
  const [selectedAction, setSelectedAction] = useState<CashierAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNote, setActionNote] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerPhone, setPlayerPhone] = useState("");
  const clubKey = cashierClubIds.join(",");

  const closeAction = (force = false) => {
    if (actionBusy && !force) return;
    setSelectedAction(null);
    setActionNote("");
    setPlayerName("");
    setPlayerPhone("");
  };

  const runAction = async () => {
    if (!selectedAction || !user) return;
    setActionBusy(true);
    try {
      if (selectedAction.kind === "registration") {
        await confirmRegistration(supabase, { registrationId: selectedAction.row.id, actorUserId: user.id });
        toast.success("Đã xác nhận đăng ký và xếp ghế.");
      } else if (selectedAction.kind === "buyin") {
        if (!playerName.trim()) throw new Error("Nhập tên người chơi trước khi tạo buy-in.");
        await confirmOfflineBuyIn(supabase, {
          tournamentId: selectedAction.row.id,
          playerName: playerName.trim(),
          phone: playerPhone,
          buyIn: Number(selectedAction.row.buy_in ?? 0),
          fee: Number(selectedAction.row.rake_amount ?? 0) + Number(selectedAction.row.service_fee_amount ?? 0),
        });
        toast.success("Đã tạo buy-in và xếp ghế.");
      } else if (selectedAction.kind === "sepay") {
        if (!actionNote.trim()) throw new Error("Nhập lý do để lưu dấu vết thao tác.");
        if (selectedAction.mode === "confirm") {
          if (!selectedAction.row.registration_id) throw new Error("Không có đúng một đăng ký để xác nhận.");
          await confirmSepay(supabase, {
            bankTransactionId: selectedAction.row.bank_transaction_id,
            registrationId: selectedAction.row.registration_id,
            reason: actionNote.trim(),
          });
          toast.success("Đã xác nhận SePay và xếp ghế.");
        } else {
          await ignoreSepay(supabase, { bankTransactionId: selectedAction.row.bank_transaction_id, reason: actionNote.trim() });
          toast.success("Đã bỏ qua giao dịch.");
        }
      } else if (selectedAction.kind === "staking") {
        await confirmStaking(supabase, { purchaseId: selectedAction.row.id, note: actionNote.trim() });
        toast.success("Đã xác nhận góp vốn.");
      } else {
        if (selectedAction.decision === "reject" && !actionNote.trim()) throw new Error("Nhập lý do từ chối.");
        await reviewVerification(supabase, {
          requestId: selectedAction.row.id,
          action: selectedAction.decision,
          rejectionReason: actionNote.trim() || undefined,
        });
        toast.success(selectedAction.decision === "approve" ? "Đã duyệt hồ sơ." : "Đã từ chối hồ sơ.");
      }
      closeAction(true);
      setReload((n) => n + 1);
    } catch (error) {
      toast.error(mutationError(error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const canLoad = !clubsLoading && !scopeError && !!user && cashierClubIds.length > 0;
  useEffect(() => {
    if (!canLoad) return;
    let alive = true;
    setState({ loading: true, error: null, rows: [] });
    (async () => {
      try {
        let rows: any[] = [];
        if (pill === "queue") rows = await loadQueue(supabase, cashierClubIds);
        else if (pill === "buyin") rows = await loadTours(supabase, cashierClubIds);
        else if (pill === "sepay") rows = await loadSepay(supabase, sepayTab === "todo" ? "actionable" : "resolved");
        else if (pill === "staking") rows = await loadStaking(supabase, cashierClubIds);
        else if (pill === "verify") rows = await loadVerify(supabase, cashierClubIds);
        if (alive) setState({ loading: false, error: null, rows });
      } catch (e) {
        if (alive) setState({ loading: false, error: e instanceof Error ? e.message : "Không tải được dữ liệu", rows: [] });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pill, sepayTab, clubKey, reload, canLoad]);

  // ---- guards ----
  if (clubsLoading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Kiểm tra đăng nhập." />;
  if (!user) return <Guard icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập tài khoản thu ngân để xem quầy." />;
  if (scopeError) return <Guard icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không tải được phạm vi Cashier" sub="Không hiển thị dữ liệu thay thế. Hãy tải lại trang." />;
  if (cashierClubIds.length === 0) return <Guard icon={<Users className="h-8 w-8 text-amber-300" />} title="Chưa được phân công CLB" sub="Liên hệ quản trị để được gán quyền thu ngân." />;

  const clubName = clubs.filter((club) => cashierClubIds.includes(club.id)).map((club) => club.name).join(", ") || "CLB được cấp quyền";

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Cashier</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">{clubName} · thu ngân</p>
      </header>

      {metadataError && <div className="rounded-xl bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300/90">{metadataError}</div>}
      <div className="rounded-xl bg-emerald-400/8 px-3 py-2 text-[12px] text-emerald-300/90">Dữ liệu thật · thao tác ghi chỉ đi qua RPC/Edge có kiểm quyền.</div>

      <div className="flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => setPill(p.key)}
            className={cn("ios-press-sm flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            <p.icon className="h-3.5 w-3.5" /> {p.label}
          </button>
        ))}
      </div>

      {pill === "sepay" && (
        <div className="flex gap-2 px-1">
          {(["todo", "done"] as const).map((t) => (
            <button key={t} onClick={() => setSepayTab(t)}
              className={cn("ios-press-sm rounded-full px-3 py-1 text-[12px]", sepayTab === t ? "bg-white/12 text-[#f2ece6]" : "bg-white/5 text-[#9b8e97]")}>{t === "todo" ? "Cần xử lý" : "Đã xử lý"}</button>
          ))}
        </div>
      )}

      {/* data zone: loading → error → empty → rows (never mock) */}
      {state.loading ? (
        <div className="ios-card flex flex-col items-center gap-2 py-12 text-center"><Loader2 className="h-7 w-7 animate-spin text-[#c9a86a]" /><div className="text-[13px] text-[#9b8e97]">Đang tải…</div></div>
      ) : state.error ? (
        <div className="ios-card flex flex-col items-center gap-2 py-10 text-center">
          <AlertTriangle className="h-7 w-7 text-rose-300" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Không tải được</div>
          <div className="max-w-[280px] text-[12px] text-[#9b8e97]">{state.error}</div>
          <button onClick={() => setReload((n) => n + 1)} className="ios-press-sm mt-1 flex items-center gap-1.5 rounded-full bg-white/8 px-3.5 py-1.5 text-[13px] text-[#f2ece6]"><RefreshCw className="h-3.5 w-3.5" /> Thử lại</button>
        </div>
      ) : (
        <>
          {/* Q1 — Hàng chờ */}
          {pill === "queue" && (state.rows.length === 0 ? <Empty text="Không có đăng ký chờ." /> : (
            <div className="ios-group">
              {state.rows.map((r) => {
                const chip = REG_CHIP[r.status] ?? REG_CHIP.pending;
                return (
                  <button key={r.id} disabled={r.status !== "pending"} onClick={() => { if (r.status === "pending") setSelectedAction({ kind: "registration", row: r }); }} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left disabled:cursor-default disabled:opacity-70">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] text-[#f2ece6]">{r.name} {r.phone && <span className="font-mono text-[12px] text-[#7c7079]">{maskPhone(r.phone)}</span>}</span>
                      <span className="block truncate text-[12px] text-[#9b8e97]">{r.tour}{r.total != null ? ` · ${vnd(r.total)}` : ""}{r.ref ? ` · ${r.ref}` : ""}</span>
                    </span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", chip.cls)}>{chip.label}</span>
                  </button>
                );
              })}
            </div>
          ))}

          {/* Q3 — Buy-in: chọn giải thật; form thu tiền = đang nối */}
          {pill === "buyin" && (state.rows.length === 0 ? <Empty text="Không có giải đang mở để buy-in." /> : (
            <div className="space-y-3">
              <div className="px-1 text-[12px] text-[#9b8e97]">Chọn giải</div>
              <div className="ios-group">
                {state.rows.map((t) => (
                  <button key={t.id} onClick={() => setSelectedAction({ kind: "buyin", row: t })} className="ios-press-sm ios-row-inset flex w-full items-center justify-between px-4 py-3 text-left">
                    <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">{t.name}</span><span className="block text-[12px] text-[#9b8e97]">{hhmm(t.start_time)}</span></span>
                    <span className="font-mono text-[12px] text-[#9b8e97]">{vnd((t.buy_in ?? 0) + (t.rake_amount ?? 0) + (t.service_fee_amount ?? 0))}</span>
                  </button>
                ))}
              </div>
              <div className="px-1 text-[12px] text-[#9b8e97]">Chạm vào một giải để nhập người chơi và ghi buy-in.</div>
            </div>
          ))}

          {/* Q4 — SePay */}
          {pill === "sepay" && (state.rows.length === 0 ? <Empty text={sepayTab === "todo" ? "Không có giao dịch cần xử lý." : "Chưa có giao dịch đã xử lý."} /> : (
            <div className="ios-group">
              {state.rows.map((r, i) => (
                <div key={r.bank_transaction_id ?? i} className="ios-row-inset px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[15px] font-semibold text-[#f2ece6]">{vnd(r.amount)}</span>
                      <span className="block truncate text-[12px] text-[#9b8e97]">"{r.content ?? r.txn_ref ?? "—"}" · {hhmm(r.occurred_at ?? r.created_at)}{r.player_display ? ` · ${r.player_display}` : " · chưa rõ người"}</span>
                    </span>
                    {sepayTab === "done" && <span className="rounded-full bg-emerald-400/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">đã xử lý</span>}
                  </div>
                  {sepayTab === "todo" && (
                    <div className="mt-2 flex gap-2">
                      <button disabled={!r.registration_id} onClick={() => setSelectedAction({ kind: "sepay", row: r, mode: "confirm" })} className="ios-press-sm ios-primary flex-1 rounded-xl py-2 text-[13px] font-bold disabled:opacity-50">Xác nhận &amp; xếp ghế</button>
                      <button onClick={() => setSelectedAction({ kind: "sepay", row: r, mode: "ignore" })} className="ios-press-sm ios-fill rounded-xl px-4 py-2 text-[13px] text-[#9b8e97]">Bỏ qua</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {/* Q5 — Staking */}
          {pill === "staking" && (state.rows.length === 0 ? <Empty text="Không có kèo chờ xác nhận góp." /> : (
            <div className="space-y-3">
              <div className="ios-group">
                {state.rows.map((s) => (
                  <div key={s.id} className="ios-row-inset flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] text-[#f2ece6]">{s.backer} → <b>{s.player}</b></span>
                      <span className="block font-mono text-[12px] text-[#9b8e97]">{vnd(s.amount)}{s.pct != null ? ` · ${s.pct}% kèo` : ""}</span>
                    </span>
                    <button onClick={() => setSelectedAction({ kind: "staking", row: s })} className="ios-press-sm rounded-full bg-[#c9a86a]/15 px-3 py-1 text-[12px] font-semibold text-[#d8bc85]">Xác nhận góp</button>
                  </div>
                ))}
              </div>
              <DesktopNote text="Chi tiết kèo, hoàn tiền, lịch sử và xuất Excel làm trên máy tính." />
            </div>
          ))}

          {/* Q6 — Xác minh */}
          {pill === "verify" && (
            <div className="space-y-3">
              {state.rows.length === 0 ? <Empty text="Không có hồ sơ chờ duyệt." /> : (
                <div className="ios-group">
                  {state.rows.map((v) => (
                    <div key={v.id} className="ios-row-inset px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] text-[#f2ece6]">{v.name} {v.phone && <span className="font-mono text-[12px] text-[#7c7079]">{maskPhone(v.phone)}</span>}</span>
                          <span className="block text-[12px] text-[#9b8e97]">thẻ {v.card ?? "—"} · {hhmm(v.at)}</span>
                        </span>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => setSelectedAction({ kind: "verify", row: v, decision: "approve" })} className="ios-press-sm ios-primary flex-1 rounded-xl py-2 text-[13px] font-bold">Duyệt</button>
                        <button onClick={() => setSelectedAction({ kind: "verify", row: v, decision: "reject" })} className="ios-press-sm ios-fill rounded-xl px-4 py-2 text-[13px] text-rose-300">Từ chối</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => toast("Cấp lại thẻ — bản đầy đủ trên máy tính (#725)")} className="ios-press-sm ios-card flex w-full items-center gap-3 p-3.5 text-left">
                <IdCard className="h-5 w-5 text-[#c9a86a]" />
                <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Cấp lại thẻ hội viên</span><span className="block text-[12px] text-[#9b8e97]">quét QR → in thẻ · bản đầy đủ trên máy tính</span></span>
                <Monitor className="h-4 w-4 text-[#5f545c]" />
              </button>
            </div>
          )}
        </>
      )}
      <Sheet open={selectedAction !== null} onOpenChange={(open) => { if (!open) closeAction(); }}>
        <SheetContent side="bottom" className="rounded-t-3xl border-white/10 bg-[#0a0d0b] text-[#f2ece6]">
          <SheetHeader>
            <SheetTitle className="text-left text-[#f2ece6]">
              {selectedAction?.kind === "registration" && "Xác nhận đăng ký"}
              {selectedAction?.kind === "buyin" && "Tạo buy-in / re-entry"}
              {selectedAction?.kind === "sepay" && (selectedAction.mode === "confirm" ? "Xác nhận SePay" : "Bỏ qua giao dịch")}
              {selectedAction?.kind === "staking" && "Xác nhận góp vốn"}
              {selectedAction?.kind === "verify" && (selectedAction.decision === "approve" ? "Duyệt hồ sơ" : "Từ chối hồ sơ")}
            </SheetTitle>
          </SheetHeader>
          {selectedAction && (
            <div className="space-y-3 pb-4 pt-3">
              <div className="rounded-2xl bg-white/5 px-4 py-3 text-[13px] text-[#b9adb5]">
                {selectedAction.kind === "registration" && <>Người chơi: <b className="text-[#f2ece6]">{selectedAction.row.name}</b><br />Giải: {selectedAction.row.tour}</>}
                {selectedAction.kind === "buyin" && <>Giải: <b className="text-[#f2ece6]">{selectedAction.row.name}</b><br />Tổng dự kiến: {vnd((selectedAction.row.buy_in ?? 0) + (selectedAction.row.rake_amount ?? 0) + (selectedAction.row.service_fee_amount ?? 0))}</>}
                {selectedAction.kind === "sepay" && <>Số tiền: <b className="text-[#f2ece6]">{vnd(selectedAction.row.amount)}</b><br />Nội dung: {selectedAction.row.content ?? selectedAction.row.txn_ref ?? "—"}</>}
                {selectedAction.kind === "staking" && <>{selectedAction.row.backer} → <b className="text-[#f2ece6]">{selectedAction.row.player}</b><br />Số tiền: {vnd(selectedAction.row.amount)}</>}
                {selectedAction.kind === "verify" && <>Người chơi: <b className="text-[#f2ece6]">{selectedAction.row.name}</b><br />Thẻ: {selectedAction.row.card ?? "—"}</>}
              </div>
              {selectedAction.kind === "buyin" && (
                <>
                  <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="Tên người chơi" className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[15px] outline-none focus:border-[#c9a86a]" />
                  <input value={playerPhone} onChange={(event) => setPlayerPhone(event.target.value)} placeholder="Số điện thoại (không bắt buộc)" className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[15px] outline-none focus:border-[#c9a86a]" />
                </>
              )}
              {(selectedAction.kind === "sepay" || selectedAction.kind === "staking" || (selectedAction.kind === "verify" && selectedAction.decision === "reject")) && (
                <textarea value={actionNote} onChange={(event) => setActionNote(event.target.value)} placeholder={selectedAction.kind === "verify" ? "Lý do từ chối" : "Ghi chú / lý do thao tác"} rows={3} className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[15px] outline-none focus:border-[#c9a86a]" />
              )}
              <div className="flex gap-2">
                <button disabled={actionBusy} onClick={closeAction} className="ios-press-sm ios-fill flex-1 rounded-xl py-3 text-[14px] text-[#b9adb5]">Hủy</button>
                <button disabled={actionBusy || (selectedAction.kind === "buyin" && !playerName.trim()) || (selectedAction.kind === "sepay" && !actionNote.trim()) || (selectedAction.kind === "verify" && selectedAction.decision === "reject" && !actionNote.trim())} onClick={runAction} className="ios-press-sm ios-primary flex-1 rounded-xl py-3 text-[14px] font-bold disabled:opacity-50">
                  {actionBusy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Xác nhận"}
                </button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <div className="pb-2" />
    </div>
  );
}

function maskPhone(p: string) { return p.length >= 6 ? p.slice(0, 2) + "••••" + p.slice(-3) : p; }

function Empty({ text }: { text: string }) {
  return <div className="ios-card py-10 text-center text-[14px] text-[#9b8e97]">{text}</div>;
}
function DesktopNote({ text }: { text: string }) {
  return <div className="ios-card flex items-start gap-2 p-3.5 text-[12px] text-[#9b8e97]"><Monitor className="mt-0.5 h-4 w-4 shrink-0 text-[#9b8e97]" /> <span>{text}</span></div>;
}
function Guard({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Cashier</h1>
      </header>
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        {icon}<div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
        <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>
      </div>
    </div>
  );
}
