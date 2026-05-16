import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, Shield, Trophy, Search, Upload } from "lucide-react";
import { MoneyListManager } from "@/components/MoneyListManager";
import { ClubMoneyListManager } from "@/components/ClubMoneyListManager";

const today = () => new Date().toISOString().slice(0, 10);

const AdminLeaderboard = () => {
  const { user, loading, isAdmin, isClubAdmin } = useAuth();
  const [busy, setBusy] = useState(true);
  const [entries, setEntries] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [users, setUsers] = useState<any[]>([]);
  const [clubs, setClubs] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [clubFilter, setClubFilter] = useState<string>("all");

  const load = async () => {
    setBusy(true);
    let clubsQuery = supabase.from("clubs").select("id, name, owner_id");
    if (!isAdmin && user) clubsQuery = clubsQuery.eq("owner_id", user.id);
    const [{ data: e }, { data: profs }, { data: c }] = await Promise.all([
      supabase.from("leaderboard_entries").select("*").order("entry_date", { ascending: false }),
      supabase.from("profiles").select("user_id, display_name"),
      clubsQuery,
    ]);
    const allowedClubIds = new Set((c ?? []).map((x: any) => x.id));
    const filtered = isAdmin ? (e ?? []) : (e ?? []).filter((x: any) => x.club_id && allowedClubIds.has(x.club_id));
    setEntries(filtered);
    setUsers(profs ?? []);
    setClubs(c ?? []);
    setProfiles(Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p])));
    setBusy(false);
  };

  useEffect(() => { if (isClubAdmin) load(); else if (!loading) setBusy(false); }, [isClubAdmin, isAdmin, loading, user?.id]);

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (clubFilter !== "all" && e.club_id !== clubFilter && !(clubFilter === "__overall__" && !e.club_id)) return false;
      if (!q) return true;
      const name = (profiles[e.player_id]?.display_name ?? "").toLowerCase();
      return name.includes(q);
    });
  }, [entries, search, clubFilter, profiles]);

  const totalWinnings = useMemo(
    () => visibleEntries.reduce((sum, e) => sum + Number(e.winnings ?? 0), 0),
    [visibleEntries]
  );

  if (loading || busy) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isClubAdmin) return (
    <Card className="p-6 text-center">
      <Shield className="w-10 h-10 mx-auto text-destructive mb-2" />
      <h2 className="font-display text-lg">Không có quyền truy cập</h2>
    </Card>
  );

  const remove = async (id: string) => {
    if (!confirm("Xoá entry này?")) return;
    const { error } = await supabase.from("leaderboard_entries").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Đã xoá"); load(); }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Trophy className="w-6 h-6 text-primary" />
          <div>
            <h1 className="font-display text-xl md:text-2xl">Quản lý Bảng Xếp Hạng</h1>
            <p className="text-[11px] text-muted-foreground">Cập nhật kết quả thắng/cashout hàng ngày của player.</p>
          </div>
        </div>
        <EntryDialog users={users} clubs={clubs} isAdmin={isAdmin} onSaved={load} />
      </header>

      <Tabs defaultValue="entries">
        <TabsList className={`grid w-full ${isAdmin ? "grid-cols-3" : "grid-cols-2"} max-w-xl`}>
          <TabsTrigger value="entries">
            <Trophy className="w-3.5 h-3.5 mr-1.5" /> Entries hàng ngày
          </TabsTrigger>
          <TabsTrigger value="club-money">
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Money List CLB
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="money-list">
              <Upload className="w-3.5 h-3.5 mr-1.5" /> All-Time (VN)
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="entries" className="mt-4 space-y-3">
          {/* Compact filter bar */}
          <div className="grid gap-2 sm:grid-cols-[1fr_220px_auto] sm:items-center p-3 rounded-lg border border-border bg-card/40">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo tên player..."
                className="pl-9 h-9"
              />
            </div>
            <Select value={clubFilter} onValueChange={setClubFilter}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả CLB</SelectItem>
                {isAdmin && <SelectItem value="__overall__">— Overall —</SelectItem>}
                {clubs.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Tổng winnings</div>
              <div className="text-sm font-bold text-success">+{totalWinnings.toLocaleString("vi-VN")}₫</div>
            </div>
          </div>

          {/* Entries list */}
          {visibleEntries.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              {entries.length === 0 ? "Chưa có entry nào." : "Không có entry phù hợp bộ lọc."}
            </Card>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border/60">
              {visibleEntries.map((e) => {
                const club = clubs.find((c) => c.id === e.club_id);
                return (
                  <div key={e.id} className="flex items-center gap-3 p-3 bg-card/30 hover:bg-card/60 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-sm">
                        {profiles[e.player_id]?.display_name ?? "Player"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {e.entry_date} · {club?.name ?? "Overall"}
                        {e.notes && <span className="italic"> · "{e.notes}"</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-success font-semibold">
                        +{Number(e.winnings).toLocaleString("vi-VN")}₫
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        CO {Number(e.cashout).toLocaleString("vi-VN")}₫
                      </div>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <EntryDialog
                        entry={e} users={users} clubs={clubs} isAdmin={isAdmin} onSaved={load}
                        trigger={<Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="w-3.5 h-3.5 text-primary" /></Button>}
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(e.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="club-money" className="mt-4">
          <div className="mb-3 p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-muted-foreground">
            Dán danh sách Money List của CLB (tên + tổng tiền thắng). Sẽ thay thế toàn bộ danh sách của CLB đã chọn.
          </div>
          <ClubMoneyListManager currentUserId={user.id} clubs={clubs} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="money-list" className="mt-4">
            <div className="mb-3 p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-muted-foreground">
              Dán danh sách Top 100 Vietnam All-Time Money List. Tên trùng tài khoản đã đăng ký sẽ tự động liên kết.
            </div>
            <MoneyListManager currentUserId={user.id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

const EntryDialog = ({ entry, users, clubs, isAdmin, onSaved, trigger }: any) => {
  const [open, setOpen] = useState(false);
  const defaultClub = entry?.club_id ?? (!isAdmin && clubs[0]?.id) ?? "";
  const [f, setF] = useState({
    player_id: entry?.player_id ?? "",
    club_id: defaultClub,
    winnings: entry?.winnings ?? 0,
    cashout: entry?.cashout ?? 0,
    entry_date: entry?.entry_date ?? today(),
    notes: entry?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!f.player_id) return toast.error("Chọn 1 player");
    if (!isAdmin && !f.club_id) return toast.error("Chọn 1 CLB");
    setSaving(true);
    const payload = {
      player_id: f.player_id,
      club_id: f.club_id || null,
      winnings: Number(f.winnings),
      cashout: Number(f.cashout),
      entry_date: f.entry_date,
      notes: f.notes,
    };
    const { error } = entry
      ? await supabase.from("leaderboard_entries").update(payload).eq("id", entry.id)
      : await supabase.from("leaderboard_entries").insert(payload);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Đã lưu"); setOpen(false); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm" className="gradient-neon text-primary-foreground border-0"><Plus className="w-4 h-4 mr-1" />Thêm entry</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{entry ? "Sửa Entry" : "Thêm Ranking Entry"}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Player</Label>
          <Select value={f.player_id} onValueChange={v => setF({ ...f, player_id: v })}>
            <SelectTrigger><SelectValue placeholder="Chọn player" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {users.map((u: any) => <SelectItem key={u.user_id} value={u.user_id}>{u.display_name ?? u.user_id.slice(0, 8)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Label>{isAdmin ? "CLB (để trống = overall)" : "CLB"}</Label>
          <Select value={f.club_id || "__none__"} onValueChange={v => setF({ ...f, club_id: v === "__none__" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="Chọn CLB" /></SelectTrigger>
            <SelectContent>
              {isAdmin && <SelectItem value="__none__">— Overall —</SelectItem>}
              {clubs.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Thắng (VND)</Label><Input type="number" value={f.winnings} onChange={e => setF({ ...f, winnings: +e.target.value })} /></div>
            <div><Label>Cashout (VND)</Label><Input type="number" value={f.cashout} onChange={e => setF({ ...f, cashout: +e.target.value })} /></div>
          </div>
          <Label>Ngày</Label>
          <Input type="date" value={f.entry_date} onChange={e => setF({ ...f, entry_date: e.target.value })} />
          <Label>Ghi chú</Label>
          <Input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />
          <Button onClick={submit} disabled={saving} className="w-full gradient-neon text-primary-foreground border-0">
            {saving ? "Đang lưu..." : "Lưu"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdminLeaderboard;
