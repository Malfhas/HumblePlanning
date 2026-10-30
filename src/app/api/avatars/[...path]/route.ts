import { NextRequest } from "next/server";
import { join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { AppError, handleApiError } from "@/lib/utils/api";

const MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: pathParts } = await params;
    const filePath = join(process.cwd(), "uploads", "avatars", ...pathParts);

    // Security: ensure path stays within uploads/avatars
    const uploadsDir = join(process.cwd(), "uploads", "avatars");
    if (!filePath.startsWith(uploadsDir)) {
      throw new AppError("errors.forbidden");
    }

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) {
      throw new AppError("admin.files.errors.notFound");
    }

    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    const buffer = await readFile(filePath);
    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
