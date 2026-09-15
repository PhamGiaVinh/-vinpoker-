import { useEffect, useState } from "react";

export function useDealerTabletLandscape() {
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1000px) and (orientation: landscape)");
    const update = () => setLandscape(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return landscape;
}
