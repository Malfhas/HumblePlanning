import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { LOCALE_COOKIE, type AppLocale } from "@/i18n/config";
import { pickLocale } from "@/i18n/accept-language";
import { isDemoMode } from "@/lib/demo";
import { isDemoBlockedRoute } from "@/lib/demo/firewall";
import frErrors from "@/messages/fr/errors.json";
import enErrors from "@/messages/en/errors.json";
import esErrors from "@/messages/es/errors.json";
import deErrors from "@/messages/de/errors.json";

const ERRORS: Record<AppLocale, typeof frErrors> = { fr: frErrors, en: enErrors, es: esErrors, de: deErrors };

/** Localized JSON error. The proxy does not read the DB: HP_LOCALE cookie, then Accept-Language. */
function errorResponse(request: NextRequest, key: "unauthenticated" | "demoRestricted", status: number) {
  const locale = pickLocale({
    cookie: request.cookies.get(LOCALE_COOKIE)?.value,
    instance: "auto",
    acceptLanguage: request.headers.get("accept-language"),
  });
  return NextResponse.json({ error: ERRORS[locale][key], code: `errors.${key}` }, { status });
}

export async function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const { pathname } = request.nextUrl;

  // Demo instance: administration and outgoing services are closed, whatever the permissions.
  if (isDemoMode() && isDemoBlockedRoute(request.method, pathname)) {
    return errorResponse(request, "demoRestricted", 403);
  }

  // Some MCP clients change the path casing (`/Api/mcp`, `/API/MCP`):
  // we serve the same route rather than a 404 (Next routes are case-sensitive).
  if (pathname.toLowerCase().startsWith("/api/mcp") && !pathname.startsWith("/api/mcp")) {
    const url = request.nextUrl.clone();
    url.pathname = "/api/mcp" + pathname.slice("/api/mcp".length);
    return NextResponse.rewrite(url);
  }

  // `/login?redirect=…` (e.g. back to the MCP authorization): the redirecting page
  // has already found the session invalid. We show the form even
  // if an (expired) cookie lingers, otherwise /login → / → /login loops.
  const hasLoginRedirect = pathname.startsWith("/login") && request.nextUrl.searchParams.has("redirect");

  if (sessionCookie && !hasLoginRedirect && (pathname.startsWith("/login") || pathname.startsWith("/forgot-password"))) {
    // Redirect to root (/) which will resolve the user's preferred page
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Allow API routes with Bearer token (API key or MCP token)
  const hasBearer = request.headers.get("authorization")?.startsWith("Bearer ");

  // Calendar subscription (Google Calendar, Outlook…): no cookie, token in
  // the URL. Exception limited to the exact GET of /api/export/ical with `token`; the
  // route checks the token (format, existence, active account) and returns 401 otherwise.
  const isIcalTokenFeed =
    pathname === "/api/export/ical" && request.method === "GET" && Boolean(request.nextUrl.searchParams.get("token"));

  if (
    !sessionCookie &&
    !hasBearer &&
    !isIcalTokenFeed &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/forgot-password") &&
    !pathname.startsWith("/change-password") &&
    !pathname.startsWith("/reset-password") &&
    !pathname.startsWith("/privacy") &&
    !pathname.startsWith("/api/auth") &&
    !pathname.startsWith("/api/altcha/") &&
    !pathname.startsWith("/api/config/public") &&
    // Language choice: allowed before sign-in (authentication pages).
    !pathname.startsWith("/api/locale") &&
    !pathname.startsWith("/api/branding/") &&
    !pathname.startsWith("/api/mcp") &&
    // MCP OAuth consent: checks the session itself and sends back to login
    // with `?redirect=` (the generic redirect below would lose the OAuth request).
    !pathname.startsWith("/mcp-authorize") &&
    !pathname.startsWith("/api/webhooks/") &&
    !pathname.startsWith("/.well-known/") &&
    // robots.txt must be readable without a session, otherwise crawlers get the login page
    pathname !== "/robots.txt"
  ) {
    // API routes: return 401 instead of redirect
    if (pathname.startsWith("/api/")) {
      return errorResponse(request, "unauthenticated", 401);
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Routes excluded from the middleware (important for large uploads:
    // the middleware Edge runtime silently truncates the body beyond
    // ~10 MB, which would break PostgreSQL dump imports).
    //   - api/auth        : handled by Better Auth
    //   - api/import      : dump upload (up to 500 MB)
    //   - api/branding    : logo upload (can reach 10 MB)
    //   - api/backups     : dump download
    //   - api/ai-chat/attachments : AI chat attachments (up to 20 MB)
    "/((?!_next/static|_next/image|favicon.ico|icon|api/auth|api/import|api/branding|api/backups|api/ai-chat/attachments).*)",
  ],
};
