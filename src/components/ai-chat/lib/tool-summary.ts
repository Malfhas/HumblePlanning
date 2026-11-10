/** The tools of a group, each once, with how many times it was called: « list-users ×4, list-holidays ». */
export function toolSummary(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => (count > 1 ? [name, '×' + count].join(' ') : name)).join(', ');
}
