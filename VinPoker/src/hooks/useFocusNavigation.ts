import { useState, useCallback, useRef } from "react";

export function useFocusNavigation() {
  const [focusedTableId, setFocusedTableId] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusTable = useCallback((tableId: string) => {
    if (!tableId) return;

    // Clear previous timeout
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setFocusedTableId(tableId);

    // Scroll to element
    const el = document.getElementById(`table-card-${tableId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // Auto-clear after 3 seconds
    timeoutRef.current = setTimeout(() => {
      setFocusedTableId(null);
      timeoutRef.current = null;
    }, 3000);
  }, []);

  const clearFocus = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setFocusedTableId(null);
  }, []);

  return { focusedTableId, focusTable, clearFocus };
}
