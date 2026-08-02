import { useEffect } from "react";
import { RouteLoader } from "@/components/RouteLoader";

export function DocumentRedirect({ to }: { to: string }) {
  useEffect(() => {
    const target = new URL(to, window.location.origin);
    target.search = window.location.search;
    target.hash = window.location.hash;
    window.location.replace(target.toString());
  }, [to]);

  return <RouteLoader />;
}
