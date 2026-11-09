/**
 * Delete key on a task of the planning and the calendar: it follows the « Delete » item of the context menu.
 * Where the menu opens a dialog, the first press opens it; where the menu asks a second click, a first press
 * arms the deletion of the task under the cursor and a second press within the same delay confirms it.
 */

/** A task with several people: deleting it asks whom (dialog). */
export const isSharedTask = (task: { users?: readonly unknown[] | null } | null | undefined): boolean =>
  (task?.users?.length ?? 0) > 1;

/** An occurrence of a series: deleting it asks which ones (dialog). */
export const isRecurringTask = (task: { parentId?: string | null } | null | undefined): boolean => !!task?.parentId;

/**
 * The rule of the « Delete » item of the context menu, and of the delete key: a dialog follows (shared or
 * recurring task), so one action opens it; otherwise a second click or press confirms.
 */
export const deleteOpensDialog = (isMultiUser: boolean | undefined, isRecurring: boolean | undefined): boolean =>
  !!isMultiUser || !!isRecurring;

/** Time to press the key a second time (the « Delete » item of the context menu waits as long). */
export const DELETE_CONFIRM_MS = 2500;

/** Task whose deletion waits for the second press, and since when. */
export interface ArmedDelete {
  key: string;
  at: number;
}

export type DeletePress =
  | { action: "none" }
  | { action: "arm"; armed: ArmedDelete }
  | { action: "confirm"; key: string };

/**
 * Outcome of a press on the delete key with `targetKey` under the cursor: at once when a dialog follows
 * (`opensDialog`); confirm when the same task was armed less than `timeout` ago; else arm it (a new task, or
 * the delay is over). Nothing without a task.
 */
export function pressDelete(
  armed: ArmedDelete | null,
  targetKey: string | null,
  now: number,
  { opensDialog = false, timeout = DELETE_CONFIRM_MS }: { opensDialog?: boolean; timeout?: number } = {},
): DeletePress {
  if (!targetKey) return { action: "none" };
  if (opensDialog) return { action: "confirm", key: targetKey };
  if (armed && armed.key === targetKey && now - armed.at <= timeout) return { action: "confirm", key: targetKey };
  return { action: "arm", armed: { key: targetKey, at: now } };
}

/**
 * The delete key, pressed alone: Delete everywhere, and Backspace on a Mac, whose keyboard labels it
 * « delete » (Delete needs fn there). A held key repeats: only the first event counts, so that holding
 * it never confirms on its own.
 */
export function isDeleteKey(
  e: { key: string; repeat?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean },
  isMac: boolean,
): boolean {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  return e.key === "Delete" || (isMac && e.key === "Backspace");
}
