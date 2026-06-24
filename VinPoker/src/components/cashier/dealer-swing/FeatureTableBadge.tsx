/**
 * FeatureTableBadge — Patch 1 (UI mock). Renders a "Tâm điểm" / "Final" pill for
 * a table when the dealer-feature-tables flag is ON and the (mock) profile marks
 * it special. Returns null otherwise → zero change to the live card when the flag
 * is OFF. `useFeatureTableBorder` returns the matching card border/glow accent.
 */
import { Star, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import { getProfile, featureBadgeFor, useFeatureTableVersion } from "./featureTableMock";

export function FeatureTableBadge({ tableId, className }: { tableId: string; className?: string }) {
  useFeatureTableVersion();
  if (!FEATURES.dealerFeatureTables) return null;
  const badge = featureBadgeFor(getProfile(tableId));
  if (!badge) return null;
  const Icon = badge.key === "final" ? Star : Sparkles;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
        badge.badgeClass,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      {badge.label}
    </span>
  );
}

/** Card border + glow accent for a special table (empty string when OFF/normal). */
export function useFeatureTableBorder(tableId: string): string {
  useFeatureTableVersion();
  if (!FEATURES.dealerFeatureTables) return "";
  return featureBadgeFor(getProfile(tableId))?.borderClass ?? "";
}
