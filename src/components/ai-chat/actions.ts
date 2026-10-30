/**
 * Translation of the writes proposed by the assistant into schedule language.
 * A confirmation request must read without knowing the tool names or the
 * shape of their arguments: it is on this sentence that the user commits
 * a change to their schedule.
 *
 * Pure module: labels come from the `aiChat.actions` catalog, through the
 * translator the screen passes (`useTranslations("aiChat.actions")`), and
 * dates follow the interface language (`intlTag`).
 */
import { hasDyn, tDyn } from "@/i18n/dynamic";

// i18n-dynamic: aiChat.actions.tools.*
// i18n-dynamic: aiChat.actions.fields.*
// i18n-dynamic: aiChat.actions.values.*
// i18n-dynamic: aiChat.actions.boolean.*

/** Translator scoped to `aiChat.actions` (the one from `useTranslations`). */
export type ActionsTranslator = Parameters<typeof tDyn>[0];

/** Schedule writes named in plain words (key `tools.<camelCaseName>`), in the imperative and without jargon. */
const NAMED_TOOLS = new Set(["create-task", "update-task", "delete-task", "move-task", "copy-task", "create-project", "update-project"]);

/** "create-task" → "createTask": a tool name becomes a key segment. */
const segment = (name: string) => name.replace(/[-_]+([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * Technical identifiers: as is, they tell the user nothing.
 * They are resolved into labels (task title, name of the project, of the
 * people…) by the confirmation screen, and shown first, in this order.
 * Label: `fields.<key>`.
 */
export const RESOLVED_FIELDS: { key: string }[] = [
  { key: "taskId" },
  { key: "projectId" },
  { key: "userIds" },
  { key: "statusId" },
  { key: "placeId" },
  { key: "resourceId" },
  { key: "ownerId" },
  { key: "groupId" },
  { key: "businessUnitId" },
];

const TECHNICAL_FIELDS = new Set(RESOLVED_FIELDS.map((field) => field.key));

/** Fields named in plain words (`fields.<key>`); the others keep their technical name, capitalized. */
const NAMED_FIELDS = new Set([
  "title",
  "notes",
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "duration",
  "name",
  "color",
  "description",
  "businessNumber",
  "status",
  "budgetTime",
  "budgetAmount",
  "deliveryDate",
  "address",
]);

/** Enum values as they read in the application (`values.<value>`). */
const ENUM_VALUES = new Set(["todo", "in_progress", "done", "archived"]);

export const toolLabel = (t: ActionsTranslator, name: string, description?: string) =>
  // i18n-ignore dynamic message key
  NAMED_TOOLS.has(name) ? tDyn(t, `tools.${segment(name)}`) : (description ?? name.replace(/[-_]/g, " "));

function formatValue(t: ActionsTranslator, intlTag: string, value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return tDyn(t, value ? "boolean.yes" : "boolean.no");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (ENUM_VALUES.has(value) && hasDyn(t, `values.${value}`)) return tDyn(t, `values.${value}`);
    // ISO date: rendered in the interface language format rather than the machine one
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
      if (!Number.isNaN(date.getTime())) {
        return new Intl.DateTimeFormat(intlTag, {
          dateStyle: "short",
          ...(value.includes("T") ? { timeStyle: "short" as const } : {}),
        }).format(date);
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => formatValue(t, intlTag, v)).join(", ");
  return JSON.stringify(value);
}

/** The identifiers to resolve in a proposed write, by kind. */
export function idsToResolve(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== "object") return {};
  const values = input as Record<string, unknown>;
  const ids: Record<string, string[]> = {};
  for (const { key } of RESOLVED_FIELDS) {
    const value = values[key];
    const list = Array.isArray(value) ? value : value ? [value] : [];
    const clean = list.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (clean.length) ids[key] = clean;
  }
  return ids;
}

/**
 * Readable summary of a proposed write: its heading, then the objects
 * involved (identifiers resolved into labels), then the values the
 * assistant wants to set. The raw JSON stays in the collapsible detail.
 *
 * @param texts    `aiChat.actions` translator and Intl tag of the language.
 * @param resolve  label of each identifier (`resolve(key, id)`), or
 *                 undefined while it is not known.
 */
export function summarizeAction(
  texts: { t: ActionsTranslator; intlTag: string },
  name: string,
  input: unknown,
  description?: string,
  resolve?: (key: string, id: string) => string | undefined,
): { title: string; lines: { label: string; value: string }[] } {
  const { t, intlTag } = texts;
  const title = toolLabel(t, name, description);
  if (!input || typeof input !== "object") return { title, lines: [] };

  const ids = idsToResolve(input);
  const resolved = RESOLVED_FIELDS.filter(({ key }) => ids[key]?.length).map(({ key }) => ({
    label: tDyn(t, `fields.${key}`),
    value: ids[key]!.map((id) => resolve?.(key, id) ?? "…").join(", "),
  }));

  const lines = Object.entries(input as Record<string, unknown>)
    .filter(
      ([key, value]) =>
        !TECHNICAL_FIELDS.has(key) && value !== null && value !== undefined && value !== "",
    )
    .map(([key, value]) => ({
      label: NAMED_FIELDS.has(key) ? tDyn(t, `fields.${key}`) : key.charAt(0).toUpperCase() + key.slice(1),
      value: formatValue(t, intlTag, value),
    }));

  return { title, lines: [...resolved, ...lines] };
}
