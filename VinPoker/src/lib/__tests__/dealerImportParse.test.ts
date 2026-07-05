import { describe, expect, it } from "vitest";
import {
  isNameLikeCell,
  cellsToFilteredText,
  MAX_SPREADSHEET_ROWS,
  MAX_DUMP_CHARS,
} from "@/lib/dealerImport/parseSpreadsheet";

describe("isNameLikeCell (P1-1 numeric-heavy filter)", () => {
  it("keeps Vietnamese names", () => {
    expect(isNameLikeCell("Nguyễn Văn A")).toBe(true);
    expect(isNameLikeCell("Trần Thị Bích Ngọc")).toBe(true);
    expect(isNameLikeCell("Lê Anh")).toBe(true);
  });
  it("drops phone / CCCD / dates / money / index cells", () => {
    expect(isNameLikeCell("0901234567")).toBe(false); // phone
    expect(isNameLikeCell("123456789")).toBe(false); // CCCD
    expect(isNameLikeCell("01/01/1990")).toBe(false); // date
    expect(isNameLikeCell("9.000.000")).toBe(false); // money
    expect(isNameLikeCell("1")).toBe(false); // STT
    expect(isNameLikeCell("")).toBe(false);
    expect(isNameLikeCell("   ")).toBe(false);
    expect(isNameLikeCell("-")).toBe(false);
  });
  it("drops name-with-embedded-long-number when digits dominate", () => {
    expect(isNameLikeCell("A 090123456789")).toBe(false); // digits > letters
    // but a name with a short suffix stays
    expect(isNameLikeCell("Nguyễn Văn A2")).toBe(true);
  });
});

describe("cellsToFilteredText", () => {
  it("keeps only name-like cells per row, drops empty rows", () => {
    const cells = [
      ["STT", "Họ tên", "SĐT", "CCCD"], // header row: "STT"/"SĐT"/"CCCD" are short/uppercase but letters≥2 → kept; that's fine, Gemini drops headers
      ["1", "Nguyễn Văn A", "0901234567", "123456789"],
      ["2", "Trần Thị B", "0987654321", "234567890"],
      ["", "", "", ""], // empty → skipped
      ["3", "Lê Văn C", "", ""],
    ];
    const { text, rowCount } = cellsToFilteredText(cells);
    const lines = text.split("\n");
    expect(text).toContain("Nguyễn Văn A");
    expect(text).toContain("Trần Thị B");
    expect(text).toContain("Lê Văn C");
    expect(text).not.toContain("0901234567"); // phone dropped
    expect(text).not.toContain("123456789"); // CCCD dropped
    expect(rowCount).toBeGreaterThanOrEqual(3);
    expect(lines.every((l) => l.length > 0)).toBe(true); // no empty lines
  });

  it("caps rows at MAX_SPREADSHEET_ROWS and flags truncated", () => {
    const many = Array.from({ length: MAX_SPREADSHEET_ROWS + 50 }, (_, i) => [`Người ${String.fromCharCode(65 + (i % 20))}`]);
    const { rowCount, truncated } = cellsToFilteredText(many);
    expect(rowCount).toBe(MAX_SPREADSHEET_ROWS);
    expect(truncated).toBe(true);
  });

  it("caps total chars at MAX_DUMP_CHARS", () => {
    const bigName = "Nguyễn " + "Văn".repeat(50); // ~150 chars, all letters
    const many = Array.from({ length: 2000 }, () => [bigName]);
    const { text, truncated } = cellsToFilteredText(many);
    expect(text.length).toBeLessThanOrEqual(MAX_DUMP_CHARS);
    expect(truncated).toBe(true);
  });
});
