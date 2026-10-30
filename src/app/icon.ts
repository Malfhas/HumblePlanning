import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";
export const contentType = "image/png";
export const size = { width: 32, height: 32 };

export default async function Icon() {
  const brandingDir = join(process.cwd(), "uploads", "branding");

  // Try custom favicon (light variant first, then legacy name)
  const candidates = ["favicon-light.png", "favicon.png"];
  for (const name of candidates) {
    try {
      const buffer = await readFile(join(brandingDir, name));
      return new Response(buffer, {
        headers: { "Content-Type": "image/png" },
      });
    } catch {
      // try next
    }
  }

  // Fallback to default PNG (HumblePlanning favicon)
  const defaultPath = join(process.cwd(), "public", "favicon-default.png");
  const buffer = await readFile(defaultPath);
  return new Response(buffer, {
    headers: { "Content-Type": "image/png" },
  });
}
