const STATUS_ORDER = [
  "PENDING",
  "LEASED",
  "COMPLETED",
  "SKIPPED",
  "DEAD_LETTER",
];

export function renderDashboard({ status, traceId = "", trace = null }) {
  const counts = status.counts ?? {};
  const heartbeat = status.heartbeats?.[0];
  const switches = status.kill_switches ?? [];
  const traceRows = trace?.events ?? [];

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>VBacker Automation DEV</title>
  <style>
    :root {
      color-scheme: dark;
      --ink: #070b09;
      --panel: #0d1511;
      --panel-2: #111c16;
      --line: #244332;
      --muted: #92a198;
      --paper: #edf5ef;
      --green: #42ee78;
      --green-deep: #163b24;
      --amber: #e8bd5d;
      --red: #ff746d;
      --cyan: #6fd9d1;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--ink);
      color: var(--paper);
      font-family: "Segoe UI", system-ui, sans-serif;
      line-height: 1.45;
    }
    a { color: inherit; }
    button, input, select {
      font: inherit;
    }
    .shell {
      width: min(1440px, calc(100% - 32px));
      margin: 0 auto;
      padding: 24px 0 48px;
    }
    .topline, .section-head, .metric-row, .event-rail, .trace-row {
      display: flex;
      align-items: center;
    }
    .topline {
      justify-content: space-between;
      gap: 20px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }
    .brand {
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
      font-size: 14px;
    }
    .brand span { color: var(--green); }
    .badges {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }
    .badge {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .04em;
    }
    .badge.safe { color: var(--green); border-color: #277443; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(320px, .6fr);
      gap: 22px;
      padding: 42px 0 24px;
    }
    h1 {
      margin: 0;
      max-width: 800px;
      font-size: clamp(36px, 5vw, 72px);
      line-height: .98;
      letter-spacing: -.045em;
    }
    .lede {
      max-width: 720px;
      margin: 20px 0 0;
      color: var(--muted);
      font-size: 18px;
    }
    .guardrail {
      border-left: 3px solid var(--green);
      padding: 18px 20px;
      background: var(--panel);
      align-self: end;
    }
    .guardrail strong {
      display: block;
      color: var(--green);
      margin-bottom: 6px;
    }
    .guardrail p { margin: 0; color: var(--muted); }
    .metric-row {
      align-items: stretch;
      border: 1px solid var(--line);
      background: var(--panel);
    }
    .metric {
      flex: 1 1 0;
      min-width: 0;
      padding: 22px;
      border-right: 1px solid var(--line);
    }
    .metric:last-child { border-right: 0; }
    .metric .label {
      color: var(--muted);
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .metric .value {
      margin-top: 8px;
      font-size: clamp(24px, 3vw, 42px);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    section {
      min-width: 0;
      margin-top: 24px;
      border: 1px solid var(--line);
      background: var(--panel);
    }
    .section-head {
      justify-content: space-between;
      gap: 16px;
      padding: 18px 20px;
      border-bottom: 1px solid var(--line);
    }
    h2 { margin: 0; font-size: 18px; }
    .eyebrow {
      color: var(--green);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .event-rail {
      align-items: stretch;
      overflow-x: auto;
    }
    .rail-step {
      position: relative;
      flex: 1 0 170px;
      padding: 22px 20px 24px;
      border-right: 1px solid var(--line);
    }
    .rail-step:last-child { border-right: 0; }
    .rail-step b {
      display: block;
      margin: 5px 0 8px;
      font-size: 16px;
    }
    .rail-step small { color: var(--muted); }
    .rail-step .count {
      display: block;
      color: var(--green);
      font-size: 28px;
      font-weight: 800;
      line-height: 1;
      margin-bottom: 8px;
    }
    .rail-step small { display: block; }
    .grid {
      display: grid;
      grid-template-columns: 1.15fr .85fr;
      gap: 24px;
      min-width: 0;
    }
    .grid > section { min-width: 0; }
    .table-wrap { width: 100%; max-width: 100%; overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      padding: 13px 16px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      white-space: nowrap;
    }
    th {
      color: var(--muted);
      font-size: 11px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    tr:last-child td { border-bottom: 0; }
    .state-on { color: var(--red); font-weight: 800; }
    .state-off { color: var(--green); font-weight: 800; }
    .trace-form {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      padding: 18px 20px;
    }
    input {
      width: 100%;
      min-width: 0;
      border: 1px solid var(--line);
      background: #070b09;
      color: var(--paper);
      padding: 12px 14px;
      outline: none;
    }
    input:focus-visible { border-color: var(--green); box-shadow: 0 0 0 3px #42ee7828; }
    button {
      border: 1px solid var(--green);
      background: var(--green);
      color: #061008;
      padding: 12px 18px;
      font-weight: 800;
      cursor: pointer;
    }
    button:focus-visible { outline: 3px solid #edf5ef; outline-offset: 2px; }
    .trace-list { border-top: 1px solid var(--line); }
    .trace-row {
      display: grid;
      grid-template-columns: 130px minmax(220px, 1fr) 150px 120px;
      gap: 12px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--line);
    }
    .trace-row:last-child { border-bottom: 0; }
    .trace-row code { color: var(--cyan); overflow-wrap: anywhere; }
    .empty { padding: 26px 20px; color: var(--muted); }
    .footer {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      margin-top: 28px;
      color: var(--muted);
      font-size: 12px;
    }
    @media (max-width: 860px) {
      .hero, .grid { grid-template-columns: 1fr; }
      .metric-row { display: grid; grid-template-columns: 1fr 1fr; }
      .metric { border-bottom: 1px solid var(--line); }
      .metric:nth-child(2) { border-right: 0; }
      .trace-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 520px) {
      .shell { width: min(100% - 20px, 1440px); padding-top: 14px; }
      .topline { align-items: flex-start; flex-direction: column; }
      .badges { justify-content: flex-start; }
      .hero { padding-top: 30px; }
      .metric-row { grid-template-columns: 1fr; }
      .metric { border-right: 0; }
      .trace-form { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topline">
      <div class="brand">VBacker <span>/ Automation DEV</span></div>
      <div class="badges">
        <span class="badge safe">LOCAL FIXTURE</span>
        <span class="badge">P0: SERVER-NATIVE</span>
        <span class="badge">EXTERNAL SEND: OFF</span>
      </div>
    </header>

    <div class="hero">
      <div>
        <div class="eyebrow">Bảng điều khiển ca trực</div>
        <h1>Một đường đi rõ ràng cho từng sự kiện.</h1>
        <p class="lede">Gateway local mô phỏng claim, lease, artifact và durable enqueue. Không có provider thật, không dùng dữ liệu thật và không thay đổi VinPoker đang vận hành.</p>
      </div>
      <aside class="guardrail">
        <strong>Ranh giới đang bật</strong>
        <p>n8n chỉ điều phối. Gateway quyết định allowlist, recipient giả lập, idempotency và kill switch.</p>
      </aside>
    </div>

    <div class="metric-row" aria-label="Chỉ số vận hành">
      ${metric("Backlog", status.backlog_count, "event đang chờ hoặc có lease")}
      ${metric("Tuổi event cũ nhất", formatDuration(status.oldest_event_age_seconds), "tính từ available_at")}
      ${metric("Dead-letter", status.dead_letter_count, "cần operator xem")}
      ${metric("Heartbeat", heartbeat ? formatAgo(heartbeat.last_seen_at) : "Chưa có", heartbeat ? escapeHtml(heartbeat.worker_id) : "worker chưa claim")}
    </div>

    <section>
      <div class="section-head">
        <div>
          <div class="eyebrow">Event rail</div>
          <h2>Server schedule → durable enqueue</h2>
        </div>
        <span class="badge">${escapeHtml(status.environment)}</span>
      </div>
      <div class="event-rail">
        ${railStep("01", "Outbox", counts.PENDING ?? 0, "Event fixture chờ claim")}
        ${railStep("02", "Lease", counts.LEASED ?? 0, "Token 90 giây, stale worker bị chặn")}
        ${railStep("03", "Artifact", status.artifact_count ?? 0, "Snapshot deterministic đã validate")}
        ${railStep("04", "Enqueue", status.notification_count ?? 0, "notification_id đã ghi bền vững")}
        ${railStep("05", "Complete", counts.COMPLETED ?? 0, "n8n dừng chờ provider")}
      </div>
    </section>

    <div class="grid">
      <section>
        <div class="section-head">
          <div>
            <div class="eyebrow">Trạng thái queue</div>
            <h2>Không che giấu ngoại lệ</h2>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Trạng thái</th><th>Số lượng</th><th>Ý nghĩa</th></tr></thead>
            <tbody>
              ${STATUS_ORDER.map((name) => `<tr><td>${name}</td><td>${counts[name] ?? 0}</td><td>${statusMeaning(name)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div class="section-head">
          <div>
            <div class="eyebrow">Gateway guardrail</div>
            <h2>Kill switch đang áp dụng</h2>
          </div>
        </div>
        ${switches.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Phạm vi</th><th>Khóa</th><th>Trạng thái</th></tr></thead>
            <tbody>${switches.map((item) => `<tr><td>${escapeHtml(item.scope)}</td><td>${escapeHtml(item.scope_key)}</td><td class="${item.enabled ? "state-on" : "state-off"}">${item.enabled ? "ĐANG CHẶN" : "MỞ"}</td></tr>`).join("")}</tbody>
          </table></div>` : `<div class="empty">Chưa có kill switch nào được bật trong fixture.</div>`}
      </section>
    </div>

    <section>
      <div class="section-head">
        <div>
          <div class="eyebrow">Trace lookup</div>
          <h2>Theo một event từ đầu đến cuối</h2>
        </div>
      </div>
      <form class="trace-form" method="get" action="/dashboard">
        <label>
          <span class="sr-only"></span>
          <input name="trace" value="${escapeHtml(traceId)}" placeholder="event_id hoặc correlation_id" maxlength="180" autocomplete="off">
        </label>
        <button type="submit">Mở trace</button>
      </form>
      ${traceId ? renderTrace(traceRows) : `<div class="empty">Nhập event ID hoặc correlation ID của fixture để xem lịch sử.</div>`}
    </section>

    <footer class="footer">
      <span>DEV LOCAL · FIXTURE · KHÔNG PHẢI LIVE</span>
      <span>Tự làm mới mỗi 30 giây · Không có external send</span>
    </footer>
  </main>
</body>
</html>`;
}

function metric(label, value, note) {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><div class="label">${escapeHtml(note)}</div></div>`;
}

function railStep(number, label, count, note) {
  return `<div class="rail-step"><span class="eyebrow">${number}</span><b>${escapeHtml(label)}</b><span class="count">${escapeHtml(count)}</span><small>${escapeHtml(note)}</small></div>`;
}

function renderTrace(rows) {
  if (!rows.length) return `<div class="empty">Không tìm thấy event phù hợp trong fixture local.</div>`;
  return `<div class="trace-list">${rows.map((row) => `
    <div class="trace-row">
      <strong>${escapeHtml(row.status)}</strong>
      <code>${escapeHtml(row.event_id)}</code>
      <span>${escapeHtml(row.event_type)}</span>
      <span>attempt ${escapeHtml(row.attempt)}</span>
    </div>`).join("")}</div>`;
}

function statusMeaning(status) {
  return {
    PENDING: "Chờ worker claim",
    LEASED: "Đang được một worker xử lý",
    COMPLETED: "Đã enqueue bền vững",
    SKIPPED: "Hết hạn hoặc không còn hữu ích",
    DEAD_LETTER: "Không retry tiếp, cần kiểm tra",
  }[status] ?? "";
}

function formatDuration(seconds) {
  const value = Number(seconds ?? 0);
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

function formatAgo(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  return seconds < 60 ? `${seconds}s trước` : `${Math.floor(seconds / 60)}m trước`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
