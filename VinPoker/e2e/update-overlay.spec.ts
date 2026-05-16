import { test, expect } from "@playwright/test";

/**
 * Verifies the branded <UpdateOverlay/> appears when a service-worker update
 * is being applied, and that the page is then reloaded.
 *
 * We can't easily install a real waiting service worker in a test, so we
 * exercise the same code paths the app uses:
 *   1. Dispatch the `vinpoker:applying-update` custom event that
 *      `applyUpdate()` and `forceHardRefresh()` fire — this is what the
 *      <UpdateOverlay/> listens for.
 *   2. Stub `window.location.reload` and trigger `applyUpdate()` from
 *      `@/lib/registerSW`. With no waiting SW, that helper clears caches
 *      then calls `reload()`, which is the same final step that runs after
 *      `controllerchange` fires in the real flow.
 */
test.describe("PWA update flow", () => {
  test("shows UpdateOverlay when update event fires", async ({ page }) => {
    await page.goto("/");

    // Wait for React to mount (boot-splash removes itself after mount).
    await page.waitForFunction(
      () => !document.getElementById("boot-splash"),
      null,
      { timeout: 15_000 },
    );

    // Sanity: overlay should not be visible yet.
    await expect(
      page.getByText("Đang cập nhật phiên bản mới..."),
    ).toHaveCount(0);

    // Fire the same event the real update flow dispatches.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("vinpoker:applying-update"));
    });

    // Overlay should appear with branded copy.
    const overlay = page.getByText("Đang cập nhật phiên bản mới...");
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // The VinBacker logo SVG should be inside the overlay region.
    const logo = page.getByRole("status").getByLabel("VinBacker");
    await expect(logo).toBeVisible();
  });

  test("applyUpdate triggers a page reload when no SW is waiting", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => !document.getElementById("boot-splash"),
      null,
      { timeout: 15_000 },
    );

    // Stub reload + replace so we can detect the reload attempt without
    // actually navigating away (which would tear down the test context).
    await page.evaluate(() => {
      (window as unknown as { __reloadCalled?: boolean }).__reloadCalled = false;
      const orig = window.location.reload.bind(window.location);
      Object.defineProperty(window.location, "reload", {
        configurable: true,
        value: () => {
          (window as unknown as { __reloadCalled?: boolean }).__reloadCalled =
            true;
        },
      });
      // keep ref so it isn't GC'd
      (window as unknown as { __origReload?: typeof orig }).__origReload = orig;
    });

    // Call the real applyUpdate() helper. Without a waiting worker it
    // performs cache-clear + reload (the post-controllerchange path).
    await page.evaluate(async () => {
      const mod = await import("/src/lib/registerSW.ts");
      mod.applyUpdate();
    });

    // Overlay should appear (applyUpdate also dispatches the event).
    await expect(
      page.getByText("Đang cập nhật phiên bản mới..."),
    ).toBeVisible({ timeout: 5_000 });

    // And reload must have been invoked.
    await page.waitForFunction(
      () =>
        (window as unknown as { __reloadCalled?: boolean }).__reloadCalled ===
        true,
      null,
      { timeout: 5_000 },
    );
  });
});
