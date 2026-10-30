"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrengthBar } from "@/components/shared/password-strength-bar";
import { policyFromConfig, evaluatePassword } from "@/lib/password-policy";
import { generatePasswordFromConfig } from "@/lib/password-generator";
import { Eye, EyeOff, Wand2, ShieldCheck } from "lucide-react";
import { useTheme } from "next-themes";
import { resolveThemedAsset } from "@/lib/utils/themed-asset";
import { getRedirectFromLocation } from "@/lib/utils/safe-redirect";

export default function ChangePasswordPage() {
  const router = useRouter();
  const t = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [configData, setConfigData] = useState<Record<string, string | null>>({});
  const [publicConfig, setPublicConfig] = useState<Record<string, string | null>>({});
  const [appTitle, setAppTitle] = useState("");
  const { resolvedTheme } = useTheme();

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

  const logoPath = resolveThemedAsset(publicConfig, "APP_LOGO", resolvedTheme);

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

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t("password.changeError"));
        setPassword("");
        setConfirm("");
        setLoading(false);
        setTimeout(() => passwordRef.current?.focus(), 50);
        return;
      }

      router.push(getRedirectFromLocation() || "/planning");
    } catch {
      setError(t("password.changeError"));
      setPassword("");
      setConfirm("");
      setLoading(false);
      setTimeout(() => passwordRef.current?.focus(), 50);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-sm p-10 shadow-xl">
      <div className="mb-8 text-center">
        {logoPath ? (
          logoPath.endsWith(".svg") ? (
            <img src={`/api/${logoPath.startsWith("branding/") ? "" : "files/"}${logoPath}`} alt={appTitle} className="mx-auto mb-4 h-20 max-w-[260px] object-contain" />
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
        <p className="mt-3 text-sm font-medium">{t("changePassword.title")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("changePassword.description")}
        </p>
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
