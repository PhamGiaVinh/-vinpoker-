// Series Intelligence — Forward layer PR2b: capture a DOM node to a PNG download (client-only DOM util).
//
// Dynamic-imports html2canvas (code-split — matches src/lib/exportPayrollPdf.ts). No new deps, no DB. Not
// unit-tested: jsdom cannot rasterize a canvas, so this is verified by owner UAT on the real PNG (consistent
// with exportPayrollPdf, which is likewise untested). The poster is rendered with hardcoded hex styles so
// html2canvas (which does not reliably resolve Tailwind theme tokens / oklch) produces a faithful image.

const POSTER_FELT = "#0B3D2E";

export async function captureNodeToPng(node: HTMLElement | null, filename: string): Promise<void> {
  if (!node) return;
  const mod = await import("html2canvas").catch(() => null);
  if (!mod) throw new Error("html2canvas not available");
  const html2canvas = mod.default;

  const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: POSTER_FELT });
  const dataUrl = canvas.toDataURL("image/png");

  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename.toLowerCase().endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
