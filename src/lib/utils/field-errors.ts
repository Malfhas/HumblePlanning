/**
 * Per-field form errors returned by the API.
 *
 * The server throws `new AppError(code, { fields: { username: { code: … } } })`;
 * the response carries `{ error, code, fields: { username: "<translated message>" } }`,
 * relayed on the client by `ApiClientError.fields`.
 *
 * Usage in a form:
 * ```tsx
 * const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
 *
 * mutation.mutate(data, {
 *   onError: (err) => setFieldErrors(parseFieldErrors(err)),
 * });
 *
 * // On each field:
 * <div className={fieldErrors.email ? "field-error" : ""}>
 *   <Label>Email</Label>
 *   <Input onChange={() => clearFieldError(setFieldErrors, "email")} />
 *   {fieldErrors.email && <p className="text-xs text-destructive mt-1">{fieldErrors.email}</p>}
 * </div>
 * ```
 */

type FieldErrorMap = Record<string, string>;

/**
 * Returns `{ field: message }` for EACH field in error, from `fields`
 * (messages already translated by the server, independent of the client language).
 * Pass the error itself (`ApiClientError`), not `err.message`.
 *
 * If no field is designated, returns an empty object (the error will be
 * shown globally by the form).
 */
export function parseFieldErrors(error: object | null | undefined): FieldErrorMap {
  const fields: FieldErrorMap = {};
  const source = error && "fields" in error ? error.fields : null;
  if (source && typeof source === "object") {
    for (const [field, msg] of Object.entries(source as Record<string, unknown>)) {
      if (typeof msg === "string") fields[field] = msg;
    }
  }
  return fields;
}

/**
 * React helper: clears a field's error when the user starts
 * editing it.
 */
export function clearFieldError(
  setFieldErrors: React.Dispatch<React.SetStateAction<FieldErrorMap>>,
  field: string
) {
  setFieldErrors((prev) => {
    if (!prev[field]) return prev;
    const next = { ...prev };
    delete next[field];
    return next;
  });
}

// ─── Zod issues → field errors ──────────────────────────────────────────

/**
 * Converts the Zod issues returned by the API (on a 422, `details`) into a
 * `{ field → message }` map usable by forms. The default Zod messages
 * (English, technical) are replaced by `validation.zod.<code>`.
 */
interface ZodIssueLike {
  path?: (string | number)[];
  code?: string;
  message?: string;
  format?: string;
}

// i18n-dynamic: validation.zod.*
/**
 * `translate`: translation of a full `validation.zod.<code>` key, for
 * example `(key) => (hasDyn(t, key) ? tDyn(t, key) : null)` with
 * `t = useTranslations()`; returns `null` if the key does not exist (falls back
 * to `validation.zod.invalid`).
 */
export function zodIssuesToFieldErrors(
  issues: unknown,
  translate: (key: string) => string | null,
): FieldErrorMap {
  if (!Array.isArray(issues)) return {};
  const result: FieldErrorMap = {};
  for (const issue of issues as ZodIssueLike[]) {
    const field = issue.path?.[0];
    if (typeof field !== "string") continue;
    const key = issue.format || issue.code || "";
    result[field] = translate(`validation.zod.${key || "invalid"}`) ?? translate("validation.zod.invalid") ?? issue.message ?? "";
  }
  return result;
}
