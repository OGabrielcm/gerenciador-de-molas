import { afterEach, describe, expect, it, vi } from "vitest";
import { isArchived, type Card } from "./kanban-types";
import { completionTransition } from "./archive-logic";
const now = "2026-09-09T12:00:00Z";
const card = { col: "done", updated_at: "2026-08-01T12:00:00Z" } as Card;
afterEach(() => vi.useRealTimers());
describe("archive lifecycle", () => {
  it("honors manual archive, while active columns are never archived", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    expect(
      isArchived({ ...card, manual_archived_at: now, archive_snoozed_until: "2026-10-01" }),
    ).toBe(true);
    expect(isArchived({ ...card, col: "todo", manual_archived_at: now })).toBe(false);
  });
  it("restoration postpones automatic archive without rewriting completion time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    expect(isArchived({ ...card, archive_snoozed_until: "2026-09-16T12:00:00Z" })).toBe(false);
    vi.setSystemTime(new Date("2026-09-16T12:00:01Z"));
    expect(isArchived({ ...card, archive_snoozed_until: "2026-09-16T12:00:00Z" })).toBe(true);
  });
  it("editing a done card does not reset the completion clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    expect(isArchived({ ...card, done_at: card.updated_at, updated_at: now })).toBe(true);
    expect(completionTransition(card, "done", now)).toEqual({});
  });
  it("moving out and back resets archive metadata on actual completion transitions", () => {
    expect(completionTransition(card, "todo", now)).toEqual({
      done_at: null,
      manual_archived_at: null,
      archive_snoozed_until: null,
    });
    expect(completionTransition({ ...card, col: "todo" }, "done", now).done_at).toBe(now);
  });
});
