"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import { useTheme } from "next-themes";
import { resolveThemedAsset } from "@/lib/utils/themed-asset";
import { CaptchaWidget } from "@/components/shared/captcha-widget";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [configData, setConfigData] = useState<Record<string, string | null>>({});
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    fetch("/api/config/public")
      .then((r) => r.json())
      .then((data: Record<string, string | null>) => {
        setConfigData(data);
        // If feature is disabled, redirect to login
        if (data.FORGOT_PASSWORD_ENABLED !== "true") {
          window.location.href = "/login";
        }
      })
      .catch(() => {});
  }, []);

  const appTitle = configData.APP_TITLE || "";
  const logoPath = resolveThemedAsset(configData, "APP_LOGO", resolvedTheme);
  const captchaEnabled = configData.CAPTCHA_ENABLED === "true";
  const captchaProvider = (configData.CAPTCHA_PROVIDER || "altcha") as "altcha" | "turnstile" | "recaptcha";
  const captchaSiteKey = configData.CAPTCHA_SITE_KEY || "";
  const captchaVisible = captchaEnabled && (captchaProvider === "altcha" || !!captchaSiteKey);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!login.trim() || !email.trim()) {
      setError(t("forgotPassword.fillBoth"));
      return;
    }

    if (captchaVisible && !captchaToken) {
      setError(t("forgotPassword.captchaRequired"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), email: email.trim(), captchaToken }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || t("forgotPassword.error"));
        setCaptchaToken(null);
        setCaptchaKey((k) => k + 1);
        setLoading(false);
        return;
      }

      // Always show success (generic message from server)
      setSuccess(true);
      setSuccessMessage(data.message || t("forgotPassword.sentDefault"));
    } catch {
      setError(t("forgotPassword.networkError"));
    } finally {
      setLoading(false);
    }
  }

  // Success state
  if (success) {
    return (
      <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-sm p-10 shadow-xl">
        <div className="mb-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-3" />
          <h1 className="text-xl font-bold">{t("forgotPassword.sentTitle")}</h1>
        </div>

        <p className="text-sm text-muted-foreground text-center leading-relaxed mb-6">
          {successMessage}
        </p>

        <Link href="/login">
          <Button variant="outline" className="w-full h-11">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("backToLogin")}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-sm p-10 shadow-xl">
      <div className="mb-8 text-center">
        {logoPath ? (
          logoPath.endsWith(".svg") ? (
            <img
              src={`/api/${logoPath.startsWith("branding/") ? "" : "files/"}${logoPath}`}
              alt={appTitle}
              className="mx-auto mb-4 h-20 max-w-[260px] object-contain"
            />
          ) : (
            <picture>
              <source srcSet={`/api/branding/${logoPath.replace("branding/", "")}`} type="image/avif" />
              <source srcSet={`/api/branding/${logoPath.replace("branding/", "").replace(".avif", ".webp")}`} type="image/webp" />
              <img
                src={`/api/branding/${logoPath.replace("branding/", "").replace(".avif", ".webp")}`}
                alt={appTitle}
                className="mx-auto mb-4 h-20 max-w-[260px] object-contain"
              />
            </picture>
          )
        ) : (
          appTitle && <h1 className="text-3xl font-bold tracking-tight">{appTitle}</h1>
        )}
        <div className="flex items-center justify-center gap-2 mt-3">
          <KeyRound className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">{t("forgotPassword.title")}</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("forgotPassword.description")}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="login">{t("fields.login")}</Label>
          <Input
            id="login"
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
            className="h-11"
            autoFocus
            autoComplete="username"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t("fields.email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-11"
            autoComplete="email"
            placeholder=""
          />
        </div>

        {captchaVisible && (
          <CaptchaWidget
            key={captchaKey}
            provider={captchaProvider}
            siteKey={captchaSiteKey}
            onVerify={setCaptchaToken}
            onExpire={() => setCaptchaToken(null)}
          />
        )}

        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("forgotPassword.sending")}
            </span>
          ) : (
            t("forgotPassword.submit")
          )}
        </Button>

        <div className="text-center">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("backToLogin")}
          </Link>
        </div>
      </form>
    </div>
  );
}
