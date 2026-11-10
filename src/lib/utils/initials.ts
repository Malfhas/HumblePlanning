/** What follows a name without being part of it: "(Alternant)", "[Intérimaire]"… */
const QUALIFIER = /\([^)]*\)|\[[^\]]*\]/g;
// Built at run time: the TypeScript target (ES2017) does not take Unicode property escapes in regex literals
const LETTER = new RegExp("\\p{L}", "u");

/** The words of a name holding at least one letter. */
function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => LETTER.test(word));
}

/** The first letter of a word, signs skipped ("-Paul" → "P"). */
function firstLetter(word: string): string {
  return [...word].find((char) => LETTER.test(char)) ?? "";
}

/**
 * Initials of a person for an avatar: the first letter of the first and of the last word of the name. What is
 * between brackets is left out, as are signs: "Alexandre LAMARRE-MARTIN (Alternant)" → "AL". A single word gives
 * its first two letters; a name without letters gives "?".
 */
export function personInitials(name: string | null | undefined): string {
  const raw = name ?? "";
  let parts = words(raw.replace(QUALIFIER, " "));
  // A name made only of brackets: better its letters than nothing
  if (parts.length === 0) parts = words(raw);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return [...parts[0]].filter((char) => LETTER.test(char)).slice(0, 2).join("").toUpperCase();
  return (firstLetter(parts[0]) + firstLetter(parts[parts.length - 1])).toUpperCase();
}
