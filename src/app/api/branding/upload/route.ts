import { NextRequest } from "next/server";
import { requireAuth, requirePermission, handleApiError, AppError, apiSuccess } from "@/lib/utils/api";
import { setConfigValue } from "@/lib/services/config-service";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { sanitizeSvg } from "@/lib/utils/sanitize-html";
import { refuseInDemo } from "@/lib/demo/guard";

const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"];
const MAX_SIZE_MB = 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

type UploadType = "logo" | "favicon" | "login-bg";
type Variant = "light" | "dark";

const CONFIG_KEY_MAP: Record<UploadType, string> = {
  logo: "APP_LOGO",
  favicon: "APP_FAVICON",
  "login-bg": "LOGIN_BACKGROUND",
};

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function buildConfigKey(type: UploadType, variant: Variant): string {
  const base = CONFIG_KEY_MAP[type];
  return `${base}_${variant.toUpperCase()}`;
}

function buildFilename(type: UploadType, variant: Variant, ext: string): string {
  return `${type}-${variant}.${ext}`;
}

export async function POST(request: NextRequest) {
  const refused = await refuseInDemo(request);
  if (refused) return refused;
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "settings:edit");

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const type = formData.get("type") as string | null;
    const variant = formData.get("variant") as string | null;

    if (!file) throw new AppError("errors.noFile");
    if (!type || !["logo", "favicon", "login-bg"].includes(type)) {
      throw new AppError("settings.errors.brandingInvalidType");
    }
    if (!variant || !["light", "dark"].includes(variant)) {
      throw new AppError("settings.errors.brandingInvalidVariant");
    }

    if (file.size > MAX_SIZE_BYTES) {
      throw new AppError("settings.errors.fileTooLargeMb", { params: { max: MAX_SIZE_MB } });
    }

    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new AppError("settings.errors.extensionNotAllowed", { params: { ext, allowed: ALLOWED_EXTENSIONS.join(", ") } });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadDir = join(process.cwd(), "uploads", "branding");
    await mkdir(uploadDir, { recursive: true });

    const uploadType = type as UploadType;
    const uploadVariant = variant as Variant;
    const configKey = buildConfigKey(uploadType, uploadVariant);

    if (uploadType === "login-bg") {
      const avifName = buildFilename(uploadType, uploadVariant, "avif");
      const webpName = buildFilename(uploadType, uploadVariant, "webp");

      const avifBuffer = await sharp(buffer)
        .resize(1920, 1080, { fit: "inside", withoutEnlargement: true })
        .avif({ quality: 75 })
        .toBuffer();
      await writeFile(join(uploadDir, avifName), avifBuffer);

      const webpBuffer = await sharp(buffer)
        .resize(1920, 1080, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      await writeFile(join(uploadDir, webpName), webpBuffer);

      const path = `branding/${avifName}`;
      await setConfigValue(configKey, path, `Image de fond connexion (${uploadVariant})`); // i18n-ignore internal app_config description (not displayed)
      return apiSuccess({ path });
    }

    if (uploadType === "logo") {
      // SVG: sanitized with DOMPurify before saving (no script, event handler or external reference)
      if (ext === "svg") {
        const svgContent = sanitizeSvg(buffer.toString("utf-8"));
        const svgName = buildFilename(uploadType, uploadVariant, "svg");
        await writeFile(join(uploadDir, svgName), svgContent);
        const path = `branding/${svgName}`;
        await setConfigValue(configKey, path, `Logo du site (${uploadVariant})`); // i18n-ignore internal app_config description (not displayed)
        return apiSuccess({ path });
      }

      const avifName = buildFilename(uploadType, uploadVariant, "avif");
      const webpName = buildFilename(uploadType, uploadVariant, "webp");

      const avifBuffer = await sharp(buffer)
        .resize(400, 400, { fit: "inside", withoutEnlargement: true })
        .avif({ quality: 80 })
        .toBuffer();
      await writeFile(join(uploadDir, avifName), avifBuffer);

      const webpBuffer = await sharp(buffer)
        .resize(400, 400, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      await writeFile(join(uploadDir, webpName), webpBuffer);

      const path = `branding/${avifName}`;
      await setConfigValue(configKey, path, `Logo du site (${uploadVariant})`); // i18n-ignore internal app_config description (not displayed)
      return apiSuccess({ path });
    }

    // Favicon
    const pngName = buildFilename(uploadType, uploadVariant, "png");
    const icoName = buildFilename(uploadType, uploadVariant, "ico");

    const png32 = await sharp(buffer)
      .resize(32, 32, { fit: "cover" })
      .png()
      .toBuffer();
    await writeFile(join(uploadDir, pngName), png32);

    const sizes = [16, 32, 48];
    const pngBuffers = await Promise.all(
      sizes.map((s) => sharp(buffer).resize(s, s, { fit: "cover" }).png().toBuffer())
    );
    const icoBuffer = await pngToIco(pngBuffers);
    await writeFile(join(uploadDir, icoName), icoBuffer);

    const path = `branding/${pngName}`;
    await setConfigValue(configKey, path, `Favicon du site (${uploadVariant})`); // i18n-ignore internal app_config description (not displayed)
    return apiSuccess({ path });
  } catch (error) {
    return handleApiError(error);
  }
}
