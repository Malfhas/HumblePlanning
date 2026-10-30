import { getConfigValues } from "./config-service";

/** Read active EMAIL notification triggers from config. Empty/absent = all allowed (permissive default). */
export async function getActiveTriggers(): Promise<string[]> {
  const config = await getConfigValues(["EMAIL_NOTIFICATION_TRIGGERS"]);
  const raw = config.EMAIL_NOTIFICATION_TRIGGERS;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Read active SMS / WhatsApp notification triggers. Empty/absent = all allowed. */
export async function getActiveSmsTriggers(): Promise<string[]> {
  const config = await getConfigValues(["SMS_NOTIFICATION_TRIGGERS"]);
  const raw = config.SMS_NOTIFICATION_TRIGGERS;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Check if a trigger is active. Empty triggers list = all active (permissive). */
export function isTriggerActive(triggers: string[], trigger: string): boolean {
  return triggers.length === 0 || triggers.includes(trigger);
}

/** Mapping task field → trigger event key */
export const TASK_FIELD_TO_TRIGGER: Record<string, string> = {
  title: "task_title_changed",
  startDate: "task_dates_changed",
  endDate: "task_dates_changed",
  startTime: "task_times_changed",
  endTime: "task_times_changed",
  statusId: "task_status_changed",
  projectId: "task_project_changed",
  notes: "task_notes_changed",
};

/** Determine which triggers were activated by a task update */
export function getTriggersFromTaskChanges(oldTask: Record<string, unknown>, newTask: Record<string, unknown>): string[] {
  const triggers = new Set<string>();
  for (const [field, trigger] of Object.entries(TASK_FIELD_TO_TRIGGER)) {
    if (oldTask[field] !== newTask[field]) triggers.add(trigger);
  }
  return Array.from(triggers);
}
