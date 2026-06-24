import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2, UserPlus, UserMinus, Search } from "lucide-react";

// Club owner/admin grants/revokes the club-scoped `marketing` role to staff/accounts.
// Backend: marketing_list_club_members (owner read) + marketing_grant_marketer / _revoke_marketer
// (owner-gated). Loosely-typed client (marketing_* not in generated types).
const sb = supabase as any;

interface Member { user_id: string; name: string | null; phone: string | null; is_marketer: boolean }
interface Props { clubId: string; onChanged?: () => void }

export const MarketingStaffManager = ({ clubId, onChanged }: Props) => {
  const { t } = useTranslation();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await sb.rpc("marketing_list_club_members", { p_club_id: clubId });
      if (error || data?.error) { setLoadError(true); setMembers([]); }
      else setMembers((data?.members ?? []) as Member[]);
    } catch {
      setLoadError(true); setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (m: Member) => {
    setBusyId(m.user_id);
    try {
      const fn = m.is_marketer ? "marketing_revoke_marketer" : "marketing_grant_marketer";
      const { data, error } = await sb.rpc(fn, { p_club_id: clubId, p_user_id: m.user_id });
      if (error || data?.error) { toast.error(error?.message ?? data?.error ?? "error"); return; }
      toast.success(m.is_marketer ? t("marketing.staff.revoked") : t("marketing.staff.granted"));
      setMembers((arr) => arr.map((x) => (x.user_id === m.user_id ? { ...x, is_marketer: !x.is_marketer } : x)));
      onChanged?.();
    } finally { setBusyId(null); }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return members;
    return members.filter((m) =>
      (m.name ?? "").toLowerCase().includes(s) || (m.phone ?? "").toLowerCase().includes(s));
  }, [members, q]);

  if (loading) return <div className="space-y-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-24 w-full" /></div>;

  if (loadError) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">{t("marketing.staff.loadError")}</CardContent></Card>;
  }

  const assignedCount = members.filter((m) => m.is_marketer).length;

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("marketing.staff.search")} />
      </div>

      <p className="text-xs text-muted-foreground">{t("marketing.staff.assignedCount", { count: assignedCount })}</p>

      {filtered.length === 0 ? (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">{t("marketing.staff.empty")}</CardContent></Card>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{m.name ?? m.user_id.slice(0, 8)}</div>
                <div className="truncate text-xs text-muted-foreground">{m.phone ?? "—"}</div>
              </div>
              <Button
                size="sm"
                variant={m.is_marketer ? "outline" : "default"}
                onClick={() => toggle(m)}
                disabled={busyId === m.user_id}
                className={m.is_marketer ? "border-destructive/40 text-destructive" : ""}
              >
                {busyId === m.user_id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  : m.is_marketer ? <UserMinus className="mr-1.5 h-4 w-4" /> : <UserPlus className="mr-1.5 h-4 w-4" />}
                {m.is_marketer ? t("marketing.staff.revoke") : t("marketing.staff.grant")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
