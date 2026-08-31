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
    container.style.fontFamily = "'Times New Roman', Times, serif";
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
      @page { size: A4; margin: 0; }
      body { margin: 0; font-family: 'Times New Roman', Times, serif; color: #000; }
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
  const single = singleDealerId ? rows.find((row) => row.dealer_id === singleDealerId) ?? null : null;
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

  const singleIncomeRows = single ? [
    ["Lương cơ bản", "—", single.base_salary_vnd],
    ["Thu nhập theo giờ", `${(single.total_hours ?? 0).toFixed(1)} giờ`, single.regular_pay_vnd],
    ["Tăng ca", `${(single.ot_hours ?? 0).toFixed(1)} giờ`, single.ot_pay_vnd],
    ["Điều chỉnh", "Theo quyết định kỳ lương", single.total_adjustments_vnd],
  ].filter(([, , amount]) => amount !== 0) : [];

  const singleIncomeTable = single ? `
    <table class="payroll-table payroll-table--single">
      <thead><tr><th>Khoản mục</th><th>Số lượng / cách tính</th><th>Thành tiền (đ)</th></tr></thead>
      <tbody>
        ${singleIncomeRows.length
          ? singleIncomeRows.map(([label, detail, amount]) => `<tr><td>${label}</td><td>${detail}</td><td class="right">${formatVND(amount as number)}</td></tr>`).join("")
          : '<tr><td colspan="3" class="empty">Chưa có khoản thu nhập trong kỳ này.</td></tr>'}
      </tbody>
    </table>
    <div class="payroll-total"><span>TỔNG THU NHẬP</span><span>${formatVND(single.gross_pay_vnd)}</span></div>
  ` : "";

  const multiIncomeTable = !single ? `
    <table class="payroll-table payroll-table--summary">
      <thead>
        <tr>
          <th>Tên</th><th>Loại</th><th>Ca</th><th>Giờ</th><th>OT</th>
          <th>Thường</th><th>OT pay</th><th>Gộp</th><th>Điều chỉnh</th><th>Thực lãnh</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="payroll-total"><span>TỔNG THỰC LÃNH</span><span>${formatVND(rows.reduce((total, row) => total + (row.net_pay_vnd ?? 0), 0))}</span></div>
  ` : "";

  return `
    <style>
      @page { size: A4; margin: 0; }
      html, body { min-height: 100%; margin: 0; background: #e3e8e3; }
      .payroll-print { box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 15mm 14mm 13mm; color: #151b16; background: #fff; border: 1px solid #d6ded8; font-family: "Times New Roman", Times, serif; font-size: 12px; line-height: 1.42; box-shadow: 0 10px 28px rgba(22, 42, 29, .16); }
      .payroll-print * { box-sizing: border-box; color: inherit; }
      .payroll-brand { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #176b38; padding-bottom: 11px; }
      .payroll-brand__lockup { display: flex; align-items: center; gap: 8px; }
      .payroll-brand__mark { position: relative; display: grid; width: 31px; height: 36px; place-items: center; color: #132119; font-family: Georgia, "Times New Roman", serif; font-size: 36px; line-height: 1; }
      .payroll-brand__mark i { position: absolute; top: 9px; left: 13px; width: 7px; height: 12px; border-radius: 100% 0 100% 0; background: #168343; transform: rotate(-42deg); }
      .payroll-brand__wordmark { color: #152c1c; font-family: Arial, Helvetica, sans-serif; font-size: 21px; font-weight: 800; letter-spacing: .035em; }
      .payroll-brand__wordmark b { color: #237643; }
      .payroll-brand__status { border: 1px solid #5fa473; border-radius: 14px; padding: 5px 10px; color: #176b38; font-family: Arial, Helvetica, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: .02em; }
      .payroll-title { margin: 22px 0 18px; text-align: center; }
      .payroll-title h1 { margin: 0; font-family: "Times New Roman", Times, serif; font-size: 29px; letter-spacing: 0; color: #101510; }
      .payroll-title p { margin: 3px 0 0; color: #3d4a40; font-size: 15px; }
      .payroll-title::after { display: block; width: 145px; height: 2px; margin: 7px auto 0; background: #176b38; content: ""; }
      .identity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 30px; margin: 18px 0 20px; padding: 14px 16px; border: 1px solid #c5d0c7; background: #fff; }
      .identity-grid div { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px dotted #cdd8d0; padding-bottom: 5px; }
      .identity-grid span { color: #263328; }
      .identity-grid strong { font-weight: 700; text-align: right; }
      .payroll-section { margin: 20px 0 8px; border-bottom: 1px solid #176b38; padding-bottom: 3px; color: #14572e; font-family: "Times New Roman", Times, serif; font-size: 19px; font-weight: 700; }
      .payroll-table { width: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; }
      .payroll-table th, .payroll-table td { border: 1px solid #b9c5bb; padding: 8px 7px; vertical-align: middle; color: #172019; font-size: 11px; }
      .payroll-table th { background: #155f32; color: #fff; font-weight: 700; text-align: center; }
      .payroll-table tr:nth-child(even) td { background: #f4f8f4; }
      .payroll-table td:first-child { font-weight: 600; }
      .payroll-table .right { text-align: right; font-variant-numeric: tabular-nums; }
      .payroll-table--single th:first-child { width: 45%; }
      .payroll-table--single th:nth-child(2) { width: 28%; }
      .payroll-table--single th:nth-child(3) { width: 27%; }
      .payroll-table--summary th, .payroll-table--summary td { padding: 6px 4px; font-size: 9px; }
      .payroll-table .empty { padding: 14px; text-align: center; color: #59675e; }
      .payroll-total { display: flex; justify-content: flex-end; gap: 28px; margin-top: 0; border: 1px solid #b9c5bb; border-top: 0; padding: 10px 14px; background: #eaf5ec; color: #155f32; font-weight: 800; font-size: 15px; }
      .payroll-net { display: flex; align-items: baseline; justify-content: space-between; gap: 18px; margin-top: 24px; border: 1.5px solid #176b38; padding: 14px 16px; background: #fbfefb; }
      .payroll-net span { color: #152119; font-size: 20px; font-weight: 700; }
      .payroll-net strong { color: #0d5429; font-size: 27px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .payroll-note { margin-top: 24px; border-top: 1px solid #aebbb1; padding-top: 10px; color: #5b675e; font-size: 10px; }
      .payroll-draft { color: #ad7812; font-weight: 700; }
      @media print { html, body { background: #fff; } .payroll-print { margin: 0; border: 0; box-shadow: none; } }
    </style>
    <article class="payroll-print">
      <header class="payroll-brand">
        <div class="payroll-brand__lockup" aria-label="VINPOKER">
          <span class="payroll-brand__mark" aria-hidden="true">♠<i></i></span>
          <span class="payroll-brand__wordmark"><b>VIN</b>POKER</span>
        </div>
        <div class="payroll-brand__status">BẢN TẠM TÍNH</div>
      </header>
      <div class="payroll-title">
        <h1>${title}</h1>
        <p>${escapeHtml(clubName)} · ${escapeHtml(monthLabel)}</p>
      </div>
      ${singleIdentity}
      <h2 class="payroll-section">I. Thu nhập</h2>
      ${singleIncomeTable || multiIncomeTable}
      ${single ? `<section class="payroll-net"><span>THỰC LĨNH</span><strong>${formatVND(single.net_pay_vnd)}</strong></section>` : ""}
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
