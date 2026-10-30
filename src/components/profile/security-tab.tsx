"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  useProfile,
  useChangeProfilePassword,
  useProfileSessions,
  useRevokeSession,
} from "@/hooks/use-profile";
import { useConfig } from "@/hooks/use-config";
import { useSession } from "@/lib/auth-client";
import { PasswordStrengthBar } from "@/components/shared/password-strength-bar";
import { policyFromConfig, evaluatePassword } from "@/lib/password-policy";
import { generatePasswordFromConfig } from "@/lib/password-generator";
import { useDateFormat } from "@/hooks/use-date-format";
import { parseFieldErrors } from "@/lib/utils/field-errors";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Eye,
  EyeOff,
  Wand2,
  Loader2,
  Monitor,
  Smartphone,
  Globe,
  X,
  ShieldCheck,
  ShieldAlert,
  QrCode,
  Download,
  KeyRound,
} from "lucide-react";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1">
      {children}
    </h3>
  );
}

// i18n-dynamic: profile.security.sessions.*
/** Browser (brand name, null = other) and device type (null = unknown). */
function parseUserAgent(ua: string | null): { browser: string | null; device: "mobile" | "desktop" | null; icon: typeof Monitor } {
  if (!ua) return { browser: null, device: null, icon: Globe };
  const browser =
    ua.includes("Firefox") ? "Firefox" :
    ua.includes("Edg") ? "Edge" :
    ua.includes("Chrome") ? "Chrome" :
    ua.includes("Safari") ? "Safari" :
    null;
  const isMobile = /Mobile|Android|iPhone/i.test(ua);
  return {
    browser,
    device: isMobile ? "mobile" : "desktop",
    icon: isMobile ? Smartphone : Monitor,
  };
}

