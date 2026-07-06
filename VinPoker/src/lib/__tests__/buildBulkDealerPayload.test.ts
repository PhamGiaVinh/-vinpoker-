import { describe, expect, it } from "vitest";
import {
  normalizeName,
  dedupeKey,
  dedupeNames,
  buildBulkDealerRows,
} from "@/lib/dealerImport/buildBulkDealerPayload";

describe("normalizeName / dedupeKey (P1-2)", () => {
  it("trims + collapses whitespace, keeps diacritics", () => {
    expect(normalizeName("  Nguyễn   Văn  A ")).toBe("Nguyễn Văn A");
  });
  it("dedupeKey is trim+collapse+lowercase, keeps diacritics", () => {
    expect(dedupeKey("  NGUYỄN  Văn A ")).toBe("nguyễn văn a");
    expect(dedupeKey("Nguyễn Văn A")).toBe(dedupeKey("nguyễn   văn a"));
  });
});

describe("dedupeNames", () => {
  it("removes case-insensitive duplicates, keeps first casing + order", () => {
    expect(dedupeNames(["Lê Anh", "lê anh", "Trần B", "  Lê  Anh "])).toEqual(["Lê Anh", "Trần B"]);
  });
  it("drops blanks", () => {
    expect(dedupeNames(["", "  ", "An"])).toEqual(["An"]);
  });
});

describe("buildBulkDealerRows", () => {
  const clubId = "11111111-1111-1111-1111-111111111111";

  it("hard-codes tier B, status active, given club + today", () => {
    const rows = buildBulkDealerRows(["An", "Bình"], { clubId, employmentType: "part_time", today: "2026-07-05" });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.tier).toBe("B");
      expect(r.status).toBe("active");
      expect(r.club_id).toBe(clubId);
      expect(r.joined_date).toBe("2026-07-05");
      expect(r.phone).toBeNull();
      expect(r.notes).toBeNull();
      expect(r.hourly_rate_vnd).toBeNull();
      expect(r.base_rate_vnd).toBeNull();
    }
  });

  it("part-time: monthly_salary_vnd=0, shift fields null", () => {
    const [r] = buildBulkDealerRows(["An"], { clubId, employmentType: "part_time" });
    expect(r.employment_type).toBe("part_time");
    expect(r.monthly_salary_vnd).toBe(0);
    expect(r.standard_hours_per_shift).toBeNull();
    expect(r.ot_multiplier).toBeNull();
  });

  it("full-time: monthly_salary null (no fake salary), shift defaults 8 / 1.5", () => {
    const [r] = buildBulkDealerRows(["An"], { clubId, employmentType: "full_time" });
    expect(r.employment_type).toBe("full_time");
    expect(r.monthly_salary_vnd).toBeNull(); // owner sets real salary later
    expect(r.standard_hours_per_shift).toBe(8);
    expect(r.ot_multiplier).toBe(1.5);
  });

  it("dedupes + normalizes names before building rows", () => {
    const rows = buildBulkDealerRows(["  Lê Anh ", "lê anh", ""], { clubId, employmentType: "part_time" });
    expect(rows.map((r) => r.full_name)).toEqual(["Lê Anh"]);
  });
});

describe("buildBulkDealerRows — batch salary (owner 2026-07-06)", () => {
  const clubId = "11111111-1111-1111-1111-111111111111";

  it("PT: salaryVnd is the hourly rate → hourly_rate_vnd; monthly 0; base null", () => {
    const [r] = buildBulkDealerRows(["An"], { clubId, employmentType: "part_time", salaryVnd: 100000 });
    expect(r.hourly_rate_vnd).toBe(100000);
    expect(r.monthly_salary_vnd).toBe(0);
    expect(r.base_rate_vnd).toBeNull();
    expect(r.standard_hours_per_shift).toBeNull();
    expect(r.ot_multiplier).toBeNull();
  });

  it("FT: salaryVnd is monthly → monthly + base round(monthly/26) + hourly round(monthly/26/8)", () => {
    const [r] = buildBulkDealerRows(["An"], { clubId, employmentType: "full_time", salaryVnd: 9000000 });
    expect(r.monthly_salary_vnd).toBe(9000000);
    expect(r.base_rate_vnd).toBe(346154); // round(9000000/26)
    expect(r.hourly_rate_vnd).toBe(43269); // round(9000000/26/8)
    expect(r.standard_hours_per_shift).toBe(8);
    expect(r.ot_multiplier).toBe(1.5);
  });

  it("blank/zero/negative salary ⇒ pay fields null (PT monthly stays 0) — no fake salary", () => {
    const [pt] = buildBulkDealerRows(["An"], { clubId, employmentType: "part_time", salaryVnd: 0 });
    expect(pt.hourly_rate_vnd).toBeNull();
    expect(pt.monthly_salary_vnd).toBe(0);
    const [ft] = buildBulkDealerRows(["An"], { clubId, employmentType: "full_time", salaryVnd: -5 });
    expect(ft.monthly_salary_vnd).toBeNull();
    expect(ft.base_rate_vnd).toBeNull();
    expect(ft.hourly_rate_vnd).toBeNull();
  });

  it("rounds a fractional salaryVnd before use", () => {
    const [r] = buildBulkDealerRows(["An"], { clubId, employmentType: "part_time", salaryVnd: 100000.7 });
    expect(r.hourly_rate_vnd).toBe(100001);
  });
});
