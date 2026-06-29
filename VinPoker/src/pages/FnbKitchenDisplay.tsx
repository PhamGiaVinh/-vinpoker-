import { Navigate } from "react-router-dom";
import { FEATURES } from "@/lib/featureFlags";

/**
 * F&B Kitchen Display — live PAID tickets (Supabase Realtime). P8a FOUNDATION STUB; ships dark.
 * Chrome-less full-screen route (no Layout nav), like /tv. Self-gates on FEATURES.fnbModule +
 * fnbKitchen; while OFF (default) it redirects home and subscribes to nothing. The real realtime
 * display (channel on fnb_orders/fnb_order_items, SHIPPED tap) lands in P8b.
 */
export default function FnbKitchenDisplay() {
  if (!FEATURES.fnbModule || !FEATURES.fnbKitchen) return <Navigate to="/" replace />;
  return <div className="p-6 text-sm text-muted-foreground">F&amp;B · Bếp — đang phát triển (P8b).</div>;
}
