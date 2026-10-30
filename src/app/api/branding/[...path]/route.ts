import { NextRequest } from "next/server";
import { join, resolve, extname } from "node:path";
import { stat, readFile } from "node:fs/promises";
import { AppError, handleApiError } from "@/lib/utils/api";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;

  // Priority: file uploaded by the admin (uploads/branding/).
  // Fallback: default asset shipped with the code (public/branding-defaults/).
  // This fallback lets logos/backgrounds provided by the integrator survive
  // redeployments (uploads/ being gitignored).
  const uploadsDir = join(process.cwd(), "uploads", "branding");
  const defaultsDir = join(process.cwd(), "public", "branding-defaults");

  const uploadsPath = resolve(uploadsDir, ...pathSegments);
  const defaultsPath = resolve(defaultsDir, ...pathSegments);

  // Security: the resolved path must stay within one of the two folders
  if (!uploadsPath.startsWith(uploadsDir) && !defaultsPath.startsWith(defaultsDir)) {
    return handleApiError(new AppError("errors.forbidden"));
  }

  let fileToServe: string | null = null;
  if (uploadsPath.startsWith(uploadsDir)) {
    try { await stat(uploadsPath); fileToServe = uploadsPath; } catch { /* fallthrough */ }
  }
  if (!fileToServe && defaultsPath.startsWith(defaultsDir)) {
    try { await stat(defaultsPath); fileToServe = defaultsPath; } catch { /* noop */ }
  }

  if (!fileToServe) {
    return handleApiError(new AppError("errors.notFound"));
  }

  const fileBuffer = await readFile(fileToServe);
  const ext = extname(fileToServe);

  return new Response(new Uint8Array(fileBuffer), {
    headers: {
      "Content-Type": MIME_MAP[ext.toLowerCase()] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
