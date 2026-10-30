/** Calendar helpers of the demo (pure): ISO dates `YYYY-MM-DD`, computed in UTC. */

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

export function mondayOf(iso: string): string {
  return addDays(iso, -((dayOfWeek(iso) + 6) % 7));
}

/** Wall-clock date and time (`YYYY-MM-DD`, `HH:MM`) of an instant in a time zone. */
export function wallClock(at: Date, timeZone: string): { day: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Easter Sunday (anonymous Gregorian algorithm). */
function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** French public holidays of a year. */
export function frenchHolidays(year: number): { date: string; label: string }[] {
  const easter = easterSunday(year);
  return [
    { date: `${year}-01-01`, label: "Jour de l'an" },
    { date: addDays(easter, 1), label: "Lundi de Pâques" },
    { date: `${year}-05-01`, label: "Fête du Travail" },
    { date: `${year}-05-08`, label: "Victoire 1945" },
    { date: addDays(easter, 39), label: "Ascension" },
    { date: addDays(easter, 50), label: "Lundi de Pentecôte" },
    { date: `${year}-07-14`, label: "Fête nationale" },
    { date: `${year}-08-15`, label: "Assomption" },
    { date: `${year}-11-01`, label: "Toussaint" },
    { date: `${year}-11-11`, label: "Armistice 1918" },
    { date: `${year}-12-25`, label: "Noël" },
  ];
}
