import { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { apiSuccess, getAuthSession, handleApiError } from "@/lib/utils/api";
import { AppError } from "@/lib/errors";
import { LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/config";
import { pickLocale } from "@/i18n/accept-language";
import { getInstanceLocaleSetting } from "@/i18n/resolve-locale";

/**
 * POST /api/locale — PUBLIC route (authentication pages included).
 *
 * Body: `{ preference?: "auto" | "fr" | "en" | "es" | "de" }`
 *  - "fr" / "en" : sets the HP_LOCALE cookie (1 year, not HttpOnly: read by the switcher);
 *  - "auto"      : deletes the cookie (instance language, then browser language);
 *  - absent      : changes nothing (sync of `users.locale`, LocaleSync).
 *
 * Responds `{ locale }` (effective language). If a session exists, updates
 * `users.locale` (last effective language, used for emails). The
 * client then reloads the page.
 */
const schema = z.object({ preference: z.enum(["auto", ...LOCALES]).optional() });

/** Same origin as the request host (CSRF defense; low stakes: a language cookie). */
function isSameOrigin(request: NextRequest, host: string | null): boolean {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return true; // server-to-server call / tool
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!isSameOrigin(request, host)) throw new AppError("errors.invalidOrigin", { status: 403 });

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AppError("errors.invalidData", { status: 422, details: parsed.error.issues });
    const { preference } = parsed.data;

    const store = await cookies();
    const proto = h.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
    if (preference === "auto") {
      store.delete(LOCALE_COOKIE);
    } else if (preference) {
      store.set(LOCALE_COOKIE, preference, {
        path: "/",
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: "lax",
        secure: proto === "https",
        httpOnly: false,
      });
    }

    const locale = pickLocale({
      cookie: preference === "auto" ? null : (preference ?? store.get(LOCALE_COOKIE)?.value),
      instance: await getInstanceLocaleSetting(),
      acceptLanguage: h.get("accept-language"),
    });

    const session = await getAuthSession().catch(() => null);
    if (session) {
      await db
        .update(users)
        .set({ locale })
        .where(and(eq(users.id, session.user.id), or(isNull(users.locale), ne(users.locale, locale))));
    }

    return apiSuccess({ locale });
  } catch (error) {
    return handleApiError(error);
  }
}
