import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Shield, Search, UserCog } from "lucide-react";

type Role = "player" | "club_admin" | "super_admin" | "cashier" | "media" | "dealer_control" | "tracker";

const AdminUsers = () => {
  const { user, loading, isAdmin } = useAuth();
  const [busy, setBusy] = useState(true);
  const [users, setUsers] = useState<any[]>([]);
  const [rolesByUser, setRolesByUser] = useState<Record<string, Role[]>>({});
  const [clubs, setClubs] = useState<any[]>([]);
  const [cashierClubsByUser, setCashierClubsByUser] = useState<Record<string, string[]>>({});
  const [dealerClubsByUser, setDealerClubsByUser] = useState<Record<string, string[]>>({});
  const [trackerClubsByUser, setTrackerClubsByUser] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState("");

  const load = async () => {
    setBusy(true);
    const [profsRes, rolesRes, csRes, ccRes, dcRes, tcRes] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("clubs").select("id, name, owner_id"),
      supabase.from("club_cashiers" as any).select("user_id, club_id"),
      supabase.from("club_dealer_controls" as any).select("user_id, club_id"),
      supabase.from("club_trackers" as any).select("user_id, club_id"),
    ]);
    if (profsRes.error) {
      toast.error("Lỗi tải user: " + profsRes.error.message);
      console.error("profiles error", profsRes.error);
    }
    if (rolesRes.error) console.error("roles error", rolesRes.error);
    setUsers(profsRes.data ?? []);
    const map: Record<string, Role[]> = {};
    for (const r of rolesRes.data ?? []) {
      (map[r.user_id] ??= []).push(r.role as Role);
    }
    setRolesByUser(map);
    setClubs(csRes.data ?? []);
    const ccMap: Record<string, string[]> = {};
    for (const r of (ccRes.data ?? []) as any[]) {
      (ccMap[r.user_id] ??= []).push(r.club_id);
    }
    setCashierClubsByUser(ccMap);
    const dcMap: Record<string, string[]> = {};
    for (const r of (dcRes.data ?? []) as any[]) {
      (dcMap[r.user_id] ??= []).push(r.club_id);
    }
    setDealerClubsByUser(dcMap);
    const tcMap: Record<string, string[]> = {};
    for (const r of (tcRes.data ?? []) as any[]) {
      (tcMap[r.user_id] ??= []).push(r.club_id);
    }
    setTrackerClubsByUser(tcMap);
    setBusy(false);
  };

  const toggleVerified = async (uid: string, current: boolean) => {
    const { error } = await supabase.from("profiles").update({ is_verified: !current }).eq("user_id", uid);
    if (error) toast.error(error.message);
    else {
      // Sync player_stats.verified
      await supabase.from("player_stats").update({ verified: !current }).eq("player_id", uid);
      toast.success(!current ? "Đã xác minh player" : "Đã bỏ xác minh");
      load();
    }
  };

  useEffect(() => { if (isAdmin) load(); else if (!loading) setBusy(false); }, [isAdmin, loading]);

  if (loading || busy) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return (
    <Card className="p-6 text-center">
      <Shield className="w-10 h-10 mx-auto text-destructive mb-2" />
      <h2 className="font-display text-lg">No Access</h2>
    </Card>
  );

  const grant = async (uid: string, role: Role) => {
    const { error } = await supabase.from("user_roles").insert({ user_id: uid, role });
    if (error && !error.message.includes("duplicate")) toast.error(error.message);
    else { toast.success(`Granted ${role}`); load(); }
  };

  const revoke = async (uid: string, role: Role) => {
    const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", role);
    if (error) toast.error(error.message); else { toast.success(`Revoked ${role}`); load(); }
  };

  const revokeCashier = async (uid: string) => {
    const { error: rErr } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "cashier");
    if (rErr) { toast.error(rErr.message); return; }
    await supabase.from("club_cashiers" as any).delete().eq("user_id", uid);
    toast.success("Revoked cashier"); load();
  };

  const toggleCashierClub = async (uid: string, clubId: string, currentlyAssigned: boolean) => {
    if (currentlyAssigned) {
      const { error } = await supabase.from("club_cashiers" as any).delete().eq("user_id", uid).eq("club_id", clubId);
      if (error) toast.error(error.message); else { toast.success("Đã bỏ gán CLB"); load(); }
    } else {
      const { error } = await supabase.from("club_cashiers" as any).insert({ user_id: uid, club_id: clubId, granted_by: user?.id });
      if (error && !error.message.includes("duplicate")) toast.error(error.message);
      else { toast.success("Đã gán cashier cho CLB"); load(); }
    }
  };

  const revokeDealerControl = async (uid: string) => {
    const { error: rErr } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "dealer_control");
    if (rErr) { toast.error(rErr.message); return; }
    await supabase.from("club_dealer_controls" as any).delete().eq("user_id", uid);
    toast.success("Revoked dealer control"); load();
  };

  const toggleDealerClub = async (uid: string, clubId: string, currentlyAssigned: boolean) => {
    if (currentlyAssigned) {
      const { error } = await supabase.from("club_dealer_controls" as any).delete().eq("user_id", uid).eq("club_id", clubId);
      if (error) toast.error(error.message); else { toast.success("Đã bỏ gán CLB"); load(); }
    } else {
      const { error } = await supabase.from("club_dealer_controls" as any).insert({ user_id: uid, club_id: clubId, granted_by: user?.id });
      if (error && !error.message.includes("duplicate")) toast.error(error.message);
      else { toast.success("Đã gán dealer control cho CLB"); load(); }
    }
  };

  const revokeTracker = async (uid: string) => {
    const { error: rErr } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "tracker");
    if (rErr) { toast.error(rErr.message); return; }
    await supabase.from("club_trackers" as any).delete().eq("user_id", uid);
    toast.success("Revoked tracker"); load();
  };

  const toggleTrackerClub = async (uid: string, clubId: string, currentlyAssigned: boolean) => {
    if (currentlyAssigned) {
      const { error } = await supabase.from("club_trackers" as any).delete().eq("user_id", uid).eq("club_id", clubId);
      if (error) toast.error(error.message); else { toast.success("Đã bỏ gán CLB"); load(); }
    } else {
      const { error } = await supabase.from("club_trackers" as any).insert({ user_id: uid, club_id: clubId, granted_by: user?.id });
      if (error && !error.message.includes("duplicate")) toast.error(error.message);
      else { toast.success("Đã gán tracker cho CLB"); load(); }
    }
  };

  const assignClub = async (uid: string, clubId: string) => {
    const { error } = await supabase.from("clubs").update({ owner_id: uid }).eq("id", clubId);
    if (error) toast.error(error.message);
    else {
      // Auto-grant club_admin if not present
      if (!(rolesByUser[uid] ?? []).includes("club_admin")) {
        await supabase.from("user_roles").insert({ user_id: uid, role: "club_admin" });
      }
      toast.success("Granted CLB cho user"); load();
    }
  };

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.display_name ?? "").toLowerCase().includes(q) || (u.phone ?? "").includes(q) || u.user_id.includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <UserCog className="w-6 h-6 text-gold" />
        <div>
          <h1 className="font-display text-2xl text-gold">User Management</h1>
          <p className="text-xs text-muted-foreground">Grant Club Admin permissions and manage users.</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by name / phone / id..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No users found.</p>}
        {filtered.map(u => {
          const roles = rolesByUser[u.user_id] ?? [];
          const ownedClubs = clubs.filter(c => c.owner_id === u.user_id);
          return (
            <Card key={u.user_id} className="p-3 gradient-card space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{u.display_name ?? "Unnamed user"}</div>
                  <div className="text-[11px] text-muted-foreground truncate">ID: {u.user_id}</div>
                  {u.phone && <div className="text-xs text-gold">{u.phone}</div>}
                  {u.region && <div className="text-xs text-muted-foreground">📍 {u.region}</div>}
                </div>
                <div className="flex flex-wrap gap-1 justify-end">
                    {roles.map(r => (
                    <span key={r} className={`text-[10px] px-2 py-0.5 rounded-full border ${r === "super_admin" ? "bg-destructive/15 text-destructive border-destructive/30" : r === "cashier" ? "bg-primary/15 text-primary border-primary/30" : r === "club_admin" ? "bg-gold/15 text-gold border-gold/30" : r === "media" ? "bg-purple-500/15 text-purple-400 border-purple-500/30" : r === "dealer_control" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : r === "tracker" ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" : "bg-muted text-muted-foreground border-border"}`}>
                      {r}
                    </span>
                  ))}
                  {roles.length === 0 && <span className="text-[10px] text-muted-foreground">player</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {u.is_verified && <span className="text-[10px] px-2 py-0.5 rounded-full border bg-blue-500/15 text-blue-400 border-blue-500/30">✓ Verified Player</span>}
              </div>

              {ownedClubs.length > 0 && (
                <div className="text-xs text-muted-foreground">Owned clubs: <span className="text-foreground">{ownedClubs.map(c => c.name).join(", ")}</span></div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {roles.includes("club_admin") ? (
                  <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={() => revoke(u.user_id, "club_admin")}>
                    Revoke Club Admin
                  </Button>
                ) : (
                  <Button size="sm" className="gradient-gold text-primary-foreground border-0" onClick={() => grant(u.user_id, "club_admin")}>
                    Grant Club Admin
                  </Button>
                )}
                {roles.includes("super_admin") ? (
                  <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={() => revoke(u.user_id, "super_admin")}>
                    Revoke Super Admin
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => grant(u.user_id, "super_admin")}>
                    Grant Super Admin
                  </Button>
                )}
                {roles.includes("cashier") ? (
                  <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={() => revokeCashier(u.user_id)}>
                    Revoke Cashier
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="border-primary/40 text-primary" onClick={() => grant(u.user_id, "cashier")}>
                    Grant Cashier
                  </Button>
                )}
                {roles.includes("media") ? (
                  <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={() => revoke(u.user_id, "media")}>
                    Revoke Media
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="border-purple-500/40 text-purple-400" onClick={() => grant(u.user_id, "media")}>
                    Grant Media
                  </Button>
                )}
                {roles.includes("dealer_control") ? (
                  <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={() => revokeDealerControl(u.user_id)}>
                    Revoke Dealer Control
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-400" onClick={() => grant(u.user_id, "dealer_control")}>
                    Grant Dealer Control
                  </Button>
                )}
                {roles.includes("tracker") ? (
                  <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={() => revokeTracker(u.user_id)}>
                    Revoke Tracker
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="border-cyan-500/40 text-cyan-400" onClick={() => grant(u.user_id, "tracker")}>
                    Grant Tracker
                  </Button>
                )}
                {u.is_verified ? (
                  <Button size="sm" variant="outline" className="border-blue-500/40 text-blue-400" onClick={() => toggleVerified(u.user_id, true)}>
                    Bỏ xác minh
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="border-blue-500/40 text-blue-400" onClick={() => toggleVerified(u.user_id, false)}>
                    Verify Player
                  </Button>
                )}
              </div>

              {roles.includes("cashier") && clubs.length > 0 && (
                <div className="pt-2 border-t border-border/50">
                  <div className="text-xs font-medium text-primary mb-1.5">Cashier cho CLB:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {clubs.map(c => {
                      const assigned = (cashierClubsByUser[u.user_id] ?? []).includes(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => toggleCashierClub(u.user_id, c.id, assigned)}
                          className={`text-[11px] px-2 py-1 rounded-md border transition ${assigned ? "bg-primary/20 text-primary border-primary/50" : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"}`}
                        >
                          {assigned ? "✓ " : ""}{c.name}
                        </button>
                      );
                    })}
                  </div>
                  {(cashierClubsByUser[u.user_id] ?? []).length === 0 && (
                    <div className="text-[10px] text-amber-500 mt-1">⚠ Chưa được gán CLB nào — cashier sẽ không thấy deal nào.</div>
                  )}
                </div>
              )}
              {roles.includes("dealer_control") && clubs.length > 0 && (
                <div className="pt-2 border-t border-border/50">
                  <div className="text-xs font-medium text-emerald-400 mb-1.5">Dealer Control cho CLB:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {clubs.map(c => {
                      const assigned = (dealerClubsByUser[u.user_id] ?? []).includes(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => toggleDealerClub(u.user_id, c.id, assigned)}
                          className={`text-[11px] px-2 py-1 rounded-md border transition ${assigned ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50" : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"}`}
                        >
                          {assigned ? "✓ " : ""}{c.name}
                        </button>
                      );
                    })}
                  </div>
                  {(dealerClubsByUser[u.user_id] ?? []).length === 0 && (
                    <div className="text-[10px] text-amber-500 mt-1">⚠ Chưa được gán CLB nào — dealer control sẽ không thấy gì.</div>
                  )}
                </div>
              )}
              {roles.includes("tracker") && clubs.length > 0 && (
                <div className="pt-2 border-t border-border/50">
                  <div className="text-xs font-medium text-cyan-400 mb-1.5">Tracker cho CLB:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {clubs.map(c => {
                      const assigned = (trackerClubsByUser[u.user_id] ?? []).includes(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => toggleTrackerClub(u.user_id, c.id, assigned)}
                          className={`text-[11px] px-2 py-1 rounded-md border transition ${assigned ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/50" : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"}`}
                        >
                          {assigned ? "✓ " : ""}{c.name}
                        </button>
                      );
                    })}
                  </div>
                  {(trackerClubsByUser[u.user_id] ?? []).length === 0 && (
                    <div className="text-[10px] text-amber-500 mt-1">⚠ Chưa được gán CLB nào — tracker sẽ không thấy giải nào.</div>
                  )}
                </div>
              )}
              {clubs.length > 0 && (
                <div className="pt-1">
                  <Select onValueChange={(v) => assignClub(u.user_id, v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Assign club owner..." /></SelectTrigger>
                    <SelectContent>
                      {clubs.map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.owner_id ? " (has owner)" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default AdminUsers;
