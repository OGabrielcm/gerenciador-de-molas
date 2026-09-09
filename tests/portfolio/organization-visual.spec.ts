import { test, expect } from "@playwright/test";
import { installFixture } from "./fixtures";
const out = process.env.PORTFOLIO_SHOTS;
test.skip(!out, "Manual visual capture, opt in with PORTFOLIO_SHOTS");
for (const theme of ["dark", "light", "sepia"]) {
  test(`organization visual ${theme}`, async ({ context, page }) => {
    await installFixture(context, { theme, completed: true });
    for (const [device, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await expect(page.locator('[data-track="area-0"]')).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: `${out}/kanban-${theme}-${device}.png`,
        fullPage: true,
      });
      await page.locator('[data-track="area-0"] [data-col="done"]').scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: "Arquivar concluídos: Estudos", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: `${out}/kanban-confirmar-${theme}-${device}.png`,
      });
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
  });
}
