import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  storage: { createSignedUrl: vi.fn(), upload: vi.fn(), remove: vi.fn() },
  from: vi.fn(),
}));
vi.mock("./supabase", () => ({
  supabase: { storage: { from: () => mocks.storage }, from: mocks.from },
}));
import { attachmentSignedUrl, addAttachment, deleteAttachment } from "./attachments-service";
import type { Attachment } from "./kanban-types";
beforeEach(() => vi.resetAllMocks());
it("requests an authorized short-lived URL and never fabricates a public path", async () => {
  mocks.storage.createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://example.test/signed" },
    error: null,
  });
  expect(await attachmentSignedUrl("card/fake.pdf")).toBe("https://example.test/signed");
  expect(mocks.storage.createSignedUrl).toHaveBeenCalledWith("card/fake.pdf", 300);
  mocks.storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: "denied" } });
  await expect(attachmentSignedUrl("foreign/fake.pdf")).rejects.toThrow();
});
it("surfaces upload failure without recording false success", async () => {
  const set = vi.fn();
  mocks.storage.upload.mockResolvedValue({ error: { message: "offline" } });
  await expect(
    addAttachment(set, "user", "card", {
      name: "fake.pdf",
      type: "application/pdf",
      size: 5,
    } as File),
  ).rejects.toThrow();
  expect(set).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});
it("keeps the row visible when Storage removal fails", async () => {
  const set = vi.fn();
  mocks.storage.remove.mockResolvedValue({ error: { message: "offline" } });
  await expect(
    deleteAttachment(set, { id: "a", task_id: "card", path: "card/fake.pdf" } as Attachment),
  ).rejects.toThrow();
  expect(set).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});
it("keeps the row visible when metadata deletion fails after removing the object", async () => {
  const set = vi.fn();
  mocks.storage.remove.mockResolvedValue({ error: null });
  mocks.from.mockReturnValue({
    delete: () => ({
      eq: () => ({ select: async () => ({ data: null, error: { message: "offline" } }) }),
    }),
  });
  await expect(
    deleteAttachment(set, { id: "a", task_id: "card", path: "card/fake.pdf" } as Attachment),
  ).rejects.toThrow();
  expect(set).not.toHaveBeenCalled();
});
