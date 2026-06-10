import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { LogOut, User as UserIcon, Loader2, Shield, Building2, Users, Trophy, Download, BarChart3, RefreshCw, Activity, Database } from "lucide-react";
import { checkForUpdateNow } from "@/lib/registerSW";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import * as XLSX from "xlsx";
import { BackingProfileCard } from "@/components/BackingProfileCard";
import { AvatarUploader } from "@/components/AvatarUploader";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PlayerCheckInQR } from "@/components/PlayerCheckInQR";
import { NotificationPreferences } from "@/components/NotificationPreferences";
import { EnableNotificationsCard } from "@/components/EnableNotificationsCard";
import { PushDiagnostics } from "@/components/PushDiagnostics";
import { ClubVerificationCard } from "@/components/ClubVerificationCard";

const Account = () => {
  const { t, i18n } = useTranslation();
  const { user, loading, signOut, roles } = useAuth();
  const nav = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [regs, setRegs] = useState<any[]>([]);
  const [unreadChats, setUnreadChats] = useState(0);
  const [scope, setScope] = useState<"personal" | "club">("personal");
  const [bankLocked, setBankLocked] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const handleCheckUpdate = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const result = await checkForUpdateNow();
      if (result === true) {
        toast.success(t("account.updateFound"));
        // applyUpdate() inside checkForUpdateNow will reload shortly
      } else if (result === false) {
        toast.success(t("account.upToDate"));
      } else {
        toast.error(t("account.checkFailed"));
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  const isClubScope = roles.includes("club_admin") || roles.includes("super_admin");
  const dateLocale = i18n.language?.startsWith("en") ? "en-US" : "vi-VN";

  useEffect(() => {
    if (!user) return;
    if (isClubScope) setScope("club");
    (async () => {
      const { data: p } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
      setProfile(p);
      // Lock bank fields while backer has a LIVE purchase on a deal that is
      // not yet completed/cancelled. Once all deals settle, fields unlock.
      const { data: pur } = await supabase
        .from("staking_purchases")
        .select("id, status, deal:staking_deals!inner(status)")
        .eq("backer_id", user.id)
        .in("status", ["committed", "funded"]);
      const stillLive = (pur ?? []).some((p: any) => {
        const ds = p.deal?.status;
        return ds && ds !== "completed" && ds !== "cancelled";
      });
      setBankLocked(stillLive);
    })();
  }, [user?.id, isClubScope]);

  // Load registrations theo scope
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const loadRegs = async () => {
      if (scope === "personal") {
        const { data } = await supabase
          .from("stack_registrations")
          .select("id,status,created_at,tournament_id, tournament:tournaments(name, club:clubs(name))")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (!cancelled) setRegs(data ?? []);
      } else {
        let clubIds: string[] = [];
        if (roles.includes("super_admin")) {
          const { data: cs } = await supabase.from("clubs").select("id");
          clubIds = (cs ?? []).map((c: any) => c.id);
        } else {
          const { data: cs } = await supabase.from("clubs").select("id").eq("owner_id", user.id);
          clubIds = (cs ?? []).map((c: any) => c.id);
        }
        if (clubIds.length === 0) { if (!cancelled) setRegs([]); return; }
        const { data: tours } = await supabase.from("tournaments").select("id,name,club_id,start_time,buy_in, club:clubs(name)").in("club_id", clubIds);
        const tIds = (tours ?? []).map((t: any) => t.id);
        if (tIds.length === 0) { if (!cancelled) setRegs([]); return; }
        const { data, error } = await supabase
          .from("stack_registrations")
          .select("id,status,created_at,tournament_id,user_id")
          .in("tournament_id", tIds)
          .order("created_at", { ascending: false });
        if (error) { console.error("loadRegs error", error); if (!cancelled) setRegs([]); return; }
        let withTour = (data ?? []).map((r: any) => {
          const t = (tours ?? []).find((x: any) => x.id === r.tournament_id);
          return { ...r, tournament: t };
        });
        const uids = [...new Set(withTour.map((r: any) => r.user_id))];
        if (uids.length) {
          const { data: profs } = await supabase.from("profiles").select("user_id,display_name,phone").in("user_id", uids);
          const map = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
          withTour = withTour.map((r: any) => {
            const p: any = map.get(r.user_id);
            return { ...r, player: { display_name: p?.display_name ?? "—", phone: p?.phone ?? null } };
          });
        }
        if (!cancelled) setRegs(withTour);
      }
    };
    loadRegs();
    const channel = supabase.channel("acct-regs")
      .on("postgres_changes", { event: "*", schema: "public", table: "stack_registrations" }, () => loadRegs())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user?.id, scope, roles.join(",")]);

  useEffect(() => {
    if (!user || scope !== "club") { setUnreadChats(0); return; }
    let cancelled = false;
    const load = async () => {
      let clubIds: string[] = [];
      if (roles.includes("super_admin")) {
        const { data } = await supabase.from("clubs").select("id");
        clubIds = (data ?? []).map((c: any) => c.id);
      } else {
        const { data } = await supabase.from("clubs").select("id").eq("owner_id", user.id);
        clubIds = (data ?? []).map((c: any) => c.id);
      }
      if (clubIds.length === 0) { if (!cancelled) setUnreadChats(0); return; }
      const { data: chats } = await supabase
        .from("booking_chats")
        .select("id,player_id,club_last_read_at")
        .in("club_id", clubIds)
        .is("archived_at", null);
      if (!chats || chats.length === 0) { if (!cancelled) setUnreadChats(0); return; }
      let count = 0;
      for (const c of chats) {
        const { count: n } = await supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("chat_id", c.id)
          .eq("sender_id", c.player_id)
          .gt("created_at", c.club_last_read_at);
        if ((n ?? 0) > 0) count++;
      }
      if (!cancelled) setUnreadChats(count);
    };
    load();
    const channel = supabase.channel("acct-unread")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, () => load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "booking_chats" }, () => load())
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user?.id, scope, roles.join(",")]);

  const confirmedRegs = useMemo(() => regs.filter(r => r.status === "confirmed"), [regs]);

  const stats = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = confirmedRegs.filter(r => new Date(r.created_at) >= startOfDay).length;
    const week = confirmedRegs.filter(r => new Date(r.created_at) >= startOfWeek).length;
    const month = confirmedRegs.filter(r => new Date(r.created_at) >= startOfMonth).length;
    return { total: confirmedRegs.length, today, week, month, pending: unreadChats };
  }, [confirmedRegs, unreadChats]);

  const dailyChart = useMemo(() => {
    const days: { day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      const count = confirmedRegs.filter(r => { const t = new Date(r.created_at); return t >= d && t < next; }).length;
      days.push({ day: d.toLocaleDateString(dateLocale, { weekday: "short", day: "2-digit" }), count });
    }
    return days;
  }, [confirmedRegs, dateLocale]);

  const weeklyChart = useMemo(() => {
    const weeks: { week: string; count: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const end = new Date(); end.setHours(23, 59, 59, 999); end.setDate(end.getDate() - i * 7);
      const start = new Date(end); start.setDate(end.getDate() - 6); start.setHours(0, 0, 0, 0);
      const count = confirmedRegs.filter(r => { const t = new Date(r.created_at); return t >= start && t <= end; }).length;
      weeks.push({ week: `${start.getDate()}/${start.getMonth() + 1}`, count });
    }
    return weeks;
  }, [confirmedRegs]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) {
    return (
      <Card className="p-6 text-center gradient-card border-gold shadow-card">
        <UserIcon className="w-10 h-10 mx-auto text-gold mb-2" />
        <h2 className="font-display text-lg">{t("account.notSignedIn")}</h2>
        <Button onClick={() => nav("/auth")} className="mt-4 gradient-gold text-primary-foreground border-0">{t("account.signIn")}</Button>
      </Card>
    );
  }

  const save = async () => {
    const acc = (profile.bank_account_number ?? "").trim();
    if (!bankLocked && acc && !/^[0-9]{6,20}$/.test(acc)) {
      toast.error(t("account.bankAccountInvalid"));
      return;
    }
    setSaving(true);
    const patch: any = {
      display_name: profile.display_name,
      phone: profile.phone,
    };
    if (!bankLocked) {
      patch.bank_name = (profile.bank_name ?? "").trim() || null;
      patch.bank_account_number = acc || null;
      patch.bank_account_holder = (profile.bank_account_holder ?? "").trim() || null;
    }
    const { error } = await supabase.from("profiles").update(patch).eq("user_id", user.id);
    setSaving(false);
    if (error) toast.error(error.message); else toast.success(t("account.saved"));
  };

  const exportExcel = () => {
    if (regs.length === 0) { toast.error(t("account.noData")); return; }
    const isEn = i18n.language?.startsWith("en");

    const fmtTime = (iso: string) =>
      new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
    const fmtDateTime = (iso: string) =>
      new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
    const fmtMoney = (n: number | null | undefined) => {
      if (!n && n !== 0) return "";
      return new Intl.NumberFormat("vi-VN").format(n) + "đ";
    };
    const maskPhone = (p: string | null | undefined) => {
      if (!p) return "";
      const d = String(p).replace(/\s+/g, "");
      if (d.length <= 6) return d;
      return d.slice(0, 3) + "***" + d.slice(-3);
    };
    const statusLabel = (s: string) => {
      if (isEn) return s;
      switch (s) {
        case "confirmed": return "Đã xác nhận";
        case "pending": return "Chờ xác nhận";
        case "cancelled": return "Đã huỷ";
        default: return s;
      }
    };

    // Group by tournament, sort by tournament start_time then created_at
    const groups = new Map<string, any[]>();
    for (const r of regs) {
      const tid = r.tournament_id ?? "_none";
      if (!groups.has(tid)) groups.set(tid, []);
      groups.get(tid)!.push(r);
    }
    const groupArr = Array.from(groups.entries()).map(([tid, items]) => {
      items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return { tid, items, tournament: items[0]?.tournament };
    });
    groupArr.sort((a, b) => {
      const at = a.tournament?.start_time ? new Date(a.tournament.start_time).getTime() : 0;
      const bt = b.tournament?.start_time ? new Date(b.tournament.start_time).getTime() : 0;
      return at - bt;
    });

    const aoa: any[][] = [];
    const headers = isEn
      ? ["#", "Buy-in time", "Player name", "Phone", "Status"]
      : ["STT", "Giờ Buy-in", "Tên người chơi", "Số điện thoại", "Trạng thái"];

    for (const g of groupArr) {
      const t = g.tournament;
      const titleParts = [
        t?.name ?? "—",
        t?.buy_in ? `Buy-in: ${fmtMoney(t.buy_in)}` : null,
        t?.club?.name ? `CLB: ${t.club.name}` : null,
        t?.start_time ? `${isEn ? "Start" : "Bắt đầu"}: ${fmtDateTime(t.start_time)}` : null,
      ].filter(Boolean);
      aoa.push([(isEn ? "[Tournament] " : "[Giải đấu] ") + titleParts.join(" — ")]);
      aoa.push(headers);
      g.items.forEach((r: any, idx: number) => {
        aoa.push([
          idx + 1,
          fmtTime(r.created_at),
          r.player?.display_name ?? "—",
          maskPhone(r.player?.phone),
          statusLabel(r.status),
        ]);
      });
      aoa.push([`${isEn ? "Total" : "Tổng"}: ${g.items.length}`]);
      aoa.push([]);
    }

    const detailWs = XLSX.utils.aoa_to_sheet(aoa);
    detailWs["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 16 }];

    const summary = isEn ? [
      { Item: "Total bookings", Value: stats.total },
      { Item: "Today", Value: stats.today },
      { Item: "This week", Value: stats.week },
      { Item: "This month", Value: stats.month },
      { Item: "Unread chats", Value: stats.pending },
    ] : [
      { Mục: "Tổng booking", "Giá trị": stats.total },
      { Mục: "Hôm nay", "Giá trị": stats.today },
      { Mục: "Tuần này", "Giá trị": stats.week },
      { Mục: "Tháng này", "Giá trị": stats.month },
      { Mục: "Chat chưa đọc", "Giá trị": stats.pending },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, detailWs, isEn ? "Reconciliation" : "Chi tiết đối soát");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), isEn ? "Overview" : "Tổng quan");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyChart), isEn ? "7 days" : "7 ngày");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weeklyChart), isEn ? "4 weeks" : "4 tuần");
    XLSX.writeFile(wb, `stack-bookings-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-card/60 to-card/40 border-gold/40 p-6 backdrop-blur-sm">
        <div className="flex items-start gap-4">
          <AvatarUploader
            avatarUrl={profile?.avatar_url}
            displayName={profile?.display_name || user.email}
            onUploaded={(url) => setProfile((p: any) => ({ ...p, avatar_url: url }))}
          />
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-xl truncate">{profile?.display_name || "Player"}</h1>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {roles.map(r => <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-gold border border-gold/30">{r}</span>)}
            </div>
          </div>
          <LanguageSwitcher />
        </div>

        <div className="mt-4">
          <PlayerCheckInQR userId={user.id} displayName={profile?.display_name} />
        </div>

        {isClubScope && (
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setScope("club")}
              className={`flex-1 text-xs px-3 py-1.5 rounded border ${scope === "club" ? "bg-gold/20 border-gold text-gold" : "border-border text-muted-foreground"}`}
            >{t("account.clubScope")}</button>
            <button
              onClick={() => setScope("personal")}
              className={`flex-1 text-xs px-3 py-1.5 rounded border ${scope === "personal" ? "bg-gold/20 border-gold text-gold" : "border-border text-muted-foreground"}`}
            >{t("account.personalScope")}</button>
          </div>
        )}

        {isClubScope && (
          <div className="grid grid-cols-3 gap-2 mt-4">
            <Stat label={t("account.today")} value={stats.today} accent="text-gold" />
            <Stat label={t("account.thisWeek")} value={stats.week} accent="text-primary" />
            <Stat label={t("account.thisMonth")} value={stats.month} accent="text-secondary" />
            <Stat label={t("account.total")} value={stats.total} accent="text-gold" />
            <Stat label={t("account.unreadChats")} value={stats.pending} accent="text-warning" />
            <button onClick={exportExcel} className="rounded-lg bg-muted/40 hover:bg-muted/60 p-3 text-center flex flex-col items-center justify-center gap-1 transition">
              <Download className="w-4 h-4 text-gold" />
              <span className="text-[10px] text-muted-foreground uppercase">{t("account.exportExcel")}</span>
            </button>
          </div>
        )}
      </Card>

      {isClubScope && (
        <>
          <Card className="p-5 space-y-4 border-border/40 bg-gradient-to-br from-card/60 to-card/40 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-gold" />
              <h3 className="font-semibold text-gold text-base">{t("account.bookings7d")}</h3>
            </div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-5 space-y-4 border-border/40 bg-gradient-to-br from-card/60 to-card/40 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-primary" />
              <h3 className="font-semibold text-primary text-base">{t("account.bookings4w")}</h3>
            </div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Bar dataKey="count" fill="hsl(var(--gold))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}

      {profile && (
        <Card className="p-6 space-y-5 border-border/40 bg-gradient-to-br from-card/60 to-card/40 backdrop-blur-sm">
          <h3 className="font-semibold text-gold text-lg">{t("account.profile")}</h3>
          <Field label={t("account.displayName")} v={profile.display_name ?? ""} set={(v: string) => setProfile({ ...profile, display_name: v })} />
          <Field label={t("account.phone")} v={profile.phone ?? ""} set={(v: string) => setProfile({ ...profile, phone: v })} />
          <div className="space-y-3 rounded-lg border border-border/40 p-4 bg-muted/20 backdrop-blur-sm">
            <div className="text-sm font-semibold text-gold">{t("account.bankSection")}</div>
            <Field
              label={t("account.bankNameLabel")}
              v={profile.bank_name ?? ""}
              set={(v: string) => setProfile({ ...profile, bank_name: v })}
              disabled={bankLocked}
            />
            <Field
              label={t("account.bankAccountLabel")}
              v={profile.bank_account_number ?? ""}
              set={(v: string) => setProfile({ ...profile, bank_account_number: v.replace(/\s/g, "") })}
              disabled={bankLocked}
            />
            <Field
              label={t("account.bankHolderLabel")}
              v={profile.bank_account_holder ?? ""}
              set={(v: string) => setProfile({ ...profile, bank_account_holder: v })}
              disabled={bankLocked}
            />
            {bankLocked ? (
              <p className="text-xs text-destructive">
                {t("account.bankLockedNote")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("account.bankRequiredHint")}
              </p>
            )}
          </div>
          <Button onClick={save} disabled={saving} className="w-full gradient-gold text-primary-foreground border-0">{saving ? t("common.saving") : t("account.saveChanges")}</Button>
        </Card>
      )}

      {user && <ClubVerificationCard userId={user.id} />}

      <BackingProfileCard />

      <EnableNotificationsCard />

      <Card className="p-6 border-border/40 bg-gradient-to-br from-card/60 to-card/40 backdrop-blur-sm">
        <NotificationPreferences />
      </Card>

      {roles.includes("super_admin") && <PushDiagnostics />}

      <Card className="p-2 divide-y divide-border">
        {(roles.includes("club_admin") || roles.includes("super_admin")) && (
          <>
            <button onClick={() => nav("/club/admin")} className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted/40 rounded">
              <Building2 className="w-4 h-4 text-gold" /> {t("account.clubAdmin")}
            </button>
            <button onClick={() => nav("/inbox")} className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted/40 rounded">
              <Trophy className="w-4 h-4 text-primary" /> {t("account.stackInbox")}
            </button>
            <button onClick={() => nav("/admin/leaderboard")} className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted/40 rounded">
              <Trophy className="w-4 h-4 text-gold" /> {t("account.clubRanking")}
            </button>
          </>
        )}
        {roles.includes("super_admin") && (
          <>
            <button onClick={() => nav("/admin")} className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted/40 rounded">
              <Shield className="w-4 h-4 text-secondary" /> {t("account.superAdmin")}
            </button>
            <button onClick={() => nav("/admin/users")} className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted/40 rounded">
              <Users className="w-4 h-4 text-primary" /> {t("account.userManagement")}
            </button>
            <button onClick={() => nav("/cashier?tab=members&sub=sync")} className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted/40 rounded">
              <Database className="w-4 h-4 text-secondary" /> {t("account.syncClubMembers")}
            </button>
            <button onClick={() => nav("/admin/web-vitals")} className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted/40 rounded">
              <Activity className="w-4 h-4 text-primary" /> {t("account.perfStats")}
            </button>
          </>
        )}
        <button
          onClick={handleCheckUpdate}
          disabled={checkingUpdate}
          className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted/40 rounded disabled:opacity-60"
        >
          {checkingUpdate
            ? <Loader2 className="w-4 h-4 text-primary animate-spin" />
            : <RefreshCw className="w-4 h-4 text-primary" />}
          {checkingUpdate ? t("account.checkingUpdate") : t("account.checkUpdate")}
        </button>
        <button onClick={async () => { await signOut(); nav("/"); }} className="w-full flex items-center gap-2 px-3 py-3 text-sm text-destructive hover:bg-destructive/10 rounded">
          <LogOut className="w-4 h-4" /> {t("account.signOut")}
        </button>
      </Card>
    </div>
  );
};

const Stat = ({ label, value, accent }: { label: string; value: number; accent: string }) => (
  <div className="rounded-lg bg-muted/40 p-3 text-center">
    <div className={`text-2xl font-display ${accent}`}>{value}</div>
    <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
  </div>
);

const Field = ({ label, v, set, disabled }: any) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    <Input value={v} onChange={(e) => set(e.target.value)} disabled={!!disabled} />
  </div>
);

export default Account;
