import { test, expect } from "@playwright/test";
import { installFixture } from "./fixtures";

test("move area, preserve its task, and restore order after reload", async ({ context, page }) => {
  await installFixture(context);
  await page.goto("/");
  await page.getByRole("button", { name: "Mover área para baixo: Estudos", exact: true }).click();
  await expect(page.locator("[data-track]").first()).toHaveAttribute("data-track", "area-1");
  await expect(page.locator('[data-track="area-0"]')).toContainText(
    "Preparar demonstração do projeto",
  );
  await page.reload();
  await expect(page.locator("[data-track]").first()).toHaveAttribute("data-track", "area-1");
  await page
    .getByRole("button", { name: "Arrastar área: Estudos", exact: true })
    .dragTo(page.locator('[data-track="area-1"]'));
  await expect(page.locator("[data-track]").first()).toHaveAttribute("data-track", "area-0");
});

test("failed reorder leaves old order and offers recovery", async ({ context, page }) => {
  await installFixture(context);
  await context.route("**/rpc/reorder_areas", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ message: "test conflict" }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Mover área para baixo: Estudos", exact: true }).click();
  await expect(page.getByText(/Não foi possível salvar/)).toBeVisible();
  await expect(page.locator("[data-track]").first()).toHaveAttribute("data-track", "area-0");
});

test("archive is confirmed, keeps its timestamp, and can be undone", async ({ context, page }) => {
  const fixture = await installFixture(context, { completed: true });
  const original = fixture.tasks.find((row) => row.id === "done-1")!.updated_at;
  await page.goto("/");
  await page.getByRole("button", { name: "Arquivar concluídos: Estudos", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("incluindo os ocultos por filtros");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByText("Concluído de demonstração", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Arquivar concluídos: Estudos", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Arquivar concluídos", exact: true })
    .click();
  await expect(page.getByText("Concluído de demonstração", { exact: true })).toHaveCount(0);
  expect(fixture.tasks.find((row) => row.id === "done-1")!.updated_at).toBe(original);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.getByText("Concluído de demonstração", { exact: true })).toBeVisible();
});
