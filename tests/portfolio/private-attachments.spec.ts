import { expect, test } from "@playwright/test";
import { installFixture } from "./fixtures";
test("private attachments use signed links and keep failed removals visible", async ({
  context,
  page,
}) => {
  await installFixture(context);
  await context.route("**/rest/v1/attachments**", (r) =>
    r.fulfill({
      json: [
        {
          id: "attachment-1",
          task_id: "task-1",
          path: "task-1/fake.pdf",
          name: "QA private.pdf",
          mime: "application/pdf",
          size_bytes: 5,
          created_at: "2026-09-10T12:00:00Z",
        },
      ],
    }),
  );
  await context.route("**/storage/v1/object/sign/attachments/**", (r) =>
    r.fulfill({ json: { signedURL: "/object/sign/attachments/task-1/fake.pdf?token=fixture" } }),
  );
  await context.route("**/storage/v1/object/attachments", (r) =>
    r.fulfill({ status: 503, json: { message: "Controlled failure" } }),
  );
  await page.goto("/");
  await page.getByText("Preparar demonstração do projeto", { exact: true }).click();
  await page.getByRole("button", { name: /^5Anexos/ }).click();
  await expect(page.getByRole("link", { name: "QA private.pdf", exact: true })).toHaveAttribute(
    "href",
    /object\/sign\/attachments/,
  );
  await expect(page.locator('a[href*="object/public/attachments"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Remover anexo", exact: true }).click();
  await expect(
    page.getByText("Não foi possível remover o arquivo. Tente novamente.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "QA private.pdf", exact: true })).toBeVisible();
});
