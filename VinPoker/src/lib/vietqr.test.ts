import { describe, it, expect } from "vitest";
import { buildVietQrPayload, crc16ccitt } from "./vietqr";
import { normalizeBankNameToBin, normalizeBankKey } from "./vietnamBanks";

/** Minimal TLV parser for assertions: id(2) + len(2) + value(len), repeated. */
function parseTlv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= s.length) {
    const id = s.slice(i, i + 2);
    const len = parseInt(s.slice(i + 2, i + 4), 10);
    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

/** Order-preserving TLV parse + full-consumption check (catches misframed length prefixes). */
function parseTlvSeq(s: string): { seq: Array<[string, string]>; consumedAll: boolean } {
  const seq: Array<[string, string]> = [];
  let i = 0;
  while (i + 4 <= s.length) {
    const id = s.slice(i, i + 2);
    const len = parseInt(s.slice(i + 2, i + 4), 10);
    seq.push([id, s.slice(i + 4, i + 4 + len)]);
    i += 4 + len;
  }
  return { seq, consumedAll: i === s.length };
}

// SePay's reference-code parser regex (sepay_parse_reference_code, migration 20261113000000) — the
// cross-module contract: a memo the builder emits must contain a token this matches, or auto-confirm
// silently fails. JS port of \y(VINREG[A-Z0-9]{8}|REENTRY-?[A-Z0-9]{8})\y, case-insensitive.
const SETTLE_RE = /\b(VINREG[A-Z0-9]{8}|REENTRY-?[A-Z0-9]{8})\b/i;

// Golden payload for a FIXED input {bin 970422, acct 0338356589, amount 550000, memo VINREG1A2BKXYZ}.
// The CRC (E16E) was cross-checked out-of-band by TWO independent CRC-16/CCITT-FALSE implementations
// (bit-shift + table-driven), both producing E16E — so this literal anchors the WHOLE output (field
// order, every TLV length, AND the crc) independently of the builder. A wrong CRC window or a
// reordered/misframed field breaks this exact match. (Catalog check 0x29B1 anchors the algorithm above.)
const GOLDEN =
  "00020101021238540010A00000072701240006970422011003383565890208QRIBFTTA530370454065500005802VN62180814VINREG1A2BKXYZ6304E16E";

describe("crc16ccitt", () => {
  it("matches the canonical CRC-16/CCITT-FALSE check value for '123456789'", () => {
    // 0x29B1 is the published catalog check value for CRC-16/CCITT-FALSE — an INDEPENDENT anchor,
    // not a self-generated number. If this passes, the algorithm (poly/init/no-reflect) is correct.
    expect(crc16ccitt("123456789")).toBe("29B1");
  });

  it("always returns 4 uppercase hex chars (zero-padded)", () => {
    expect(crc16ccitt("A")).toMatch(/^[0-9A-F]{4}$/);
    expect(crc16ccitt("")).toBe("FFFF"); // init value, no input
  });
});

describe("buildVietQrPayload — structure", () => {
  const payload = buildVietQrPayload({
    bin: "970422",
    accountNumber: "0338356589",
    amount: 550000,
    memo: "VINREG1A2BKXYZ",
  });
  const top = parseTlv(payload);

  it("sets format=01 and dynamic point-of-initiation=12", () => {
    expect(top["00"]).toBe("01");
    expect(top["01"]).toBe("12");
  });

  it("encodes NAPAS merchant account info (GUID + BIN + account + QRIBFTTA) in field 38", () => {
    const f38 = parseTlv(top["38"]);
    expect(f38["00"]).toBe("A000000727");
    expect(f38["02"]).toBe("QRIBFTTA");
    const beneficiary = parseTlv(f38["01"]);
    expect(beneficiary["00"]).toBe("970422"); // BIN
    expect(beneficiary["01"]).toBe("0338356589"); // account, leading zero preserved
  });

  it("sets currency=704 (VND), amount as integer, country=VN", () => {
    expect(top["53"]).toBe("704");
    expect(top["54"]).toBe("550000");
    expect(top["58"]).toBe("VN");
  });

  it("puts the memo in field 62 → 08", () => {
    const f62 = parseTlv(top["62"]);
    expect(f62["08"]).toBe("VINREG1A2BKXYZ");
  });

  it("appends a self-consistent CRC over body + '6304'", () => {
    const withoutCrc = payload.slice(0, -4); // body + the literal "6304" tag header
    expect(payload.slice(-8, -6)).toBe("63"); // CRC tag id
    expect(payload.slice(-6, -4)).toBe("04"); // CRC value length
    expect(payload.slice(-4)).toBe(crc16ccitt(withoutCrc));
  });
});

describe("buildVietQrPayload — REENTRY memo (longer, 16 chars)", () => {
  it("round-trips a REENTRY code in field 62 → 08 and matches the settle regex", () => {
    const payload = buildVietQrPayload({
      bin: "970422",
      accountNumber: "0338356589",
      amount: 1200000,
      memo: "REENTRY-1A2B3C4D",
    });
    const f62 = parseTlv(parseTlv(payload)["62"]);
    expect(f62["08"]).toBe("REENTRY-1A2B3C4D");
    // settle's parser: \y(VINREG[A-Z0-9]{8}|REENTRY-?[A-Z0-9]{8})\y (case-insensitive)
    expect(/\b(VINREG[A-Z0-9]{8}|REENTRY-?[A-Z0-9]{8})\b/.test(f62["08"])).toBe(true);
  });
});

describe("buildVietQrPayload — input hardening", () => {
  const base = { bin: "970422", accountNumber: "0338356589", amount: 550000, memo: "VINREG1A2BKXYZ" };

  it("preserves a leading-zero account number verbatim (never Number())", () => {
    const f38 = parseTlv(parseTlv(buildVietQrPayload({ ...base, accountNumber: "0012345678" }))["38"]);
    expect(parseTlv(f38["01"])["01"]).toBe("0012345678");
  });

  it("forces the memo to uppercase", () => {
    const f62 = parseTlv(parseTlv(buildVietQrPayload({ ...base, memo: "vinreg1a2bkxyz" }))["62"]);
    expect(f62["08"]).toBe("VINREG1A2BKXYZ");
  });

  it("throws on a BIN that is not exactly 6 digits", () => {
    expect(() => buildVietQrPayload({ ...base, bin: "97042" })).toThrow();
    expect(() => buildVietQrPayload({ ...base, bin: "9704221" })).toThrow();
    expect(() => buildVietQrPayload({ ...base, bin: "97042X" })).toThrow();
  });

  it("throws on a non-digit / empty account number", () => {
    expect(() => buildVietQrPayload({ ...base, accountNumber: "" })).toThrow();
    expect(() => buildVietQrPayload({ ...base, accountNumber: "12-34" })).toThrow();
  });

  it("throws on a non-positive / non-integer amount", () => {
    expect(() => buildVietQrPayload({ ...base, amount: 0 })).toThrow();
    expect(() => buildVietQrPayload({ ...base, amount: -100 })).toThrow();
    expect(() => buildVietQrPayload({ ...base, amount: 550000.5 })).toThrow();
    expect(() => buildVietQrPayload({ ...base, amount: NaN })).toThrow();
  });

  it("throws on a memo with illegal chars or > 25 length", () => {
    expect(() => buildVietQrPayload({ ...base, memo: "VINREG 1A2B" })).toThrow(); // space
    expect(() => buildVietQrPayload({ ...base, memo: "café123" })).toThrow(); // non-ASCII
    expect(() => buildVietQrPayload({ ...base, memo: "A".repeat(26) })).toThrow();
  });

  it("supports the dormant decimals=2 fallback for field 54", () => {
    const top = parseTlv(buildVietQrPayload({ ...base, decimals: 2 }));
    expect(top["54"]).toBe("550000.00");
  });
});

describe("normalizeBankNameToBin", () => {
  it("resolves MB variants to 970422", () => {
    for (const n of ["MB", "MBBank", "MB Bank", "mbbank", "Ngân hàng Quân Đội", "Quân Đội"]) {
      expect(normalizeBankNameToBin(n)).toBe("970422");
    }
  });

  it("resolves Vietcombank / VCB to 970436", () => {
    expect(normalizeBankNameToBin("Vietcombank")).toBe("970436");
    expect(normalizeBankNameToBin("VCB")).toBe("970436");
  });

  it("returns null for unknown / empty names (never a guessed BIN)", () => {
    expect(normalizeBankNameToBin("Some Random Bank")).toBeNull();
    expect(normalizeBankNameToBin("")).toBeNull();
    expect(normalizeBankNameToBin(null)).toBeNull();
    expect(normalizeBankNameToBin(undefined)).toBeNull();
  });

  it("normalizeBankKey strips case, diacritics, đ, spaces and punctuation", () => {
    expect(normalizeBankKey("Ngân hàng Quân Đội")).toBe("NGANHANGQUANDOI");
  });
});

describe("buildVietQrPayload — golden anchor + CRC integrity", () => {
  const FIXED = { bin: "970422", accountNumber: "0338356589", amount: 550000, memo: "VINREG1A2BKXYZ" };

  it("reproduces the independently-CRC-verified golden payload exactly", () => {
    expect(buildVietQrPayload(FIXED)).toBe(GOLDEN);
  });

  it("detects a corrupted payload — mutating one body byte changes the CRC", () => {
    const payload = buildVietQrPayload(FIXED);
    const goodCrc = payload.slice(-4);
    const body = payload.slice(0, -4); // body + the "6304" tag header
    const mutated = body.replace("550000", "550001"); // flip the amount
    expect(mutated).not.toBe(body);
    expect(crc16ccitt(mutated)).not.toBe(goodCrc);
  });
});

describe("memo ↔ SePay settle regex contract", () => {
  it("the bare reference_code the modal emits parses under the settle regex", () => {
    const top = parseTlv(buildVietQrPayload({ bin: "970422", accountNumber: "0338356589", amount: 550000, memo: "VINREG1A2BKXYZ" }));
    expect(SETTLE_RE.test(parseTlv(top["62"])["08"])).toBe(true);
  });

  it("every shape the real app generator produces (VINReg + 4 hex + 4 base36, uppercased) parses", () => {
    // mirrors tournament-register/index.ts:143 — refCode = "VINReg" + 4 hex(tour id) + 4 base36
    const hex = "0123456789ABCDEF";
    const b36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let k = 0; k < 200; k++) {
      let code = "VINREG";
      for (let i = 0; i < 4; i++) code += hex[(k * 7 + i) % 16];
      for (let i = 0; i < 4; i++) code += b36[(k * 13 + i) % 36];
      expect(SETTLE_RE.test(code)).toBe(true);
      expect(() => buildVietQrPayload({ bin: "970422", accountNumber: "0338356589", amount: 100000, memo: code })).not.toThrow();
    }
  });

  it("documents the asymmetry: the builder accepts memos the settle regex will NOT match (known-unmatched)", () => {
    // The builder is intentionally permissive ([A-Z0-9-]{1,25}); settle only parses VINREG+8 / REENTRY-?+8.
    // The APP never emits these (it always passes a real reference_code), but this pins the relationship so a
    // future regex/generator change can't silently break auto-match without a failing test.
    for (const bad of ["ABC123", "VINREG1A2BKXYZEXTRA", "VINREG-1A2B3C4D"]) {
      expect(() => buildVietQrPayload({ bin: "970422", accountNumber: "0338356589", amount: 100000, memo: bad })).not.toThrow();
      expect(SETTLE_RE.test(bad.toUpperCase())).toBe(false);
    }
  });
});

