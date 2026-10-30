/**
 * Chat dates, in the interface language: `intlTag` comes from
 * `useDateFormat()` ("fr-FR", "en-GB"). The time zone is the browser's,
 * like the rest of the application.
 */
const toDate = (value: string | Date) => (value instanceof Date ? value : new Date(value));

/** 07/09/2026 */
export const shortDate = (value: string | Date, intlTag: string) =>
  new Intl.DateTimeFormat(intlTag, { dateStyle: "short" }).format(toDate(value));

/** 07/09/2026 14:30: a timestamp. */
export const shortDateTime = (value: string | Date, intlTag: string) =>
  new Intl.DateTimeFormat(intlTag, { dateStyle: "short", timeStyle: "short" }).format(toDate(value));
