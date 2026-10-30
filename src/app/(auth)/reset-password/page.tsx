"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrengthBar } from "@/components/shared/password-strength-bar";
import { policyFromConfig, evaluatePassword } from "@/lib/password-policy";
import { generatePasswordFromConfig } from "@/lib/password-generator";
import { Eye, EyeOff, Wand2, ShieldCheck, AlertTriangle, CheckCircle2, Loader2, User } from "lucide-react";
import { useTheme } from "next-themes";
import { resolveThemedAsset } from "@/lib/utils/themed-asset";
import { CaptchaWidget } from "@/components/shared/captcha-widget";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [configData, setConfigData] = useState<Record<string, string | null>>({});
  const [publicConfig, setPublicConfig] = useState<Record<string, string | null>>({});
  const [appTitle, setAppTitle] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const { resolvedTheme } = useTheme();

  // Token validation state
  const [tokenStatus, setTokenStatus] = useState<"loading" | "valid" | "invalid">("loading");
  const [tokenError, setTokenError] = useState("");
  const [userLogin, setUserLogin] = useState("");
  const [userName, setUserName] = useState("");

  useEffect(() => {
    fetch("/api/config/public")
      .then((r) => r.json())
      .then((data: Record<string, string | null>) => {
        if (data.APP_TITLE) setAppTitle(data.APP_TITLE);
        setPublicConfig(data);
      })
      .catch(() => {});
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: Record<string, string | null>) => setConfigData(data))
      .catch(() => {});
  }, []);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setTokenStatus("invalid");
      setTokenError(t("resetPassword.invalidTitle"));
      return;
    }
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setTokenStatus("invalid");
          setTokenError(data.error ?? t("errors.linkInvalidOrExpired"));
        } else {
          setTokenStatus("valid");
          setUserLogin(data.username ?? "");
          setUserName(data.name ?? "");
        }
      })
      .catch(() => {
        setTokenStatus("invalid");
        setTokenError(t("resetPassword.validationError"));
      });
  }, [token, t]);

  const logoPath = resolveThemedAsset(publicConfig, "APP_LOGO", resolvedTheme);
  const captchaEnabled = publicConfig.CAPTCHA_ENABLED === "true";
  const captchaProvider = (publicConfig.CAPTCHA_PROVIDER || "altcha") as "altcha" | "turnstile" | "recaptcha";
  const captchaSiteKey = publicConfig.CAPTCHA_SITE_KEY || "";
  const captchaVisible = captchaEnabled && (captchaProvider === "altcha" || !!captchaSiteKey);

  const policy = useMemo(() => policyFromConfig(configData), [configData]);
  const strength = useMemo(() => evaluatePassword(password, policy), [password, policy]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError(t("password.mismatch"));
      return;
    }

    if (!strength.valid) {
      setError(t("password.policyNotMet"));
      return;
    }

    if (captchaVisible && !captchaToken) {
      setError(t("captcha.required"));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, captchaToken }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? t("password.changeError"));
        setPassword("");
        setConfirm("");
        setCaptchaToken(null);
        setCaptchaKey((k) => k + 1);
        setLoading(false);
        setTimeout(() => passwordRef.current?.focus(), 50);
        return;
      }

      setSuccess(true);
    } catch {
      setError(t("password.changeError"));
      setPassword("");
      setConfirm("");
      setCaptchaToken(null);
      setCaptchaKey((k) => k + 1);
      setLoading(false);
      setTimeout(() => passwordRef.current?.focus(), 50);
    }
  }

  function renderLogo() {
    if (logoPath) {
      if (logoPath.endsWith(".svg")) {
        return <img src={`/api/${logoPath.startsWith("branding/") ? "" : "files/"}${logoPath}`} alt={appTitle} className="mx-auto mb-4 h-20 max-w-[260px] object-contain" />;
      }
      return (
        <picture>
          <source srcSet={`/api/branding/${logoPath.replace("branding/", "")}`} type="image/avif" />
          <source srcSet={`/api/branding/${logoPath.replace("branding/", "").replace(".avif", ".webp")}`} type="image/webp" />
          <img
            src={`/api/branding/${logoPath.replace("branding/", "").replace(".avif", ".webp")}`}
            alt={appTitle}
            className="mx-auto mb-4 h-20 max-w-[260px] object-contain"
          />
        </picture>
      );
    }
    if (appTitle) {
      return <h1 className="text-3xl font-bold tracking-tight">{appTitle}</h1>;
    }
    return null;
  }

  // Loading state
  if (tokenStatus === "loading") {
    return (
      <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-sm p-10 shadow-xl text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">{t("resetPassword.checking")}</p>
      </div>
    );
  }

  // Invalid/expired token
  if (tokenStatus === "invalid") {
    return (
      <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-sm p-10 shadow-xl text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-amber-500 mb-4" />
        <h2 className="text-lg font-semibold mb-2">{t("resetPassword.invalidTitle")}</h2>
        <p className="text-sm text-muted-foreground mb-6">
          {tokenError || t("resetPassword.invalidDefault")}
        </p>
        <Button onClick={() => router.push("/login")} className="w-full">
          {t("backToLogin")}
        </Button>
      </div>
    );
  }

  // Success
  if (success) {
    return (
      <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-sm p-10 shadow-xl text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500 mb-4" />
        <h2 className="text-lg font-semibold mb-2">{t("resetPassword.successTitle")}</h2>
        <p className="text-sm text-muted-foreground mb-6">
          {t("resetPassword.successDescription")}
        </p>
        <Button onClick={() => router.push("/login")} className="w-full">
          {tc("actions.logIn")}
        </Button>
      </div>
    );
  }

  // Form
  return (
    <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-sm p-10 shadow-xl">
      <div className="mb-8 text-center">
        {renderLogo()}
        <p className="mt-3 text-sm font-medium">{t("resetPassword.title")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("resetPassword.description")}
        </p>
      </div>

      {/* User info banner */}
      <div className="mb-6 flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <User className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{userName}</p>
          <p className="text-xs text-muted-foreground font-mono truncate">{userLogin}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="password">{t("fields.newPassword")}</Label>
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Input
                ref={passwordRef}
                id="password"
                name="new-password"
                autoComplete="new-password"
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
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              title={t("password.generate")}
              onClick={() => {
                const pwd = generatePasswordFromConfig(configData);
                setPassword(pwd);
                setConfirm(pwd);
                setShowPassword(true);
                navigator.clipboard.writeText(pwd).catch(() => {});
              }}
            >
              <Wand2 className="h-4 w-4" />
            </Button>
          </div>
          {password && <PasswordStrengthBar password={password} policy={policy} />}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm">{t("fields.confirmPassword")}</Label>
          <Input
            id="confirm"
            name="new-password-confirm"
            autoComplete="new-password"
            type={showPassword ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="h-11"
          />
          {confirm && password !== confirm && (
            <p className="text-xs text-destructive">{t("password.mismatch")}</p>
          )}
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

        <Button
          type="submit"
          className="w-full h-11 text-base"
          disabled={loading || !strength.valid || password !== confirm}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {t("password.changing")}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              {t("password.change")}
            </span>
          )}
        </Button>
      </form>
    </div>
  );
}
