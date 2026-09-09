import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures";

test.beforeEach(async ({ context }) => {
  await installFixture(context);
});

test("busca vazia oferece recuperação sem sugerir criar outra área", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Preparar demonstração do projeto", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Buscar tarefas…" }).fill("inexistente");
  await expect(page.getByRole("status")).toContainText("Nenhuma tarefa encontrada");
  await expect(page.getByRole("button", { name: "Nova área", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Limpar busca e filtros" }).click();
  await expect(page.getByRole("textbox", { name: "Buscar tarefas…" })).toHaveValue("");
  await expect(page.getByText("Preparar demonstração do projeto", { exact: true })).toBeVisible();
});

test("menu mobile tem controles acessíveis e fecha com Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Abrir navegação" });
  await expect(toggle).toBeVisible();
  await expect(page.locator("#main-navigation")).toBeHidden();
  await toggle.click();
  await expect(page.locator("#main-navigation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fechar navegação" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#main-navigation")).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.getByRole("button", { name: "Criar", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("configurar colunas não recolhe a área e criação continua disponível", async ({ page }) => {
  await page.goto("/");
  const lane = page.locator('[data-track="area-0"]');
  const collapse = lane.getByRole("button", { name: /^Estudos 1 card/ });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await lane.getByRole("button", { name: "Colunas: Estudos", exact: true }).click();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await collapse.click();
  await expect(lane.locator('[data-col="todo"]')).toHaveCount(0);
  await collapse.click();
  await expect(lane.locator('[data-col="todo"]')).toBeVisible();
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Adicionar card" })).toBeVisible();
  await page.locator("form input").first().fill("Tarefa fictícia de revisão");
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText("Tarefa fictícia de revisão", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Tarefa fictícia de revisão", { exact: true })).toBeVisible();
});
