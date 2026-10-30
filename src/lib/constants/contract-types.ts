/**
 * Contract types available for a user.
 * Stored in the DB by value (e.g. "interimaire"), displayed via the message
 * key `users.contractTypes.<key>` (translated at render time).
 *
 * Employee = "regular" staff, no specific display on the schedule.
 * All other types are shown in brackets after the name.
 */
// i18n-dynamic: users.contractTypes.*
export const CONTRACT_TYPES = [
  { value: "salarie", key: "employee" },
  { value: "interimaire", key: "temporary" },
  { value: "sous-traitant", key: "subcontractor" },
  { value: "alternant", key: "workStudy" },
  { value: "stagiaire", key: "intern" },
  { value: "independant", key: "freelance" },
] as const;

export type ContractTypeValue = typeof CONTRACT_TYPES[number]["value"];
/** Key under `users.contractTypes`. */
export type ContractTypeKey = typeof CONTRACT_TYPES[number]["key"];

/**
 * Translation of a `users.contractTypes.<key>` key, for example
 * `(key) => tDyn(tUsers, \`contractTypes.${key}\`)` with `tUsers = useTranslations("users")`.
 */
export type ContractLabelTranslator = (key: ContractTypeKey) => string;

const CONTRACT_KEY_MAP = new Map<string, ContractTypeKey>(
  CONTRACT_TYPES.map((c) => [c.value, c.key]),
);

/** Message key of a contract type, or null if unknown / empty. */
export function getContractKey(value?: string | null): ContractTypeKey | null {
  if (!value) return null;
  return CONTRACT_KEY_MAP.get(value) ?? null;
}

/** Label of a contract type in the UI language, or null if unknown / empty. */
export function getContractLabel(value: string | null | undefined, translate: ContractLabelTranslator): string | null {
  const key = getContractKey(value);
  return key ? translate(key) : null;
}

/**
 * Label to append (in brackets) after a user's name on the schedule.
 * Empty contract or "salarie" → null (nothing to append).
 */
export function getContractSuffix(value: string | null | undefined, translate: ContractLabelTranslator): string | null {
  if (!value || value === "salarie") return null;
  return getContractLabel(value, translate);
}
