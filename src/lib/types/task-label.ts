/** Task bar label format in the People planning view. */
export const TASK_LABEL_MODES = ["title", "project", "both"] as const;
export type TaskLabelMode = (typeof TASK_LABEL_MODES)[number];

export function isTaskLabelMode(value: unknown): value is TaskLabelMode {
  return typeof value === "string" && TASK_LABEL_MODES.some((mode) => mode === value);
}
