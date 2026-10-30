import { getConfigValues } from "./config-service";

/** Read active push notification triggers from config. Empty/absent = all allowed (permissive default). */
export async function getActivePushTriggers(): Promise<string[]> {
  const config = await getConfigValues(["PUSH_NOTIFICATION_TRIGGERS"]);
  const raw = config.PUSH_NOTIFICATION_TRIGGERS;
  if (!raw) return []; // empty = permissive (all pass)
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Check if a push trigger is active. Empty triggers list = all active (permissive). */
export function isPushTriggerActive(triggers: string[], trigger: string): boolean {
  return triggers.length === 0 || triggers.includes(trigger);
}
