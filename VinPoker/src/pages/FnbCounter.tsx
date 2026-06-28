import { Navigate } from "react-router-dom";
import { FEATURES } from "@/lib/featureFlags";

/**
 * F&B counter (quầy) — order intake (flow B) + take payment. P8a FOUNDATION STUB.
 * Self-gates on FEATURES.fnbModule + fnbCounter; while OFF (default) it redirects home so the
 * route exists but reveals nothing and queries no data. The real counter UI (order list, pending
 * queue, payment dialog → fnb_mark_paid) lands in P8b after the finance shape is finalised at P6.
 * Ships dark.
 */
export default function FnbCounter() {
  if (!FEATURES.fnbModule || !FEATURES.fnbCounter) return <Navigate to="/" replace />;
  return <div className="p-6 text-sm text-muted-foreground">F&amp;B · Quầy — đang phát triển (P8b).</div>;
}
