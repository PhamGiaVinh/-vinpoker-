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
  const html = buildPayrollPreviewHtml(rows, clubName, monthLabel, singleDealerId);

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
    container.style.color = "#151a17";
    container.style.fontFamily = "Arial, Helvetica, sans-serif";
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
        const y = 10;
        let remaining = imgHeight;
        let position = 0;
        while (remaining > 0) {
          pdf.addImage(imgData, "PNG", 10, y - position, imgWidth, imgHeight);
          remaining -= pageHeight - 20;
          position += pageHeight - 20;
          if (remaining > 0) pdf.addPage();
        }
      }

      const period = monthLabel.replace(/[^0-9-]/g, "").slice(0, 16) || "ky-luong";
      const filename = singleDealerId
        ? `phieu-luong-tam-tinh-${period}-${singleDealerId}.pdf`
        : `bang-luong-tam-tinh-${period}.pdf`;
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

export function buildPayrollPreviewHtml(
  rows: DealerPayrollRow[],
  clubName: string,
  monthLabel: string,
  singleDealerId?: string
): string {
  const single = singleDealerId && rows[0] ? rows[0] : null;
  const title = single ? "PHIẾU LƯƠNG" : "BẢNG LƯƠNG";

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

  const singleIdentity = single ? `
    <section class="identity-grid">
      <div><span>Họ và tên</span><strong>${escapeHtml(single.full_name)}</strong></div>
      <div><span>Loại hợp đồng</span><strong>${single.employment_type === "full_time" ? "Toàn thời gian" : "Bán thời gian"}</strong></div>
      <div><span>Ngày công</span><strong>${single.total_shifts} ca</strong></div>
      <div><span>Tổng giờ</span><strong>${(single.total_hours ?? 0).toFixed(1)} giờ</strong></div>
    </section>
  ` : "";

  return `
    <style>
      .payroll-print { box-sizing: border-box; width: 800px; min-height: 1040px; padding: 42px; color: #172019; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.42; }
      .payroll-print * { box-sizing: border-box; color: inherit; }
      .payroll-brand { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #176b38; padding-bottom: 14px; }
      .payroll-brand__mark { color: #176b38; font-weight: 800; font-size: 22px; letter-spacing: .5px; }
      .payroll-brand__status { border: 1px solid #74a87f; color: #176b38; border-radius: 999px; padding: 5px 10px; font-size: 11px; font-weight: 700; }
      .payroll-title { margin: 28px 0 20px; text-align: center; }
      .payroll-title h1 { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 29px; letter-spacing: .5px; color: #121712; }
      .payroll-title p { margin: 5px 0 0; color: #58635a; font-size: 14px; }
      .identity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 34px; margin: 18px 0 22px; padding: 16px 18px; border: 1px solid #cbd4cd; border-radius: 4px; background: #fbfdfb; }
      .identity-grid div { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px dotted #d6ded8; padding-bottom: 5px; }
      .identity-grid span { color: #58635a; }
      .identity-grid strong { font-weight: 700; text-align: right; }
      .payroll-section { margin: 22px 0 9px; color: #176b38; font-family: Georgia, 'Times New Roman', serif; font-size: 19px; font-weight: 700; }
      .payroll-table { width: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; }
      .payroll-table th, .payroll-table td { border: 1px solid #b9c5bb; padding: 8px 7px; vertical-align: middle; color: #172019; font-size: 11px; }
      .payroll-table th { background: #155f32; color: #fff; font-weight: 700; text-align: center; }
      .payroll-table tr:nth-child(even) td { background: #f4f8f4; }
      .payroll-table td:first-child { font-weight: 600; }
      .payroll-table .right { text-align: right; font-variant-numeric: tabular-nums; }
      .payroll-total { display: flex; justify-content: flex-end; gap: 28px; margin-top: 0; border: 1px solid #b9c5bb; border-top: 0; padding: 12px 14px; background: #eaf5ec; color: #155f32; font-weight: 800; font-size: 16px; }
      .payroll-note { margin-top: 28px; border-top: 1px solid #aebbb1; padding-top: 10px; color: #6b746d; font-size: 10px; }
      .payroll-draft { color: #ad7812; font-weight: 700; }
    </style>
    <article class="payroll-print">
      <header class="payroll-brand">
        <div class="payroll-brand__mark">VINPOKER</div>
        <div class="payroll-brand__status">BẢN TẠM TÍNH</div>
      </header>
      <div class="payroll-title">
        <h1>${title}</h1>
        <p>${escapeHtml(clubName)} · ${escapeHtml(monthLabel)}</p>
      </div>
      ${singleIdentity}
      <h2 class="payroll-section">I. Thu nhập</h2>
      <table class="payroll-table">
      <thead>
        <tr>
          <th>Tên</th><th>Loại</th><th>Ca</th><th>Giờ</th><th>OT</th>
          <th>Thường</th><th>OT pay</th><th>Gộp</th><th>Điều chỉnh</th><th>Thực lãnh</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      </table>
      <div class="payroll-total"><span>TỔNG THỰC LÃNH</span><span>${formatVND(rows.reduce((total, row) => total + (row.net_pay_vnd ?? 0), 0))}</span></div>
      <footer class="payroll-note"><span class="payroll-draft">Tạm tính:</span> Bản này chỉ dùng để xem trước. Phiếu đã chốt bất biến được tạo qua luồng server.</footer>
    </article>
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
