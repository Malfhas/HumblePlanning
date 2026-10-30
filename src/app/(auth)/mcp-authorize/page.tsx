import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getConfigValue } from "@/lib/services/config-service";
import { hasPermission } from "@/lib/services/permission-service";
import {
  readAuthorizeParams,
  authorizeParamsToQuery,
  validateAuthorizeRequest,
  checkMcpEligibility,
  computeConsentToken,
  describeRedirectTarget,
  buildAccessDeniedRedirect,
} from "@/lib/services/mcp-oauth-service";
import { resolveRequestLocale } from "@/i18n/resolve-locale";
import { McpAuthorizeView } from "./mcp-authorize-view";

export const dynamic = "force-dynamic";

/**
 * OAuth consent screen of the MCP connector. Everything is validated server-side:
 * client and redirect_uri, session (otherwise → login page, which comes back here),
 * active account, then `mcp:use` permission (otherwise → "not authorized" page).
 */
export default async function McpAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = readAuthorizeParams((k) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  });
  const selfPath = `/mcp-authorize?${authorizeParamsToQuery(params)}`;
  const t = await getTranslations("mcp.authorize");

  if ((await getConfigValue("MCP_ENABLED")) !== "true") {
    return <McpAuthorizeView mode="message" title={t("disabled.title")} message={t("disabled.message")} />;
  }

  const validation = await validateAuthorizeRequest(params, await resolveRequestLocale());
  if (!validation.ok) {
    if (validation.fatal) {
      const tErrors = await getTranslations("mcp.errors");
      const reason = validation.code.slice("mcp.errors.".length) as Parameters<typeof tErrors>[0];
      return <McpAuthorizeView mode="message" title={t("invalidRequest.title")} message={tErrors(reason)} />;
    }
    redirect(validation.redirectTo);
  }
  const { client, params: p } = validation;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?redirect=${encodeURIComponent(selfPath)}`);

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: {
      name: true,
      firstName: true,
      username: true,
      active: true,
      forcePasswordChange: true,
      forceTwoFactor: true,
      twoFactorEnabled: true,
    },
  });
  if (!user || user.active === false) {
    return <McpAuthorizeView mode="message" title={t("accountDisabled.title")} message={t("accountDisabled.message")} />;
  }

  // Same requirements as a regular login before granting access
  if (user.forcePasswordChange) redirect(`/change-password?redirect=${encodeURIComponent(selfPath)}`);
  if (!user.twoFactorEnabled && (user.forceTwoFactor || (await getConfigValue("TWOFACTOR_REQUIRED")) === "true")) {
    redirect(`/setup-2fa?redirect=${encodeURIComponent(selfPath)}`);
  }

  const target = describeRedirectTarget(p.redirectUri);
  const clientLabel = target.knownLabel ?? client.clientName;
  const fullName = [user.firstName, user.name].filter(Boolean).join(" ");
  const userLabel = user.username ? `${fullName} (${user.username})` : fullName;

  const eligibility = await checkMcpEligibility(session.user.id);
  if (!eligibility.ok) {
    const tOauth = await getTranslations("mcpTools.oauth");
    return (
      <McpAuthorizeView
        mode="denied"
        clientLabel={clientLabel}
        redirectHost={target.host}
        userLabel={userLabel}
        selfPath={selfPath}
        denyUrl={await buildAccessDeniedRedirect(p.redirectUri, p.state, tOauth("accountNotAllowed"))}
      />
    );
  }

  return (
    <McpAuthorizeView
      mode="consent"
      clientLabel={clientLabel}
      clientName={client.clientName}
      verified={target.knownLabel !== null}
      metadataHost={client.metadataHost}
      redirectHost={target.host}
      userLabel={userLabel}
      canWrite={hasPermission(eligibility.perms, "mcp:write")}
      csrf={computeConsentToken(session.session.id, p)}
      selfPath={selfPath}
      request={{
        response_type: p.responseType,
        client_id: p.clientId,
        redirect_uri: p.redirectUri,
        code_challenge: p.codeChallenge,
        code_challenge_method: p.codeChallengeMethod,
        state: p.state,
        scope: p.scope,
        resource: p.resource,
      }}
    />
  );
}
