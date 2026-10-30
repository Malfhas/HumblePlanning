"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { resolveThemedAsset } from "@/lib/utils/themed-asset";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Bot,
  Check,
  Eye,
  Globe,
  Loader2,
  PencilLine,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  UserRound,
} from "lucide-react";

export interface McpAuthorizeRequest {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
  resource: string;
}

type ViewProps =
  | { mode: "message"; title: string; message: string }
  | {
      mode: "denied";
      clientLabel: string;
      redirectHost: string;
      userLabel: string;
      denyUrl: string;
      selfPath: string;
    }
  | {
      mode: "consent";
      clientLabel: string;
      clientName: string;
      verified: boolean;
      metadataHost: string | null;
      redirectHost: string;
      userLabel: string;
      canWrite: boolean;
      request: McpAuthorizeRequest;
      csrf: string;
      selfPath: string;
    };

function useBranding() {
  const { resolvedTheme } = useTheme();
  const [config, setConfig] = useState<Record<string, string | null>>({});
  useEffect(() => {
    fetch("/api/config/public")
      .then((r) => r.json())
      .then((data: Record<string, string | null>) => setConfig(data))
      .catch(() => {});
  }, []);
  return {
    appTitle: config.APP_TITLE || "Humble Planning",
    logoPath: resolveThemedAsset(config, "APP_LOGO", resolvedTheme),
  };
}

async function switchAccount(selfPath: string) {
  await signOut().catch(() => {});
  window.location.href = `/login?redirect=${encodeURIComponent(selfPath)}`;
}

export function McpAuthorizeView(props: ViewProps) {
  const t = useTranslations("mcp.authorize");
  const tErrors = useTranslations("mcp.errors");
  const tCommonErrors = useTranslations("errors");
  const { appTitle, logoPath } = useBranding();
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState("");
  const strong = (chunks: React.ReactNode) => <strong className="text-foreground">{chunks}</strong>;
  const medium = (chunks: React.ReactNode) => <span className="font-medium">{chunks}</span>;

  async function decide(decision: "approve" | "deny") {
    if (props.mode !== "consent") return;
    setLoading(decision);
    setError("");
    try {
      const res = await fetch("/api/mcp/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...props.request, csrf: props.csrf, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect) {
        window.location.assign(data.redirect);
        return;
      }
      setError(data.error || tErrors("requestFailed"));
    } catch {
      setError(tCommonErrors("network"));
    }
    setLoading(null);
  }

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-sm p-8 sm:p-10 shadow-xl space-y-6">
      <div className="text-center">
        {logoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/${logoPath.startsWith("branding/") ? "" : "files/"}${logoPath}`}
            alt={appTitle}
            className="mx-auto h-12 max-w-[220px] object-contain"
          />
        ) : (
          <p className="text-2xl font-bold tracking-tight">{appTitle}</p>
        )}
      </div>

      {props.mode === "message" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h1 className="text-xl font-semibold">{props.title}</h1>
          <p className="text-sm text-muted-foreground">{props.message}</p>
        </div>
      )}

      {props.mode === "denied" && (
        <>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <ShieldX className="h-7 w-7 text-destructive" />
            </div>
            <h1 className="text-xl font-semibold">{t("denied.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t.rich("denied.description", { user: props.userLabel, client: props.clientLabel, b: strong })}
            </p>
            <p className="text-sm text-muted-foreground">{t("denied.help")}</p>
          </div>
          <div className="space-y-2">
            <Button asChild className="w-full h-11">
              <a href={props.denyUrl}>{t("denied.returnTo", { client: props.clientLabel })}</a>
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t("denied.returnHost", { host: props.redirectHost })}</p>
            <Button variant="ghost" className="w-full" onClick={() => switchAccount(props.selfPath)}>
              {t("denied.switchAccount")}
            </Button>
          </div>
        </>
      )}

      {props.mode === "consent" && (
        <>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-xl font-semibold">{t("consent.title", { client: props.clientLabel })}</h1>
            <p className="text-sm text-muted-foreground">
              {t.rich("consent.description", { client: props.clientLabel, appTitle, b: strong })}
            </p>
          </div>

          <div className="rounded-lg border bg-muted/40 p-4 space-y-2.5 text-sm">
            <div className="flex items-start gap-2">
              {props.verified ? (
                <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
              ) : (
                <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0">
                <p>{t.rich("consent.application", { name: props.clientName, b: medium })}</p>
                {props.metadataHost && (
                  <p className="text-xs text-muted-foreground">{t("consent.metadataHost", { host: props.metadataHost })}</p>
                )}
                {!props.verified && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">{t("consent.unverified")}</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Globe className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <p className="min-w-0 break-words">{t.rich("consent.redirect", { host: props.redirectHost, b: medium })}</p>
            </div>
            <div className="flex items-start gap-2">
              <UserRound className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <p className="min-w-0">
                {t.rich("consent.account", { user: props.userLabel, b: medium })}{" "}
                <button
                  type="button"
                  onClick={() => switchAccount(props.selfPath)}
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  {t("consent.changeAccount")}
                </button>
              </p>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <p className="font-medium">{t("consent.capabilities")}</p>
            <div className="flex items-start gap-2">
              <Eye className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
              <p>{t("consent.read")}</p>
            </div>
            {props.canWrite ? (
              <div className="flex items-start gap-2">
                <PencilLine className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                <p>{t("consent.write")}</p>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <Check className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-muted-foreground">{t("consent.readOnly")}</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("consent.footer")}</p>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="h-11" disabled={loading !== null} onClick={() => decide("deny")}>
              {loading === "deny" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("consent.deny")}
            </Button>
            <Button className="h-11" disabled={loading !== null} onClick={() => decide("approve")}>
              {loading === "approve" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("consent.approve")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
