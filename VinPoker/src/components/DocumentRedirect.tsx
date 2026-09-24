import { useEffect } from "react";
import { RouteLoader } from "@/components/RouteLoader";

export function DocumentRedirect({ to, preserveCurrentLocation = true }: { to: string; preserveCurrentLocation?: boolean }) {
  useEffect(() => {
    const target = new URL(to, window.location.origin);
    if (preserveCurrentLocation) {
      target.search = window.location.search;
      target.hash = window.location.hash;
    }
    window.location.replace(target.toString());
  }, [to, preserveCurrentLocation]);

  return <RouteLoader />;
}
