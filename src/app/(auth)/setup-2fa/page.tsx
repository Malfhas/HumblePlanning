"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck, Download, KeyRound } from "lucide-react";
import { getRedirectFromLocation } from "@/lib/utils/safe-redirect";

function TwoFAQRCode({ uri }: { uri: string }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { QRCodeSVG } = require("qrcode.react");
  return <QRCodeSVG value={uri} size={200} />;
}

export default function SetupTwoFAPage() {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [step, setStep] = useState<"password" | "qr" | "verify" | "backup">("password");
  const [password, setPassword] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleEnable() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/profile/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || tc("status.error"));
      setTotpUri(data.totpURI);
      setTotpSecret(data.secret);
      setStep("qr");
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("status.error"));
      setPassword("");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(codeOverride?: string) {
    const code = codeOverride || totpCode;
    if (!code || code.length !== 6) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/profile/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("twoFactor.invalidCode"));
      setBackupCodes(data.backupCodes ?? []);
      setStep("backup");
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("status.error"));
    } finally {
      setLoading(false);
    }
  }

  function downloadBackupCodes() {
    const text = `${t("backupCodes.file.title")}\n${"=".repeat(30)}\n\n${backupCodes.join("\n")}\n\n${t("backupCodes.file.usage")}`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = t("backupCodes.file.name");
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card/95 backdrop-blur-sm p-10 shadow-xl">
      <div className="mb-6 text-center">
        <KeyRound className="mx-auto h-10 w-10 text-amber-500 mb-3" />
        <h1 className="text-2xl font-bold">{t("setup2fa.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("setup2fa.description")}
        </p>
      </div>

      {step === "password" && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("fields.password")}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("setup2fa.passwordPlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && password && handleEnable()}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={handleEnable} disabled={!password || loading}>
            {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {tc("actions.continue")}
          </Button>
        </div>
      )}

      {step === "qr" && (
        <div className="space-y-4">
          <p className="text-sm text-center">
            {t("setup2fa.scanQr")}
          </p>
          <div className="flex justify-center rounded-lg border bg-white p-4">
            <TwoFAQRCode uri={totpUri} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("setup2fa.manualSecret")}</p>
            <code className="block rounded bg-muted px-3 py-1.5 text-sm font-mono select-all text-center">
              {totpSecret}
            </code>
          </div>
          <div className="space-y-1.5">
            <Label>{t("setup2fa.codeLabel")}</Label>
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={totpCode}
                onChange={(value) => {
                  setTotpCode(value);
                  if (value.length === 6) {
                    setTimeout(() => handleVerify(value), 100);
                  }
                }}
                autoFocus
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
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("twoFactor.verifying")}
            </div>
          )}
        </div>
      )}

      {step === "backup" && (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2">
            <ShieldCheck className="size-5 text-emerald-600" />
            <span className="font-medium text-emerald-600">{t("setup2fa.enabled")}</span>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/50">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">
              {t("backupCodes.title")}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
              {t("backupCodes.help")}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {backupCodes.map((code, i) => (
                <code key={i} className="rounded bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-mono text-center">
                  {code}
                </code>
              ))}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={downloadBackupCodes} className="w-full">
            <Download className="mr-1.5 h-4 w-4" />
            {t("backupCodes.download")}
          </Button>
          {/* Step reached after interaction: reading window.location without hydration risk */}
          <Button className="w-full" onClick={() => router.push(getRedirectFromLocation() || "/planning")}>
            {getRedirectFromLocation() ? tc("actions.continue") : t("setup2fa.continueToPlanning")}
          </Button>
        </div>
      )}
    </div>
  );
}
