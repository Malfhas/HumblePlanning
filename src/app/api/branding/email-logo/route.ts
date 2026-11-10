import { getEmailLogo } from "@/lib/branding/logo";
import { AppError, handleApiError } from "@/lib/utils/api";

/**
 * Logo of the e-mails, public (fetched by the mail clients): the light logo as a PNG of a few kilobytes. Its address
 * carries a version (`?v=`) that changes with the logo.
 */
export async function GET() {
  const logo = await getEmailLogo();
  if (!logo) return handleApiError(new AppError("errors.notFound"));
  return new Response(new Uint8Array(logo.png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=604800",
    },
  });
}
