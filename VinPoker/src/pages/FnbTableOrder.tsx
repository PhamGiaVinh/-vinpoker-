import { Navigate } from "react-router-dom";
import { FEATURES } from "@/lib/featureFlags";

/**
 * F&B guest/server table ordering (flow A → PENDING). P8a FOUNDATION STUB; ships dark.
 * Chrome-less full-screen route (guest tablet), like /tv. Self-gates on FEATURES.fnbModule +
 * fnbCounter; while OFF (default) it redirects home. The real menu picker → fnb_create_order
 * lands in P8b.
 */
export default function FnbTableOrder() {
  if (!FEATURES.fnbModule || !FEATURES.fnbCounter) return <Navigate to="/" replace />;
  return <div className="p-6 text-sm text-muted-foreground">F&amp;B · Gọi món tại bàn — đang phát triển (P8b).</div>;
}
