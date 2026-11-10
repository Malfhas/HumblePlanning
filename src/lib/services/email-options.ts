import { getConfigValues } from "./config-service";
import { getEmailLogo } from "@/lib/branding/logo";
import { dateSettingsFromConfig } from "@/lib/utils/dates";
import { themeColor } from "@/lib/utils/theme-color";
import type { EmailRenderOptions } from "./email-templates";

/**
 * Settings of the e-mails: formats of the dates and times, theme colour, and the logo. The logo is an image the
 * mail client fetches from the instance (Nuntly sends no inline image): only with its address (APP_BASE_URL). When
 * the image is not loaded, its alternative text shows the name of the application.
 */
export async function getEmailRenderOptions(): Promise<EmailRenderOptions> {
  const config = await getConfigValues(["PLANNING_DATE_FORMAT", "TIME_FORMAT", "TIMEZONE", "THEME_COLOR", "APP_BASE_URL"]);
  const baseUrl = (config.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  const logo = baseUrl ? await getEmailLogo() : null;
  return {
    dates: dateSettingsFromConfig(config),
    brand: {
      color: themeColor(config.THEME_COLOR),
      // Shown at half its size: sharp on high-density screens
      logo: logo
        ? { url: `${baseUrl}/api/branding/email-logo?v=${logo.version}` /* i18n-ignore URL */, width: Math.round(logo.width / 2), height: Math.round(logo.height / 2) }
        : null,
    },
  };
}
