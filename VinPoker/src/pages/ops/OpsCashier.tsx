import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronLeft, ClipboardList, Banknote, ArrowLeftRight, HandCoins, ShieldCheck,
  Monitor, IdCard, Loader2, LogIn, Users, AlertTriangle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";

/**
 * Cashier — thu ngân (mobileOpsV2) — bản NỐI DỮ LIỆU THẬT (reads Q1/Q3/Q4/Q5/Q6).
 * Đọc từ đúng nguồn desktop CashierDashboard dùng (tournament_registrations, RPC
 * sepay_cashier_settlement_worklist, staking_purchases/deals, membership_verification_requests,
 * tournaments). Ngữ cảnh CLB = useOperatorClubs().clubIds (= cashier_club_ids).
 *
 * ⚠️ Module tiền-vào: mọi NÚT hành động (thu tiền / khớp SePay / FUNDED / duyệt / bốc thăm) CHƯA nối —
 * bấm chỉ nhắc; sẽ gắn RPC/Edge thật (confirm_registration_and_assign_seat / manual_confirm_bank_transaction
 * / admin-confirm-funded / approve_verification …) ở bước sau, mỗi cái owner UAT. KHÔNG fallback mock.
 */
const PENDING = "Chức năng đang nối dữ liệu — chưa thao tác trên live.";
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

// ── loaders (reads-only, mirror desktop queries; id-then-name fetch = no FK-alias risk) ──
async function namesByIds(ids: string[]): Promise<Record<string, { name: string; phone: string | null }>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabase.from("profiles").select("user_id, display_name, phone").in("user_id", uniq);
  const m: Record<string, { name: string; phone: string | null }> = {};
  for (const p of (data ?? []) as any[]) m[p.user_id] = { name: p.display_name ?? "—", phone: p.phone ?? null };
  return m;
}

