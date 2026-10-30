/**
 * Application errors with a stable code (isomorphic: no Next dependency).
 *
 * A code is a message key (`tasks.errors.notFound`, `errors.forbidden`).
 * It is translated server-side by `handleApiError` into the request language;
 * the client receives `{ error, code, params?, fields? }`.
 *
 *   throw new AppError("tasks.errors.notFound");
 *   throw new AppError("tasks.errors.dailyLimitReached", { params: { limit: 3, day } });
 *   throw new AppError("users.errors.invalidFields", { status: 409, fields: {
 *     username: { code: "users.errors.loginAlreadyUsed" },
 *   } });
 */

export type ErrorParams = Record<string, string | number>;

export interface FieldErrorSpec {
  code: string;
  params?: ErrorParams;
}

/**
 * HTTP status derived from the LAST segment of the code. Avoids a central
 * registry (a source of conflicts between batches). An explicit status (`opts.status`) wins.
 */
const STATUS_BY_SUFFIX: [RegExp, number][] = [
  [/\.(unauthenticated|sessionExpired|invalidCredentials|wrongPassword|invalidApiKey)$/, 401],
  [/\.(forbidden|notAllowed|permissionRequired|readOnly|limitReached|outOfScope)$/, 403],
  [/\.notFound$/, 404],
  [/\.(alreadyUsed|alreadyExists|conflict|locked|inProgress|reused)$/, 409],
  [/\.(invalidData|policyFailed)$/, 422],
  [/\.rateLimited$/, 429],
  [/\.(disabled|unavailable)$/, 503],
];

export function statusFromCode(code: string): number {
  for (const [re, status] of STATUS_BY_SUFFIX) if (re.test(code)) return status;
  return 400;
}

/** True if the string looks like a message key (`ns.segment[.segment…]`). */
const MESSAGE_KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/;
export function isMessageKey(value: unknown): value is string {
  return typeof value === "string" && MESSAGE_KEY_RE.test(value);
}

export interface AppErrorOptions {
  params?: ErrorParams;
  status?: number;
  fields?: Record<string, FieldErrorSpec>;
  details?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly params?: ErrorParams;
  readonly status: number;
  readonly fields?: Record<string, FieldErrorSpec>;
  readonly details?: unknown;

  constructor(code: string, opts: AppErrorOptions = {}) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.params = opts.params;
    this.status = opts.status ?? statusFromCode(code);
    this.fields = opts.fields;
    this.details = opts.details;
  }
}
