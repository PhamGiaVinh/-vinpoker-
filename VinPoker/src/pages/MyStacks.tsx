import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, formatVND } from "@/lib/format";
import { Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";

const MyStacks = () => {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [regs, setRegs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) { setLoading(false); return; }
    const { data } = await supabase.from("stack_registrations")
      .select("*, tournament:tournaments(id,name,start_time,buy_in, club:clubs(name))")
      .eq("user_id", user.id).order("created_at", { ascending: false });
    setRegs(data ?? []); setLoading(false);
  };

  useEffect(() => {
    if (!authLoading) load();
    if (!user) return;
    const interval = window.setInterval(load, 30_000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  const cancel = async (id: string) => {
    const { error } = await supabase.from("stack_registrations").update({ status: "cancelled" }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success(t("myStacks.cancelled")); load(); }
  };

  if (authLoading || loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  if (!user) return (
    <Card className="p-6 text-center gradient-card border-gold shadow-card">
      <Ticket className="w-10 h-10 mx-auto text-gold mb-2" />
      <h2 className="font-display text-lg">{t("myStacks.signInTitle")}</h2>
      <p className="text-sm text-muted-foreground mt-1">{t("myStacks.signInDesc")}</p>
      <Button onClick={() => nav("/auth")} className="mt-4 gradient-gold text-primary-foreground border-0">{t("myStacks.signIn")}</Button>
    </Card>
  );

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-gold">{t("myStacks.title")}</h1>
      {regs.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">{t("myStacks.empty")} <Link to="/" className="text-gold underline">{t("myStacks.viewTournaments")}</Link></Card>
      ) : regs.map(r => (
        <Card key={r.id} className="gradient-card p-4 border-border">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/tournament/${r.tournament?.id}`} className="min-w-0 flex-1">
              <h3 className="font-semibold truncate">{r.tournament?.name}</h3>
              <p className="text-xs text-muted-foreground">{r.tournament?.club?.name} · {formatDateTime(r.tournament?.start_time)}</p>
              <p className="text-xs text-gold mt-1">{formatVND(r.tournament?.buy_in ?? 0)}</p>
            </Link>
            <StatusBadge status={r.status} />
          </div>
          {r.status === "pending" && (
            <Button variant="outline" size="sm" className="mt-3 w-full border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => cancel(r.id)}>
              {t("myStacks.cancelReg")}
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
};

export default MyStacks;
