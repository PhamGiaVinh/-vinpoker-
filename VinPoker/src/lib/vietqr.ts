// Dynamic VietQR (NAPAS 24/7 / EMVCo) payload builder for tournament buy-in transfers.
//
// WHY: SePay auto-confirm matches a bank transfer to a registration by the UNIQUE reference_code
// in the transfer memo AND an exact amount equality (bt.amount == reg.total_pay). Today the
// customer types both by hand. A dynamic VietQR encodes bankBIN + account + amount + memo so the
// bank app pre-fills the transfer → near-100% correct auto-confirm. The QR is a *convenience
// pre-fill, NOT a lock*: settle + api_verified_at stay the sole source of truth; if a customer
// edits the amount/memo, settle flags a mismatch (safe). This module carries NO money authority.
//
// Built fully locally (no external API like img.vietqr.io) → no network, no third-party sees the
// account/amount/reference_code. Output is the raw EMVCo string; render it with <QRCodeSVG/>.
//
// EMVCo / VietQR field layout for a dynamic transfer-to-account QR (all values ASCII):
//   00 "01"                payload format indicator
//   01 "12"                point of initiation = dynamic (carries an amount); "11" = static
//   38 <nested>            merchant account info (NAPAS):
//        00 "A000000727"     NAPAS GUID
//        01 <nested>         beneficiary org: 00 = acquirer BIN (6 digits), 01 = account number
//        02 "QRIBFTTA"       service code = transfer to ACCOUNT (QRIBFTTC would be to-card)
//   53 "704"               currency = VND
//   54 <amount>            transaction amount (VND integer string by default)
//   58 "VN"                country
//   62 <nested>            additional data: 08 = purpose of transaction (the transfer memo)
//   63 <crc>               CRC-16/CCITT-FALSE over the whole payload INCLUDING the literal "6304"

/** Encode one EMVCo TLV element: 2-char id + 2-digit length + value. */
function tlv(id: string, value: string): string {
  const len = value.length;
  if (len > 99) throw new Error(`vietqr: TLV value too long for id ${id} (${len} > 99)`);
  return id + len.toString().padStart(2, "0") + value;
}

/**
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final XOR), uppercase 4 hex.
 * Inputs here are ASCII-only, so charCodeAt == byte value. The canonical catalog check value is
 * crc16ccitt("123456789") === "29B1" — the test asserts that as an independent anchor.
 */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export interface VietQrInput {
  /** Acquirer (bank) BIN — exactly 6 digits, e.g. "970422" for MB. */
  bin: string;
  /** Beneficiary account number — DIGITS as a string; leading zeros are preserved verbatim. */
  accountNumber: string;
  /** Transaction amount in VND — a positive integer (no minor unit). */
  amount: number;
  /** Transfer memo (purpose) — the reference_code; forced uppercase, ASCII [A-Z0-9-], ≤ 25 chars. */
  memo: string;
  /**
   * Field-54 decimal places. Default 0 (integer) — the Napas/VietQR standard for VND. The `2`
   * option (".00") is a DORMANT fallback kept only in case a specific bank app rejects integer;
   * do not use it unless a real scan proves a target bank needs it.
   */
  decimals?: 0 | 2;
}

/**
 * Build the EMVCo payload string for a dynamic VietQR transfer-to-account.
 * Throws on any invalid input (caller should try/catch and fall back to the static QR).
 */
export function buildVietQrPayload({ bin, accountNumber, amount, memo, decimals = 0 }: VietQrInput): string {
  if (!/^\d{6}$/.test(bin)) throw new Error("vietqr: bin must be exactly 6 digits");

  // Account number: string only, digits only, leading zeros preserved. NEVER Number() — a dropped
  // leading zero would route money to the wrong account.
  const acct = String(accountNumber).trim();
  if (!/^\d{4,19}$/.test(acct)) throw new Error("vietqr: accountNumber must be 4-19 digits");

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("vietqr: amount must be a positive integer (VND)");
  }

  // Memo: force uppercase + ASCII-only so it survives bank apps cleanly and matches SePay's
  // case-insensitive \y(VINREG…|REENTRY-?…)\y regex with unambiguous word boundaries.
  const cleanMemo = String(memo).trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,25}$/.test(cleanMemo)) {
    throw new Error("vietqr: memo must be 1-25 chars of [A-Z0-9-]");
  }

  const beneficiary = tlv("00", bin) + tlv("01", acct);
  const field38 = tlv("00", "A000000727") + tlv("01", beneficiary) + tlv("02", "QRIBFTTA");
  const field62 = tlv("08", cleanMemo);
  const amountStr = decimals === 2 ? amount.toFixed(2) : String(amount);

  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("38", field38) +
    tlv("53", "704") +
    tlv("54", amountStr) +
    tlv("58", "VN") +
    tlv("62", field62);

  // CRC is computed over the body PLUS the CRC tag header "6304" (id 63 + length 04), then appended.
  const toCrc = body + "6304";
  return toCrc + crc16ccitt(toCrc);
}
