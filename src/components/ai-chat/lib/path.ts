/**
 * Whether a path belongs to a section of the application. A section is
 * compared on its segments, never on its characters: `/assistant-x` is
 * not `/assistant`.
 */
export const isInSection = (path: string, section: string): boolean =>
  path === section || path.startsWith(`${section}/`);
