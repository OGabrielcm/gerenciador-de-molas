# Area order and completed-card archive

## User behavior

- Drag an area's grip onto another area, or use Move up/Move down. Reordering uses the full list, so areas hidden by filters are preserved. The board and sidebar share the saved order.
- Archive completed applies to active Done cards in one area, including cards hidden by search/tag filters. The confirmation freezes their IDs; if eligibility changes before saving, the operation is rejected and the user is asked to reload.
- Cards remain Done. Titles, descriptions, attachments, comments and existing timestamps are not deleted or rewritten by archive/restore.
- Undo appears after manual archiving. Dashboards also offers Restore for archived cards.
- Restoring clears manual archiving and postpones automatic archiving for seven days. This deliberately uses a separate timestamp instead of falsifying completion or edit dates.

## Data contract

`202609090001_board_organization.sql` adds `done_at`, `manual_archived_at`, and `archive_snoozed_until` to tasks. Existing Done rows use their previous `updated_at` as a **legacy approximation** of completion; no historical completion time can be recovered from data that did not record it. Future transitions into Done set `done_at`; editing within Done preserves it. Leaving Done clears the archive lifecycle.

An archived card satisfies: `col = done` and either a manual archive timestamp exists, or the completion clock is older than seven days without an active restore grace period. Manual archive takes precedence over grace. Existing cards without `done_at` retain the old fallback until migration.

## Atomic operations

- `reorder_areas(ordered_ids, expected_ids)`: the complete current per-user order must match the expected list. Duplicate, foreign or missing IDs are rejected.
- `archive_done_area(area_id, expected_ids)`: validates the full eligible selection and archives in one transaction.
- `restore_archived_tasks(task_ids)`: validates ownership and Done state before a single restore update.

Functions execute as the caller, retain RLS, explicitly scope by `auth.uid()`, use per-user transaction locks and have no anonymous execution grant. The UI keeps the previous state until success and blocks overlapping organization operations. The full Supabase schema and any preexisting triggers must be checked in the target environment before rollout.

## Verification and rollout

Apply the migration only to a disposable/local or approved test environment first. The shipped `tests/integration/local-baseline.sql` is a **test-only reconstruction** of the legacy schema from documentation and migrations, not a production bootstrap. SQL assertions in `tests/integration/organization.sql` cover ordering, stale requests, ownership, atomic rejection, related-row retention and timestamps. Browser fixtures validate interface behavior separately from real API integration.

No production migration, remote commit, merge or deploy is authorized by this implementation task. Keep frontend and schema rollout coordinated: the new buttons require the RPCs and columns. Missing migration results in an error, not a silent local-only save.

Run `npm run test:database` with Docker available for a repeatable disposable PostgreSQL check. It uses no host network and removes its own test container afterward. The auth identity helper is a test-only substitute; it is not evidence of real Supabase Auth.
