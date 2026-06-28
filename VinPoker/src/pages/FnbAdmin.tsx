import { Navigate } from "react-router-dom";
import { FEATURES } from "@/lib/featureFlags";

/**
 * F&B admin — menu / category / ingredient / recipe / stock-in / stocktake / staff. P8a STUB.
 * Self-gates on FEATURES.fnbModule; while OFF (default) it redirects home. The real admin tabs
 * land in P8c (inventory tabs additionally gate on FEATURES.fnbInventory; writes go through the
 * owner-only admin RPCs). Ships dark.
 */
export default function FnbAdmin() {
  if (!FEATURES.fnbModule) return <Navigate to="/" replace />;
  return <div className="p-6 text-sm text-muted-foreground">F&amp;B · Quản trị — đang phát triển (P8c).</div>;
}