describe("buildVietQrPayload — TLV order, full consumption, length boundaries", () => {
  const FIXED = { bin: "970422", accountNumber: "0338356589", amount: 550000, memo: "VINREG1A2BKXYZ" };

  it("emits top-level fields in ascending TLV-ID order with CRC (63) last and no leftover bytes", () => {
    const { seq, consumedAll } = parseTlvSeq(buildVietQrPayload(FIXED));
    expect(consumedAll).toBe(true);
    expect(seq.map(([id]) => id)).toEqual(["00", "01", "38", "53", "54", "58", "62", "63"]);
  });

  it("field 38 children are 00 (GUID), 01 (beneficiary), 02 (service code) in order", () => {
    const { seq, consumedAll } = parseTlvSeq(parseTlv(buildVietQrPayload(FIXED))["38"]);
    expect(consumedAll).toBe(true);
    expect(seq.map(([id]) => id)).toEqual(["00", "01", "02"]);
  });

  it("frames a 10-char and a 25-char (max) memo correctly (08-length prefix tracks memo length)", () => {
    for (const memo of ["VINREG1234", "A".repeat(25)]) {
      const payload = buildVietQrPayload({ bin: "970422", accountNumber: "0338356589", amount: 100000, memo });
      expect(parseTlvSeq(payload).consumedAll).toBe(true); // full consumption catches any misframe
      const f62 = parseTlv(payload)["62"]; // = "08" + 2-digit length + memo
      expect(f62.slice(0, 4)).toBe("08" + String(memo.length).padStart(2, "0"));
      expect(parseTlv(f62)["08"]).toBe(memo);
    }
  });

  it("frames a 19-digit (max) account without overflowing the field-38 TLV cap", () => {
    const payload = buildVietQrPayload({ bin: "970422", accountNumber: "0123456789012345678", amount: 100000, memo: "VINREG1A2BKXYZ" });
    expect(parseTlvSeq(payload).consumedAll).toBe(true);
    expect(parseTlv(parseTlv(parseTlv(payload)["38"])["01"])["01"]).toBe("0123456789012345678");
  });

  it("decimals=2 fallback pins the field-54 length prefix (5409550000.00)", () => {
    const payload = buildVietQrPayload({ ...FIXED, decimals: 2 });
    expect(payload).toContain("5409550000.00");
    expect(parseTlvSeq(payload).consumedAll).toBe(true);
  });
});
