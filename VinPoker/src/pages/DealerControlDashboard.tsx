/**
 * pages/DealerControlDashboard.tsx — /dealer-control
 *
 * "Điều phối Dealer" (Dealer Control) — the interactive operator console that
 * hosts Dealer Swing + Payroll on their OWN full-width route, split out of the
 * cramped /cashier sub-tab (where the dense 4-column swing battle map was
 * squeezed into ~10/12 of a max-w-[1400px] container and clipped its labels).
 *
 * This page reuses the existing panels as-is (DealerSwingTab / DealerPayrollTab)
 * — no logic change — and only gives them room. Access is gated by the same
 * dealer_control_club_ids RPC the cashier swing tab used; the page self-guards.
 *
 * NOTE: distinct from /dealer-board (DealerControlBoard) which is the read-only
 * TV wall display. A link to it is provided in the header.
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import SwingPanel from "@/components/cashier/DealerSwingTab";
import DealerPayrollTab from "@/components/cashier/DealerPayrollTab";
import { AlertTriangle, Table2, Calculator, MonitorPlay, Shuffle } from "lucide-react";

type ClubRow = { id: string; name: string };
type SectionKey = "swing" | "payroll";

// dealer_control_club_ids / cashier_club_ids are untyped in the generated supabase
// types and may return bare strings or { <key>: string } rows — normalize to string[].
const pickIds = (rows: unknown, key: string): string[] =>
  (Array.isArray(rows) ? rows : [])
    .map((r) => (typeof r === "string" ? r : (r as Record<string, unknown>)?.[key]))
    .filter((x): x is string => typeof x === "string" && x.length > 0);

export default function DealerControlDashboard() {
  const { user, loading, isAdmin } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const section: SectionKey = params.get("tab") === "payroll" ? "payroll" : "swing";

  const [clubs, setClubs] = useState<ClubRow[] | null>(null);
  const [dealerClubIds, setDealerClubIds] = useState<string[]>([]);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/auth"); return; }
  }, [loading, user, nav]);

  // Resolve the dealer-control club scope (same RPC the cashier swing tab used);
  // fall back to cashier clubs for the names when the dealer-control set is empty.
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: dcIds } = await supabase.rpc("dealer_control_club_ids", { _user_id: user.id });
      const dArr = pickIds(dcIds, "dealer_control_club_ids");
      setDealerClubIds(dArr);

      let idArr = dArr;
      if (!idArr.length) {
        const { data: cIds } = await supabase.rpc("cashier_club_ids", { _user_id: user.id });
        idArr = pickIds(cIds, "cashier_club_ids");
      }
      if (!idArr.length) { setClubs([]); return; }
      const { data: cs } = await supabase.from("clubs").select("id,name").in("id", idArr);
      setClubs((cs ?? []) as ClubRow[]);
    })();
  }, [user]);

  const setSection = (s: SectionKey) => {
    const p = new URLSearchParams(params); p.set("tab", s); setParams(p, { replace: true });
  };

  if (loading || !user || clubs === null) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (clubs.length === 0 && !isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-warning" />
          <div className="text-lg font-bold">Bạn chưa được phân công điều phối dealer</div>
          <p className="text-sm text-muted-foreground">
            Liên hệ Super Admin để được gán quyền điều phối dealer cho câu lạc bộ.
          </p>
        </Card>
      </div>
    );
  }

  const clubIds = clubs.map((c) => c.id);
  const scopedClubIds = dealerClubIds.length > 0 ? dealerClubIds : clubIds;

  const tabs: { key: SectionKey; label: string; icon: typeof Table2 }[] = [
    { key: "swing", label: "Dealer Swing", icon: Table2 },
    { key: "payroll", label: "Bảng lương", icon: Calculator },
  ];

  return (
    // Full-bleed: break out of Layout's centered max-w-[1400px] container so the
    // dense swing console gets the full viewport width (no more clipped labels).
    // Layout's root has overflow-x-hidden, so w-screen never adds a scrollbar.
    <div className="mx-[calc(50%-50vw)] w-screen px-3 lg:px-6">
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Shuffle className="w-5 h-5 text-primary" /> Điều phối Dealer
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {clubs.length === 0 ? "Toàn quyền (Admin)" : `Phụ trách: ${clubs.map((c) => c.name).join(", ")}`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Dealer Swing / Bảng lương segmented control */}
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-card">
            {tabs.map((it) => {
              const active = section === it.key;
              const Icon = it.icon;
              return (
                <button
                  key={it.key}
                  onClick={() => setSection(it.key)}
                  className={
                    "inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm transition-colors " +
                    (active
                      ? "bg-primary/15 text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  <Icon className="w-4 h-4" />
                  {it.label}
                </button>
              );
            })}
          </div>
          <Button asChild size="sm" variant="outline" className="h-9 border-primary/40 text-primary hover:bg-primary/10">
            <a href="/dealer-board" title="Bảng tường TV (chỉ xem)">
              <MonitorPlay className="w-4 h-4 mr-1" /> Bảng tường
            </a>
          </Button>
        </div>
      </div>

      {section === "swing" && <SwingPanel clubIds={scopedClubIds} clubs={clubs} />}
      {section === "payroll" && <DealerPayrollTab clubIds={scopedClubIds} clubs={clubs} />}
    </div>
  );
}
