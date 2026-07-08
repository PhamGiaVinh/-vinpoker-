import * as React from "react";

const KEY = "vinpoker.staff.selectedStaffId";

export function getSelectedStaffId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function setSelectedStaffId(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, id);
  window.dispatchEvent(new CustomEvent("staff:selected", { detail: id }));
}

export function useSelectedStaffId(): string | null {
  const [selected, setSelected] = React.useState<string | null>(() => getSelectedStaffId());

  React.useEffect(() => {
    const sync = () => setSelected(getSelectedStaffId());
    window.addEventListener("storage", sync);
    window.addEventListener("staff:selected", sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("staff:selected", sync as EventListener);
    };
  }, []);

  return selected;
}
