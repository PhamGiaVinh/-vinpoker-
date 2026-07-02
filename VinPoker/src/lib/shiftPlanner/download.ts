// Dealer Shift Planner — tiny browser-download helper for exported schedule PNGs.

/** Trigger a browser download of a data URL (e.g. "lich-ngay-02-07.png"). */
export function downloadDataUrl(filename: string, dataUrl: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