async function loadQueue(clubIds: string[]) {
  let q = supabase.from("tournament_registrations")
    .select("id, reference_code, status, total_pay, player_id, tournament_id, committed_at")
    .in("status", ["pending", "confirmed"]).order("committed_at", { ascending: true }).limit(100);
  if (clubIds.length) q = q.in("club_id", clubIds);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const names = await namesByIds(rows.map((r) => r.player_id));
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
async function loadTours(clubIds: string[]) {
  let q = supabase.from("tournaments").select("id, name, buy_in, rake_amount, service_fee_amount, start_time")
    .in("status", ACTIVE_TOUR_STATUSES).order("created_at", { ascending: false }).limit(50);
  if (clubIds.length) q = q.in("club_id", clubIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any[];
}
async function loadSepay(scope: "actionable" | "resolved") {
  const { data, error } = await (supabase.rpc as any)("sepay_cashier_settlement_worklist", { p_scope: scope, p_limit: 100 });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as any[];
}
async function loadStaking(clubIds: string[]) {
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
  const names = await namesByIds([...rows.map((r) => r.backer_id), ...Object.values(dealMap).map((d: any) => d.player_id)]);
  return rows.map((r) => ({
    id: r.id, amount: r.amount_vnd, pct: r.percent,
    backer: names[r.backer_id]?.name ?? "Nhà đầu tư",
    player: names[dealMap[r.deal_id]?.player_id]?.name ?? dealMap[r.deal_id]?.custom_event_name ?? "—",
  }));
}
async function loadVerify(clubIds: string[]) {
  let q = supabase.from("membership_verification_requests")
    .select("id, member_card_id, created_at, player_user_id")
    .eq("status", "pending").order("created_at", { ascending: true }).limit(100);
  if (clubIds.length) q = q.in("club_id", clubIds);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const names = await namesByIds(rows.map((r) => r.player_user_id));
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
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { loading: clubsLoading, user, clubs, cashierClubIds, error: clubsError } = useOperatorClubs();
  const [pill, setPill] = useState<Pill>("queue");
  const [sepayTab, setSepayTab] = useState<"todo" | "done">("todo");
  const [state, setState] = useState<{ loading: boolean; error: string | null; rows: any[] }>({ loading: true, error: null, rows: [] });
  const [reload, setReload] = useState(0);
  const clubKey = cashierClubIds.join(",");
  const pending = () => { toast(PENDING); };

  const canLoad = !clubsLoading && !clubsError && !!user && clubs !== null && (cashierClubIds.length > 0 || isAdmin);
  useEffect(() => {
    if (!canLoad) return;
    let alive = true;
    setState({ loading: true, error: null, rows: [] });
    (async () => {
      try {
        let rows: any[] = [];
        if (pill === "queue") rows = await loadQueue(cashierClubIds);
        else if (pill === "buyin") rows = await loadTours(cashierClubIds);
        else if (pill === "sepay") rows = await loadSepay(sepayTab === "todo" ? "actionable" : "resolved");
        else if (pill === "staking") rows = await loadStaking(cashierClubIds);
        else if (pill === "verify") rows = await loadVerify(cashierClubIds);
        if (alive) setState({ loading: false, error: null, rows });
      } catch (e) {
        if (alive) setState({ loading: false, error: e instanceof Error ? e.message : "Không tải được dữ liệu", rows: [] });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pill, sepayTab, clubKey, reload, canLoad]);

  // ---- guards ----
  if (clubsLoading) return <Guard nav={navigate} icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Kiểm tra đăng nhập." />;
  if (!user) return <Guard nav={navigate} icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập tài khoản thu ngân để xem quầy." />;
  if (clubs === null) return <Guard nav={navigate} icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Lấy câu lạc bộ." />;
  if (clubsError) return <Guard nav={navigate} icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không tải được phạm vi Cashier" sub="Không hiển thị dữ liệu thay thế. Hãy tải lại trang." />;
  if (cashierClubIds.length === 0 && !isAdmin) return <Guard nav={navigate} icon={<Users className="h-8 w-8 text-amber-300" />} title="Chưa được phân công CLB" sub="Liên hệ quản trị để được gán quyền thu ngân." />;

  const clubName = clubs?.filter((club) => cashierClubIds.includes(club.id)).map((club) => club.name).join(", ") || "Toàn quyền";

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Cashier</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">{clubName} · thu ngân</p>
      </header>

      <div className="rounded-xl bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300/90">Dữ liệu thật · nút hành động chưa nối</div>

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
                  <button key={r.id} onClick={pending} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
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
                  <button key={t.id} onClick={pending} className="ios-press-sm ios-row-inset flex w-full items-center justify-between px-4 py-3 text-left">
                    <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">{t.name}</span><span className="block text-[12px] text-[#9b8e97]">{hhmm(t.start_time)}</span></span>
                    <span className="font-mono text-[12px] text-[#9b8e97]">{vnd((t.buy_in ?? 0) + (t.rake_amount ?? 0) + (t.service_fee_amount ?? 0))}</span>
                  </button>
                ))}
              </div>
              <button onClick={pending} className="ios-press ios-primary w-full rounded-2xl py-3 text-[15px] font-bold">Buy-in / Re-entry (đang nối)</button>
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
                      <button onClick={pending} className="ios-press-sm ios-primary flex-1 rounded-xl py-2 text-[13px] font-bold">Xác nhận &amp; xếp ghế</button>
                      <button onClick={pending} className="ios-press-sm ios-fill rounded-xl px-4 py-2 text-[13px] text-[#9b8e97]">Bỏ qua</button>
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
                    <button onClick={pending} className="ios-press-sm rounded-full bg-[#c9a86a]/15 px-3 py-1 text-[12px] font-semibold text-[#d8bc85]">Xác nhận góp</button>
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
                        <button onClick={pending} className="ios-press-sm ios-primary flex-1 rounded-xl py-2 text-[13px] font-bold">Duyệt</button>
                        <button onClick={pending} className="ios-press-sm ios-fill rounded-xl px-4 py-2 text-[13px] text-rose-300">Từ chối</button>
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
function Guard({ nav, icon, title, sub }: { nav: (to: string) => void; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => nav("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Cashier</h1>
      </header>
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        {icon}<div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
        <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>
      </div>
    </div>
  );
}
