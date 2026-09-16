/** Only normalizes known scanner wrappers; free-text names and bank codes stay unchanged. */
export function normalizeCashierScan(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("{")) {
    try {
      const payload = JSON.parse(value) as Record<string, unknown>;
      for (const key of ["registration_id", "receipt_code", "member_card_id", "user_id"]) {
        if (typeof payload[key] === "string" && payload[key].trim()) return payload[key].trim();
      }
    } catch { /* Keep a malformed scan visible for manual correction. */ }
  }
  try {
    const url = new URL(value);
    for (const key of ["registration_id", "receipt_code", "member_card_id", "user_id", "card"]) {
      const part = url.searchParams.get(key)?.trim();
      if (part) return part;
    }
    const tail = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(tail) || /^VINREG[A-Z0-9]{8}$/i.test(tail)) return tail;
  } catch { /* Free text is not a URL. */ }
  return value;
}
