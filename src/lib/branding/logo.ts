/**
 * The logo of the instance as a PNG, for what cannot show the uploaded formats (AVIF, WebP, SVG): the PDF export
 * (pdfkit) and the e-mails (most mail clients read neither WebP nor SVG).
 */
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";
import { getConfigValues } from "@/lib/services/config-service";
import { logger } from "@/lib/logger";

/**
 * File of a branding image set in the settings ("branding/logo-light.webp"): the one uploaded by the admin, else the
 * default shipped with the code. Same resolution as /api/branding.
 */
export async function brandingFile(configValue: string | null | undefined): Promise<string | null> {
  if (!configValue?.startsWith("branding/")) return null;
  const fileName = basename(configValue);
  for (const dir of [join(process.cwd(), "uploads", "branding"), join(process.cwd(), "public", "branding-defaults")]) {
    const fullPath = join(dir, fileName);
    try {
      await stat(fullPath);
      return fullPath;
    } catch {
      // next folder
    }
  }
  return null;
}

/** The light logo (the PDF and the e-mails are on white): its file, or null without a logo. */
export async function lightLogoFile(): Promise<string | null> {
  const config = await getConfigValues(["APP_LOGO_LIGHT", "APP_LOGO"]);
  return brandingFile(config.APP_LOGO_LIGHT || config.APP_LOGO);
}

/**
 * An image as a PNG fitting a box. A vector is drawn straight at the size of the box: rasterising it at a fixed
 * density followed its declared size (the default logo, 4393 × 2125 px, became an 18304 × 8854 image). A bitmap is
 * only reduced. `palette`: 256 colours, a few kilobytes for a logo.
 */
export async function imageToPng(buf: Buffer, maxWidth: number, maxHeight: number, options: { palette?: boolean } = {}): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const vector = meta.format === "svg";
  const scale = Math.min(maxWidth / (meta.width || maxWidth), maxHeight / (meta.height || maxHeight));
  const density = vector ? Math.min(2400, Math.max(1, 72 * scale)) : undefined;
  return sharp(buf, density ? { density } : {})
    .resize({ width: maxWidth, height: maxHeight, fit: "inside", withoutEnlargement: !vector })
    .png(options.palette ? { palette: true, compressionLevel: 9 } : {})
    .toBuffer();
}

/** Size of a PNG, from its IHDR header (bytes 16-23). */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16) || 1, height: png.readUInt32BE(20) || 1 };
}

/**
 * Box of the logo of the e-mails, in pixels: shown at half this size (200 × 48 at most), sharp on high-density
 * screens.
 */
const EMAIL_LOGO_BOX = { width: 400, height: 96 };

interface EmailLogo {
  png: Buffer;
  width: number;
  height: number;
  /** Changes with the logo: in its address, so that the mail clients do not keep the former one. */
  version: string;
}

let emailLogoCache: (EmailLogo & { key: string }) | null = null;

/** The logo of the e-mails (PNG of a few kilobytes), made again only when the logo changes. Null without a logo. */
export async function getEmailLogo(): Promise<EmailLogo | null> {
  try {
    const file = await lightLogoFile();
    if (!file) return null;
    const { mtimeMs, size } = await stat(file);
    const key = `${file}:${mtimeMs}:${size}`;
    if (emailLogoCache?.key !== key) {
      const png = await imageToPng(await readFile(file), EMAIL_LOGO_BOX.width, EMAIL_LOGO_BOX.height, { palette: true });
      const version = `${Math.round(mtimeMs).toString(36)}${size.toString(36)}`;
      emailLogoCache = { key, png, ...pngSize(png), version };
    }
    const { png, width, height, version } = emailLogoCache;
    return { png, width, height, version };
  } catch (err) {
    logger.warn("email", "E-mail logo unavailable", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
