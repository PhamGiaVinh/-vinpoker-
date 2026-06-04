import type { DealerPayrollRow } from "@/hooks/useDealerPayroll";

/**
 * Export payroll rows to PDF.
 * Uses html2canvas + jspdf if available; falls back to window.print() otherwise.
 */
export async function exportPayrollPdf(
  rows: DealerPayrollRow[],
  clubName: string,
  monthLabel: string,
  singleDealerId?: string
): Promise<void> {
  // Build printable HTML
  const html = buildPayrollHtml(rows, clubName, monthLabel, singleDealerId);

  try {
    // Dynamic import to keep bundle small
    const html2canvasMod = await import("html2canvas").catch(() => null);
    const jspdfMod = await import("jspdf").catch(() => null);

    if (!html2canvasMod || !jspdfMod) {
      throw new Error("html2canvas/jspdf not installed");
    }

    const html2canvas = html2canvasMod.default;
    const jsPDF = jspdfMod.jsPDF ?? jspdfMod.default;

    const container = document.createElement("div");
    container.innerHTML = html;
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "800px";
    container.style.background = "white";
    document.body.appendChild(container);

    try {
      const canvas = await html2canvas(container, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth - 20;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      if (imgHeight <= pageHeight - 20) {
        pdf.addImage(imgData, "PNG", 10, 10, imgWidth, imgHeight);
      } else {
        // Multi-page
        let y = 10;
        let remaining = imgHeight;
        let position = 0;
        while (remaining > 0) {
          pdf.addImage(imgData, "PNG", 10, y - position, imgWidth, imgHeight);
          remaining -= pageHeight - 20;
          position += pageHeight - 20;
          if (remaining > 0) pdf.addPage();
        }
      }

      const filename = singleDealerId
        ? `phieu-luong-${rows[0]?.full_name ?? "dealer"}-${monthLabel}.pdf`
        : `bang-luong-${clubName}-${monthLabel}.pdf`;
      pdf.save(filename);
    } finally {
      document.body.removeChild(container);
    }
  } catch {
    // Fallback: open print window
    const printWindow = window.open("", "_blank");
    if (!printWindow) throw new Error("Cannot open print window");
    printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Phiếu lương</title><style>
      body { font-family: system-ui, -apple-system, sans-serif; padding: 20px; color: #000; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #333; padding: 6px 8px; text-align: left; font-size: 12px; }
      th { background: #f0f0f0; font-weight: 600; }
      .right { text-align: right; }
      h1 { font-size: 18px; margin: 0; }
      .meta { color: #666; font-size: 12px; margin-top: 4px; }
    </style></head><body>${html}</body></html>`);
    printWindow.document.close();
    printWindow.print();
  }
}

function buildPayrollHtml(
  rows: DealerPayrollRow[],
  clubName: string,
  monthLabel: string,
  singleDealerId?: string
): string {
  const title = singleDealerId && rows[0]
    ? `Phiếu lương — ${rows[0].full_name}`
    : `Bảng lương — ${clubName} — ${monthLabel}`;

  const rowsHtml = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.full_name)}</td>
      <td>${r.employment_type === "full_time" ? "FT" : "PT"}</td>
      <td class="right">${r.total_shifts}</td>
      <td class="right">${(r.total_hours ?? 0).toFixed(1)}h</td>
      <td class="right">${(r.ot_hours ?? 0).toFixed(1)}h</td>
      <td class="right">${formatVND(r.regular_pay_vnd)}</td>
      <td class="right">${formatVND(r.ot_pay_vnd)}</td>
      <td class="right">${formatVND(r.gross_pay_vnd)}</td>
      <td class="right">${formatVND(r.total_adjustments_vnd)}</td>
      <td class="right"><strong>${formatVND(r.net_pay_vnd)}</strong></td>
    </tr>
  `).join("");

  return `
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">CLB: ${escapeHtml(clubName)} · Kỳ: ${escapeHtml(monthLabel)}</div>
    <table>
      <thead>
        <tr>
          <th>Tên</th><th>Loại</th><th>Ca</th><th>Giờ</th><th>OT</th>
          <th>Thường</th><th>OT pay</th><th>Gộp</th><th>Điều chỉnh</th><th>Thực lãnh</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function formatVND(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(n ?? 0) + " ₫";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c] ?? c);
}
