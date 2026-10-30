export function resolveThemedAsset(
  config: Record<string, string | null> | undefined,
  baseKey: string,
  resolvedTheme: string | undefined
): string | null {
  if (!config) return null;
  const light = config[`${baseKey}_LIGHT`] || config[baseKey] || null;
  const dark = config[`${baseKey}_DARK`] || null;
  // If dark theme AND a dark image exists → use it
  if (resolvedTheme === "dark" && dark) return dark;
  // Otherwise → always the light one (or the base key fallback)
  return light;
}
