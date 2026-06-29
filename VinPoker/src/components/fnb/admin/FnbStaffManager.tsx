import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mapFnbError } from "@/lib/fnbErrors";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Search, Check } from "lucide-react";

// Club owner grants/revokes the 3 F&B facets (cashier/server/kitchen) per account.
// Backend: fnb_list_club_members(p_club_id,p_query) (owner read, …0008) + fnb_grant_staff /
// fnb_revoke_staff(p_club_id,p_user_id,p_kind) (owner-gated, 000001). Untyped client (fnb_* not in
// generated types). F&B contract: {status:'ok'}|{error} — handle via mapFnbError.
const sb = supabase as any;

type Kind = "cashier" | "server" | "kitchen";
type FnbMember = {
  user_id: string; name: string | null; phone: string | null;
  is_cashier: boolean; is_server: boolean; is_kitchen: boolean;
};
const FACETS: { kind: Kind; label: string }[] = [
  { kind: "cashier", label: "Thu ngân" },
  { kind: "server", label: "Phục vụ" },
  { kind: "kitchen", label: "Bếp" },
];
const flagKey = (k: Kind): "is_cashier" | "is_server" | "is_kitchen" =>
  k === "cashier" ? "is_cashier" : k === "server" ? "is_server" : "is_kitchen";

export function FnbStaffManager({ clubId, onChanged }: { clubId: string; onChanged?: () => void }) {
  const [members, setMembers] = useState<FnbMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [q, setQ] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    if (!clubId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await sb.rpc("fnb_list_club_members", { p_club_id: clubId, p_query: query });
      if (error || data?.error) { setLoadError(true); setMembers([]); }
      else setMembers((data?.members ?? []) as FnbMember[]);
    } catch {
      setLoadError(true); setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  // Server-side search (debounced 300ms) — searches ALL registered accounts (owner approved scope).
  useEffect(() => {
    const id = setTimeout(() => { load(q); }, 300);
    return () => clearTimeout(id);
  }, [q, load]);

  const toggleFacet = async (m: FnbMember, kind: Kind) => {
    const has = Boolean(m[flagKey(kind)]);
    const key = `${m.user_id}:${kind}`;
    setBusyKey(key);
    try {
      const fn = has ? "fnb_revoke_staff" : "fnb_grant_staff";
      const { data, error } = await sb.rpc(fn, { p_club_id: clubId, p_user_id: m.user_id, p_kind: kind });
      const res = data as any;
      if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
      // optimistic flip of just this facet
      setMembers((arr) => arr.map((x) => (x.user_id === m.user_id ? { ...x, [flagKey(kind)]: !has } : x)));
      onChanged?.();
    } finally { setBusyKey(null); }
  };

  if (loading) {
    return <div className="space-y-2"><Skeleton className="h-9 w-full max-w-sm" /><Skeleton className="h-24 w-full" /></div>;
  }
  if (loadError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Chưa tải được danh sách tài khoản — cần áp dụng RPC <span className="font-mono">fnb_list_club_members</span> (migration …0008) trên DB trước.
        </CardContent>
      </Card>
    );
  }

  const assigned = members.filter((m) => m.is_cashier || m.is_server || m.is_kitchen).length;

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-base">Nhân sự F&amp;B</h3>
        <p className="text-xs text-muted-foreground">
          Tìm tài khoản rồi bật/tắt vai trò: <span className="font-medium">Thu ngân</span> (thu tiền) ·
          <span className="font-medium"> Phục vụ</span> (giao món) · <span className="font-medium">Bếp</span> (màn hình bếp).
          Chỉ chủ CLB gán được; một người có thể giữ nhiều vai trò.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8 bg-card border-border text-foreground" value={q}
          onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên hoặc số điện thoại…" />
      </div>

      <p className="text-xs text-muted-foreground">{assigned} tài khoản đang có vai trò F&amp;B.</p>

      {members.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
          Không có tài khoản phù hợp.
        </div>
      ) : (
        <div className="space-y-1.5">
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{m.name ?? m.user_id.slice(0, 8)}</div>
                <div className="truncate text-xs text-muted-foreground">{m.phone ?? "—"}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {FACETS.map((f) => {
                  const on = Boolean(m[flagKey(f.kind)]);
                  const key = `${m.user_id}:${f.kind}`;
                  return (
                    <Button key={key} size="sm" variant={on ? "default" : "outline"}
                      onClick={() => toggleFacet(m, f.kind)} disabled={busyKey === key}
                      className={on
                        ? "bg-success hover:bg-success/90 text-success-foreground h-7 px-2.5"
                        : "border-border bg-background text-muted-foreground h-7 px-2.5"}>
                      {busyKey === key
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : on ? <Check className="w-3.5 h-3.5 mr-1" /> : null}
                      {f.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
