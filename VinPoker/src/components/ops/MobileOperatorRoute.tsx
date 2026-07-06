import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { FEATURES } from "@/lib/featureFlags";

/**
 * MobileOperatorRoute — device-aware wrapper for an operator surface. On phone-width viewports (and while
 * mobileOpsV2 is ON) it redirects to the mobile `/ops` UI; on desktop it renders the full desktop page.
 * This makes the VẬN HÀNH menu entries (Floor, …) "just work": tap on a phone → the mobile design, tap on
 * a computer → the desktop dashboard. Reuse for each operator page as its mobile version ships.
 *
 * The initial value is computed synchronously so a phone never flashes the heavy desktop page before the
 * redirect. Threshold 768px = phones only (tablets + desktop keep the desktop UI).
 */
const PHONE_MAX = 768;
const isPhoneNow = () => typeof window !== "undefined" && window.innerWidth < PHONE_MAX;

function usePhoneViewport() {
  const [phone, setPhone] = useState(isPhoneNow);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${PHONE_MAX - 1}px)`);
    const onChange = () => setPhone(isPhoneNow());
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return phone;
}

export function MobileOperatorRoute({ to, children }: { to: string; children: React.ReactNode }) {
  const phone = usePhoneViewport();
  if (phone && FEATURES.mobileOpsV2) return <Navigate to={to} replace />;
  return <>{children}</>;
}
