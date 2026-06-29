// Vietnamese NAPAS bank BIN map for VietQR generation.
//
// VietQR (field 38 → 01 → 00) needs the 6-digit acquirer BIN, but platform_bank_accounts only
// stores a free-text bank_name. This map resolves common names → BIN as a Stage-1 / legacy
// fallback. For production the BIN should come from the EXPLICIT platform_bank_accounts.bank_bin
// column (Stage 2) — `normalizeBankNameToBin` must NEVER guess a BIN for a name it does not know
// exactly (a wrong BIN misroutes money), so an unknown name returns null → caller falls back to
// the static QR image.

export interface VnBank {
  bin: string;
  shortName: string;
  aliases: string[];
}

// Major banks a poker club is likely to use. BINs per NAPAS / VietQR bank list.
export const VN_BANKS: VnBank[] = [
  { bin: "970422", shortName: "MB", aliases: ["MBBank", "MB Bank", "MB", "Ngân hàng Quân Đội", "Quân Đội", "NH Quân Đội"] },
  { bin: "970436", shortName: "Vietcombank", aliases: ["Vietcombank", "VCB", "Ngân hàng Ngoại Thương"] },
  { bin: "970407", shortName: "Techcombank", aliases: ["Techcombank", "TCB"] },
  { bin: "970415", shortName: "VietinBank", aliases: ["VietinBank", "CTG", "Vietin", "Công Thương"] },
  { bin: "970418", shortName: "BIDV", aliases: ["BIDV", "Đầu Tư và Phát Triển"] },
  { bin: "970416", shortName: "ACB", aliases: ["ACB", "Á Châu"] },
  { bin: "970432", shortName: "VPBank", aliases: ["VPBank", "VPB", "Việt Nam Thịnh Vượng"] },
  { bin: "970403", shortName: "Sacombank", aliases: ["Sacombank", "STB"] },
  { bin: "970423", shortName: "TPBank", aliases: ["TPBank", "TPB", "Tiên Phong"] },
  { bin: "970441", shortName: "VIB", aliases: ["VIB", "Quốc Tế"] },
  { bin: "970405", shortName: "Agribank", aliases: ["Agribank", "Nông Nghiệp", "AGR"] },
  { bin: "970443", shortName: "SHB", aliases: ["SHB", "Sài Gòn Hà Nội"] },
  { bin: "970437", shortName: "HDBank", aliases: ["HDBank", "HDB"] },
  { bin: "970448", shortName: "OCB", aliases: ["OCB", "Phương Đông"] },
  { bin: "970426", shortName: "MSB", aliases: ["MSB", "Hàng Hải", "Maritime"] },
  { bin: "970431", shortName: "Eximbank", aliases: ["Eximbank", "EIB", "Xuất Nhập Khẩu"] },
  { bin: "970440", shortName: "SeABank", aliases: ["SeABank", "SEAB", "Đông Nam Á"] },
  { bin: "970428", shortName: "NamABank", aliases: ["Nam A Bank", "NamABank", "NAB", "Nam Á"] },
];

/** Strip case, Vietnamese diacritics, đ/Đ, spaces and punctuation → a squashed comparison key. */
export function normalizeBankKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .replace(/[đĐ]/g, "d") // đ / Đ (not decomposed by NFD)
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

const BIN_BY_KEY: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const bank of VN_BANKS) {
    for (const name of [bank.shortName, ...bank.aliases]) {
      map.set(normalizeBankKey(name), bank.bin);
    }
  }
  return map;
})();

/**
 * Resolve a free-text bank name to its 6-digit BIN, or null if not recognised exactly.
 * EXACT normalized match only — no fuzzy/substring matching (a wrong BIN misroutes money).
 */
export function normalizeBankNameToBin(bankName: string | null | undefined): string | null {
  if (!bankName) return null;
  return BIN_BY_KEY.get(normalizeBankKey(bankName)) ?? null;
}
