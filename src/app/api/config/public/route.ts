import { getAllConfig } from "@/lib/services/config-service";
import { clearLegalTextDefaults } from "@/lib/services/legal-texts";
import { demoConfigOverride, getDemoCredentials, getDemoResetTime } from "@/lib/demo";

const PUBLIC_KEYS = [
  "APP_TITLE",
  "APP_LOGO", "APP_LOGO_LIGHT", "APP_LOGO_DARK",
  "LOGIN_BACKGROUND", "LOGIN_BACKGROUND_LIGHT", "LOGIN_BACKGROUND_DARK",
  "MAINTENANCE_MODE",
  "CAPTCHA_ENABLED", "CAPTCHA_PROVIDER", "CAPTCHA_SITE_KEY",
  "SESSION_REMEMBER_DAYS",
  "FORGOT_PASSWORD_ENABLED",
  "COOKIE_BANNER_ENABLED", "COOKIE_BANNER_TITLE", "COOKIE_BANNER_DESCRIPTION", "COOKIE_BANNER_POSITION",
  "COOKIE_ANALYTICS_ENABLED", "COOKIE_ANALYTICS_LABEL", "COOKIE_FUNCTIONAL_ENABLED", "COOKIE_FUNCTIONAL_LABEL",
  "PRIVACY_POLICY_ENABLED", "PRIVACY_POLICY_TITLE", "PRIVACY_POLICY_CONTENT", "PRIVACY_POLICY_LAST_UPDATED",
  "LEGAL_COMPANY_NAME", "LEGAL_CONTACT_EMAIL", "LEGAL_DATA_RETENTION_DAYS",
  "FOOTER_SHOW_PRIVACY_LINK", "FOOTER_SHOW_VERSION", "FOOTER_COPYRIGHT_TEXT",
];

export async function GET() {
  try {
    const config = await getAllConfig();
    const map: Record<string, string | null> = {};
    for (const c of config) {
      if (PUBLIC_KEYS.includes(c.key)) map[c.key] = demoConfigOverride(c.key) ?? c.value;
    }
    // GDPR texts equal to a default (even in another language): fall back to the
    // text translated in the reader's language.
    clearLegalTextDefaults(map, null);

    // Demo instance (.env, not stored in the DB): public credentials and reset time
    const demo = getDemoCredentials();
    if (demo) {
      map.DEMO_MODE = "true";
      map.DEMO_LOGIN = demo.login;
      map.DEMO_PASSWORD = demo.password;
      map.DEMO_RESET_TIME = getDemoResetTime();
    }

    return Response.json(map);
  } catch {
    return Response.json({});
  }
}
