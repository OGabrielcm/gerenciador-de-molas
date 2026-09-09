import type { Card } from "./kanban-types";

/** Completion is a transition, not a side effect of editing or archiving. */
export function completionTransition(
  before: Card | undefined,
  col: string | undefined,
  now: string,
): Partial<Card> {
  if (col === undefined || col === before?.col) return {};
  return {
    done_at: col === "done" ? now : null,
    manual_archived_at: null,
    archive_snoozed_until: null,
  };
}
