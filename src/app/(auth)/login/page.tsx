"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import Link from "next/link";
import { Eye, EyeOff, LogIn, KeyRound, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { resolveThemedAsset } from "@/lib/utils/themed-asset";
import { CaptchaWidget } from "@/components/shared/captcha-widget";
import { getRedirectFromLocation } from "@/lib/utils/safe-redirect";

/** Keeps `?redirect=` (e.g. back to the MCP authorization) across the forced steps. */
function withRedirect(path: string): string {
  const target = getRedirectFromLocation();
  return target ? `${path}?redirect=${encodeURIComponent(target)}` : path;
}

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [appTitle, setAppTitle] = useState("");
  const [configData, setConfigData] = useState<Record<string, string | null>>({});
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const { resolvedTheme } = useTheme();

  // 2FA state
  const [twoFARequired, setTwoFARequired] = useState(false);
  const [twoFAPendingToken, setTwoFAPendingToken] = useState("");
  const [twoFACode, setTwoFACode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [twoFALoading, setTwoFALoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/config/public")
      .then((r) => r.json())
      .then((data: Record<string, string | null>) => {
        if (data.APP_TITLE) setAppTitle(data.APP_TITLE);
        setConfigData(data);
      })
      .catch(() => {});
  }, []);

  const logoPath = resolveThemedAsset(configData, "APP_LOGO", resolvedTheme);
  const captchaEnabled = configData.CAPTCHA_ENABLED === "true";
  const captchaProvider = (configData.CAPTCHA_PROVIDER || "altcha") as "altcha" | "turnstile" | "recaptcha";
  const captchaSiteKey = configData.CAPTCHA_SITE_KEY || "";
  // ALTCHA has no siteKey in the DB — show it as soon as the provider is selected.
  const captchaVisible = captchaEnabled && (captchaProvider === "altcha" || !!captchaSiteKey);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (captchaVisible && !captchaToken) {
      setError(t("captcha.required"));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, captchaToken, rememberMe }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t("login.error"));
        setPassword("");
        setCaptchaToken(null);
        setCaptchaKey((k) => k + 1);
        setLoading(false);
        setTimeout(() => passwordRef.current?.focus(), 50);
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (data.forcePasswordChange) {
        router.push(withRedirect("/change-password"));
        return;
      }

      if (data.twoFactorRequired) {
        setTwoFARequired(true);
        setTwoFAPendingToken(data.pendingToken);
        setLoading(false);
        return;
      }

      if (data.setupTwoFactorRequired) {
        router.push(withRedirect("/setup-2fa"));
        return;
      }

      router.push(getRedirectFromLocation() || data.redirectTo || "/planning");
    } catch {
      setError(t("login.error"));
      setPassword("");
      setLoading(false);
      setTimeout(() => passwordRef.current?.focus(), 50);
    }
  }

  async function verifyTwoFA(code: string, backup = false) {
    setError("");
    setTwoFALoading(true);

    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingToken: twoFAPendingToken,
          code,
          isBackupCode: backup,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("twoFactor.invalidCode"));
        setTwoFACode("");
        setTwoFALoading(false);
        return;
      }

      router.push(getRedirectFromLocation() || data.redirectTo || "/planning");
    } catch {
      setError(t("twoFactor.error"));
      setTwoFALoading(false);
    }
  }

  // 2FA screen
  if (twoFARequired) {
    return (
      <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-sm p-10 shadow-xl">
        <div className="mb-6 text-center">
          <KeyRound className="mx-auto h-10 w-10 text-primary mb-3" />
          <h1 className="text-xl font-bold">{t("twoFactor.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {useBackupCode
              ? t("twoFactor.backupPrompt")
              : t("twoFactor.totpPrompt")}
          </p>
        </div>

        <div className="space-y-5">
          {useBackupCode ? (
            <div className="space-y-2">
              <Label htmlFor="backup-code">{t("twoFactor.backupCode")}</Label>
              <Input
                id="backup-code"
                value={twoFACode}
                onChange={(e) => setTwoFACode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                className="h-11 text-center text-lg tracking-widest font-mono"
                maxLength={9}
                autoFocus
              />
              <Button
                className="w-full h-11"
                disabled={twoFALoading || twoFACode.length < 4}
                onClick={() => verifyTwoFA(twoFACode, true)}
              >
                {twoFALoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("twoFactor.verifying")}
                  </span>
                ) : (
                  t("twoFactor.verify")
                )}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <InputOTP
                maxLength={6}
                value={twoFACode}
                onChange={(value) => {
                  setTwoFACode(value);
                  if (value.length === 6) {
                    setTimeout(() => verifyTwoFA(value), 100);
                  }
                }}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} className="h-14 w-12 text-2xl" />
                  <InputOTPSlot index={1} className="h-14 w-12 text-2xl" />
                  <InputOTPSlot index={2} className="h-14 w-12 text-2xl" />
                </InputOTPGroup>
                <span className="text-muted-foreground text-2xl">-</span>
                <InputOTPGroup>
                  <InputOTPSlot index={3} className="h-14 w-12 text-2xl" />
                  <InputOTPSlot index={4} className="h-14 w-12 text-2xl" />
                  <InputOTPSlot index={5} className="h-14 w-12 text-2xl" />
                </InputOTPGroup>
              </InputOTP>
              {twoFALoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("twoFactor.verifying")}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setUseBackupCode(!useBackupCode);
              setTwoFACode("");
              setError("");
            }}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {useBackupCode
              ? t("twoFactor.useApp")
              : t("twoFactor.useBackup")}
          </button>
        </div>
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
          <h1 className="text-3xl font-bold tracking-tight">{appTitle}</h1>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          {t("login.subtitle")}
        </p>
      </div>

      {/* Demo mode banner */}
      {configData.DEMO_MODE === "true" && configData.DEMO_LOGIN && (
        <div className="mb-4 rounded-lg border border-violet-300 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800 p-3">
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2">
            {t("login.demo.title")}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-xs text-violet-600 dark:text-violet-400 space-y-0.5">
              <p>{t("login.demo.login")} <span className="font-mono font-bold">{configData.DEMO_LOGIN}</span></p>
              <p>{t("login.demo.password")} <span className="font-mono font-bold">{configData.DEMO_PASSWORD}</span></p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIdentifier(configData.DEMO_LOGIN || "");
                setPassword(configData.DEMO_PASSWORD || "");
              }}
              className="shrink-0 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 transition-colors"
            >
              {t("login.demo.fill")}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="identifier">{t("fields.login")}</Label>
          <Input
            id="identifier"
            name="username"
            autoComplete="username"
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">{t("fields.password")}</Label>
          <div className="relative">
            <Input
              ref={passwordRef}
              id="password"
              name="password"
              autoComplete="current-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11 pr-10"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="remember-me"
            checked={rememberMe}
            onCheckedChange={(checked) => setRememberMe(!!checked)}
          />
          <Label htmlFor="remember-me" className="text-sm font-normal cursor-pointer">
            {t("login.rememberMe", { days: parseInt(configData.SESSION_REMEMBER_DAYS || "30") || 30 })}
          </Label>
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
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t("login.submitting")}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <LogIn className="h-4 w-4" />
              {tc("actions.logIn")}
            </span>
          )}
        </Button>

        {configData.FORGOT_PASSWORD_ENABLED === "true" && (
          <div className="text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("login.forgotPassword")}
            </Link>
          </div>
        )}

        {configData.PRIVACY_POLICY_ENABLED === "true" && (
          <p className="text-center text-xs text-muted-foreground mt-2">
            {t.rich("login.privacyConsent", {
              link: (chunks) => (
                <a href="/privacy" target="_blank" className="text-primary underline hover:text-primary/80">
                  {chunks}
                </a>
              ),
            })}
          </p>
        )}
      </form>
    </div>
  );
}
