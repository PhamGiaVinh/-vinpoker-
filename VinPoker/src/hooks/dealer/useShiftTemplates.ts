import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";
import { dealerDataSource } from "@/lib/dealerApp/dataSource";
import { DEFAULT_SHIFT_TEMPLATE_SEEDS } from "@/lib/shiftPlanner/templateSeeds";

/**
 * Selectable shift templates for the dealer's "Đăng ký lịch làm việc" picker.
 * MOCK = the default seed windows (id = label, since the mock RPC ignores template_id).
 * LIVE = the club's active dealer_shift_templates (real uuids → dealer_submit_availability).
 * Falls back to [] on no-club / error → the dialog hides the per-shift option gracefully.
 */
export interface DealerShiftTemplateOption {
  id: string;
  label: string;
  timeLabel: string;
}

// dealer_shift_templates may not be in the generated types until applied+regenerated → cast.
const db = supabase as unknown as { from: (t: string) => any };

export function useShiftTemplates() {
  const { dealer } = useDealerLink();
  const clubId = dealer?.clubId ?? null;
  const [templates, setTemplates] = useState<DealerShiftTemplateOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (dealerDataSource() === "mock") {
      setTemplates(
        DEFAULT_SHIFT_TEMPLATE_SEEDS.filter((s) => s.needCount > 0).map((s) => ({
          id: s.label,
          label: s.label,
          timeLabel: `${s.start}–${s.end}`,
        })),
      );
      return;
    }
    if (!clubId) {
      setTemplates([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data } = await db
          .from("dealer_shift_templates")
          .select("id, label, scheduled_start_at, scheduled_end_at")
          .eq("club_id", clubId)
          .eq("active", true)
          .order("scheduled_start_at");
        if (cancelled) return;
        setTemplates(
          ((data ?? []) as { id: string; label: string }[]).map((r) => ({
            id: r.id,
            label: r.label,
            timeLabel: r.label, // label already encodes the window (e.g. "08–16")
          })),
        );
      } catch {
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  return { templates, loading };
}
