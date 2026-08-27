import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
];

for (const viewport of viewports) {
  test(`FT statement controls fit and remain actionable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/__dev/payroll-statement");
    const preview = page.getByTestId("payroll-statement-preview");
    await expect(preview).toBeVisible();
    await expect(page.getByText("HSOP · Tháng 08/2026")).toBeVisible();
    await expect(preview.getByText("PDF sẵn sàng", { exact: true }).first()).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Hành động phiếu lương Nguyễn Minh Anh" }).click();
    await expect(page.getByText("Xem bản nháp", { exact: true })).toBeVisible();
    await page.getByText("Xem bản nháp", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Bản nháp phiếu lương" })).toBeVisible();
    await expect(page.getByText("THỰC LĨNH", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Phiếu lương xem trực tiếp").getByText("17.726.250 đ", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Hành động phiếu lương Nguyễn Minh Anh" }).click();
    await page.getByText("Chốt phiếu", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Chốt phiếu lương FT?" })).toBeVisible();
    await expect(page.getByText("Sau khi chốt, phiếu trở thành bản ghi bất biến và không thể chỉnh sửa trực tiếp.")).toBeVisible();
    await page.getByRole("button", { name: "Chốt phiếu", exact: true }).click();
    await expect(page.getByTestId("payroll-row-11111111-1111-4111-8111-111111111111"))
      .toHaveAttribute("data-statement-status", "FINALIZED");
  });
}
