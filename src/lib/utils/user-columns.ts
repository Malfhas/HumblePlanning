/**
 * Secret columns of the `users` table that must NEVER be returned by the API,
 * MCP or UI: TOTP secret, 2FA backup codes (and the last accepted TOTP step,
 * internal to them), iCal token (which grants access to the
 * `/api/export/ical?token=` feed without authentication).
 *
 * Pass as `columns` in Drizzle relational queries that load
 * users (`with: { users: { columns: USER_SECRET_COLUMNS_EXCLUDED } }`).
 * Routes that need these values (2FA, iCal) read them explicitly.
 */
export const USER_SECRET_COLUMNS_EXCLUDED = {
  twoFactorSecret: false,
  twoFactorBackupCodes: false,
  twoFactorLastStep: false,
  icalToken: false,
} as const;