export function SecurityTab() {
  const t = useTranslations("profile");
  const tAuth = useTranslations("auth");
  const tc = useTranslations("common");
  const { formatDateTime } = useDateFormat();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();
  const { data: configData } = useConfig();
  const { data: session } = useSession();
  const changePassword = useChangeProfilePassword();
  const { data: sessions, isLoading: sessionsLoading } = useProfileSessions();
  const revokeSession = useRevokeSession();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [copiedPwd, setCopiedPwd] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // 2FA state
  const [twoFAStep, setTwoFAStep] = useState<"idle" | "password" | "qr" | "verify" | "backup" | "disable">("idle");
  const [twoFAPassword, setTwoFAPassword] = useState("");
  const [showTwoFAPwd, setShowTwoFAPwd] = useState(false);
  const [showDisablePwd, setShowDisablePwd] = useState(false);
  const [totpUri, setTotpUri] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [twoFAError, setTwoFAError] = useState("");
  const [twoFALoading, setTwoFALoading] = useState(false);

  const passwordPolicy = useMemo(
    () => policyFromConfig(configData ?? {}),
    [configData]
  );

  const twofactorRequired = configData?.TWOFACTOR_REQUIRED === "true";
  const is2FAObligatory = twofactorRequired || profile?.forceTwoFactor;
  const is2FAEnabled = profile?.twoFactorEnabled;

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) return;
    const strength = evaluatePassword(newPassword, passwordPolicy);
    if (!strength.valid) return;

    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
        onError: () => {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
      }
    );
  }

  async function handleEnable2FA() {
    setTwoFAError("");
    setTwoFALoading(true);
    try {
      const res = await fetch("/api/profile/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: twoFAPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || tc("status.error"));
      setTotpUri(data.totpURI);
      setTotpSecret(data.secret);
      setTwoFAStep("qr");
    } catch (err) {
      setTwoFAError(err instanceof Error ? err.message : tc("status.error"));
      setTwoFAPassword("");
    } finally {
      setTwoFALoading(false);
    }
  }

  async function handleVerify2FA(codeOverride?: string) {
    const code = codeOverride || totpCode;
    if (!code || code.length !== 6) return;
    setTwoFAError("");
    setTwoFALoading(true);
    try {
      const res = await fetch("/api/profile/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || tAuth("twoFactor.invalidCode"));
      setBackupCodes(data.backupCodes ?? []);
      setTwoFAStep("backup");
    } catch (err) {
      setTwoFAError(err instanceof Error ? err.message : tc("status.error"));
    } finally {
      setTwoFALoading(false);
    }
  }

  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);

  async function handleDisable2FA() {
    setDisableError("");
    setDisableLoading(true);
    try {
      const res = await fetch("/api/profile/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || tc("status.error"));
      setTwoFAStep("idle");
      setDisablePassword("");
      setDisableLoading(false);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      setDisableError(err instanceof Error ? err.message : tc("status.error"));
      setDisablePassword("");
      setDisableLoading(false);
    }
  }

  function downloadBackupCodes() {
    const text = `${tAuth("backupCodes.file.title")}\n${"=".repeat(30)}\n\n${backupCodes.join("\n")}\n\n${tAuth("backupCodes.file.usage")}\n${tAuth("backupCodes.file.keepSafe")}`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = tAuth("backupCodes.file.name");
    a.click();
    URL.revokeObjectURL(url);
  }

  const passwordsMatch = newPassword === confirmPassword;
  const passwordValid = newPassword.length > 0 && evaluatePassword(newPassword, passwordPolicy).valid;
  const canSubmitPwd = currentPassword.length > 0 && passwordValid && passwordsMatch;
  // Per-field errors returned by the API (`fields`: currentPassword, newPassword).
  const pwdFieldErrors = changePassword.error ? parseFieldErrors(changePassword.error) : {};

  // Current session token for identifying
  const currentSessionToken = session?.session?.id;

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Password change */}
      <div className="space-y-3">
        <SectionTitle>{t("security.password.title")}</SectionTitle>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">{t("security.password.current")}</Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrentPwd ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="pr-10"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrentPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {pwdFieldErrors.currentPassword && (
              <p className="text-xs text-destructive">{pwdFieldErrors.currentPassword}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password">{t("security.password.new")}</Label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Input
                  id="new-password"
                  type={showNewPwd ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowNewPwd(!showNewPwd)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                title={t("security.password.generate")}
                onClick={() => {
                  const pwd = generatePasswordFromConfig(configData ?? {});
                  setNewPassword(pwd);
                  setConfirmPassword(pwd);
                  setShowNewPwd(true);
                  navigator.clipboard.writeText(pwd).then(() => {
                    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
                    setCopiedPwd(true);
                    copiedTimerRef.current = setTimeout(() => setCopiedPwd(false), 3000);
                  }).catch(() => {});
                }}
              >
                <Wand2 className="h-4 w-4" />
              </Button>
            </div>
            {copiedPwd && (
              <p className="text-xs text-emerald-600">{t("security.password.copied")}</p>
            )}
            {newPassword && <PasswordStrengthBar password={newPassword} policy={passwordPolicy} />}
            {pwdFieldErrors.newPassword && (
              <p className="text-xs text-destructive">{pwdFieldErrors.newPassword}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">{t("security.password.confirm")}</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {confirmPassword && !passwordsMatch && (
              <p className="text-xs text-destructive">{t("security.password.mismatch")}</p>
            )}
          </div>

          {changePassword.error && Object.keys(pwdFieldErrors).length === 0 && (
            <p className="text-sm text-destructive">{changePassword.error.message}</p>
          )}
          {changePassword.isSuccess && (
            <p className="text-sm text-emerald-600">{t("security.password.success")}</p>
          )}

          <Button type="submit" disabled={!canSubmitPwd || changePassword.isPending}>
            {changePassword.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : null}
            {changePassword.isPending ? t("security.password.submitting") : t("security.password.submit")}
          </Button>
        </form>
      </div>

      {/* 2FA */}
      <div className="space-y-3">
        <SectionTitle>{t("security.twoFactor.title")}</SectionTitle>

        {is2FAEnabled && twoFAStep !== "disable" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-emerald-600" />
              <Badge variant="outline" className="border-emerald-600 text-emerald-600">
                {tc("states.enabled")}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("security.twoFactor.enabledDescription")}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!!is2FAObligatory}
              onClick={() => { setTwoFAStep("disable"); setDisablePassword(""); setDisableError(""); }}
              title={is2FAObligatory ? t("security.twoFactor.mandatoryTooltip") : undefined}
            >
              <X className="mr-1 h-4 w-4" />
              {t("security.twoFactor.disable")}
            </Button>
            {is2FAObligatory && (
              <p className="text-xs text-amber-600">
                {t("security.twoFactor.mandatoryNotice")}
              </p>
            )}
          </div>
        ) : twoFAStep === "disable" ? (
          <div className="space-y-3">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 space-y-3">
              <p className="text-sm font-medium text-destructive">{t("security.twoFactor.disable")}</p>
              <p className="text-xs text-muted-foreground">
                {t("security.twoFactor.disableDescription")}
              </p>
              <div className="relative">
                <Input
                  type={showDisablePwd ? "text" : "password"}
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder={t("security.twoFactor.currentPasswordPlaceholder")}
                  className="pr-10"
                  onKeyDown={(e) => e.key === "Enter" && disablePassword && handleDisable2FA()}
                  autoFocus
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowDisablePwd(!showDisablePwd)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showDisablePwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {disableError && <p className="text-xs text-destructive">{disableError}</p>}
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!disablePassword || disableLoading}
                  onClick={handleDisable2FA}
                >
                  {disableLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {t("security.twoFactor.confirmDisable")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setTwoFAStep("idle"); setDisablePassword(""); setDisableError(""); }}
                >
                  {tc("actions.cancel")}
                </Button>
              </div>
            </div>
          </div>
        ) : twoFAStep === "idle" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-muted-foreground" />
              <span className="text-sm">{t("security.twoFactor.notEnabled")}</span>
            </div>
            {is2FAObligatory && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/50">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {t("security.twoFactor.mandatoryEnable")}
                </p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {t("security.twoFactor.pitch")}
            </p>
            <Button onClick={() => setTwoFAStep("password")}>
              <KeyRound className="mr-1.5 h-4 w-4" />
              {t("security.twoFactor.enable")}
            </Button>
          </div>
        ) : twoFAStep === "password" ? (
          <div className="space-y-3">
            <p className="text-sm">{t("security.twoFactor.passwordPrompt")}</p>
            <div className="relative">
              <Input
                type={showTwoFAPwd ? "text" : "password"}
                value={twoFAPassword}
                onChange={(e) => setTwoFAPassword(e.target.value)}
                placeholder={t("security.twoFactor.currentPasswordPlaceholder")}
                className="pr-10"
                onKeyDown={(e) => e.key === "Enter" && twoFAPassword && handleEnable2FA()}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowTwoFAPwd(!showTwoFAPwd)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showTwoFAPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {twoFAError && <p className="text-sm text-destructive">{twoFAError}</p>}
            <div className="flex gap-2">
              <Button
                onClick={handleEnable2FA}
                disabled={!twoFAPassword || twoFALoading}
              >
                {twoFALoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {tc("actions.continue")}
              </Button>
              <Button variant="outline" onClick={() => { setTwoFAStep("idle"); setTwoFAPassword(""); setTwoFAError(""); }}>
                {tc("actions.cancel")}
              </Button>
            </div>
          </div>
        ) : twoFAStep === "qr" ? (
          <div className="space-y-4">
            <p className="text-sm">
              {t("security.twoFactor.scanQr")}
            </p>
            <div className="flex justify-center rounded-lg border bg-white p-4">
              <TwoFAQRCode uri={totpUri} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("security.twoFactor.manualEntry")}</p>
              <code className="block rounded bg-muted px-3 py-1.5 text-sm font-mono select-all">
                {totpSecret}
              </code>
            </div>
            <div className="space-y-1.5">
              <Label>{t("security.twoFactor.codeLabel")}</Label>
              <InputOTP
                maxLength={6}
                value={totpCode}
                onChange={(value) => {
                  setTotpCode(value);
                  if (value.length === 6) {
                    setTimeout(() => handleVerify2FA(value), 100);
                  }
                }}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} className="h-12 w-12 text-xl" />
                  <InputOTPSlot index={1} className="h-12 w-12 text-xl" />
                  <InputOTPSlot index={2} className="h-12 w-12 text-xl" />
                </InputOTPGroup>
                <span className="text-muted-foreground text-xl">-</span>
                <InputOTPGroup>
                  <InputOTPSlot index={3} className="h-12 w-12 text-xl" />
                  <InputOTPSlot index={4} className="h-12 w-12 text-xl" />
                  <InputOTPSlot index={5} className="h-12 w-12 text-xl" />
                </InputOTPGroup>
              </InputOTP>
            </div>
            {twoFAError && <p className="text-sm text-destructive">{twoFAError}</p>}
            {twoFALoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("security.twoFactor.verifying")}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => { setTwoFAStep("idle"); setTotpCode(""); setTwoFAError(""); }}>
              {tc("actions.cancel")}
            </Button>
          </div>
        ) : twoFAStep === "backup" ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-600">{t("security.twoFactor.enabledSuccess")}</span>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/50">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">
                {tAuth("backupCodes.title")}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                {t("security.twoFactor.backupHelp")}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {backupCodes.map((code, i) => (
                  <code key={i} className="rounded bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-mono text-center">
                    {code}
                  </code>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={downloadBackupCodes} variant="outline" size="sm">
                <Download className="mr-1.5 h-4 w-4" />
                {tAuth("backupCodes.download")}
              </Button>
              <Button
                onClick={() => { setTwoFAStep("idle"); queryClient.invalidateQueries({ queryKey: ["profile"] }); }}
                size="sm"
              >
                {tc("actions.finish")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Active sessions */}
      <div className="space-y-3">
        <SectionTitle>{t("security.sessions.title")}</SectionTitle>
        {sessionsLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <div className="space-y-2">
            {sessions?.map((s: any) => {
              const { browser, device, icon: DeviceIcon } = parseUserAgent(s.userAgent);
              const isCurrentSession = s.id === currentSessionToken;
              const createdAt = formatDateTime(s.createdAt);
              const browserLabel = browser ?? (s.userAgent ? t("security.sessions.otherBrowser") : tc("states.unknown"));
              const deviceLabel = device ? t(`security.sessions.${device}`) : tc("states.unknown");

              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <DeviceIcon className="size-5 text-muted-foreground" />
                    <div className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{browserLabel} — {deviceLabel}</span>
                        {isCurrentSession && (
                          <Badge variant="outline" className="text-xs border-emerald-600 text-emerald-600">
                            {t("security.sessions.current")}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("security.sessions.meta", { ip: s.ipAddress ?? t("security.sessions.unknownIp"), date: createdAt })}
                      </div>
                    </div>
                  </div>
                  {!isCurrentSession && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={revokeSession.isPending}
                      onClick={() => revokeSession.mutate(s.id)}
                    >
                      <X className="mr-1 h-4 w-4" />
                      {t("security.sessions.revoke")}
                    </Button>
                  )}
                </div>
              );
            })}
            {sessions?.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("security.sessions.empty")}</p>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function TwoFAQRCode({ uri }: { uri: string }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { QRCodeSVG } = require("qrcode.react");
  return <QRCodeSVG value={uri} size={200} />;
}
