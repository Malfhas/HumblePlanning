"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, QrCode } from "lucide-react";
import { ApiClientError, throwIfNotOk } from "@/lib/api-client";
import { cooldownSecondsLeft } from "@/lib/utils/pairing-cooldown";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Validity of a code, as on the server (PAIRING_TTL_MS in mobile-service.ts), counted from its display. */
const CODE_VALIDITY_MS = 5 * 60 * 1000;

async function requestPairingLink(): Promise<string> {
  const response = await fetch("/api/mobile/pairing", { method: "POST" });
  await throwIfNotOk(response);
  return (await response.json() as { link: string }).link;
}

/**
 * QR code that signs the mobile app in (single use, valid five minutes),
 * created as soon as it is shown. A button under it creates a new one, at most
 * every 30 seconds; once expired, or when it could not be created, at once.
 */
export function PairingQr({ size = 200, className }: { size?: number; className?: string }) {
  const t = useTranslations("mobile.profile");
  const [link, setLink] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  /** The error of the last request, or null. */
  const [failure, setFailure] = useState<unknown>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const secondsLeft = cooldownSecondsLeft(generatedAt, now);

  useEffect(() => {
    let cancelled = false;
    requestPairingLink()
      .then((value) => { if (!cancelled) { setLink(value); setGeneratedAt(Date.now()); } })
      .catch((error: unknown) => { if (!cancelled) setFailure(error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // The countdown of the button, while it runs
  useEffect(() => {
    if (secondsLeft === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  // A code past its validity is useless: replaced by the expired state
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(() => setExpired(true), CODE_VALIDITY_MS);
    return () => clearTimeout(timer);
  }, [link]);

  async function regenerate() {
    setLoading(true);
    setFailure(null);
    try {
      const value = await requestPairingLink();
      setExpired(false);
      setLink(value);
      setGeneratedAt(Date.now());
      setNow(Date.now());
    } catch (error) {
      setFailure(error);
    } finally {
      setLoading(false);
    }
  }

  /** Under a valid code, the wait applies; an expired or failed code is replaced at once. */
  const regenerateButton = (withCooldown: boolean) => {
    const waiting = withCooldown && secondsLeft > 0;
    return (
      <Button variant="outline" size="sm" disabled={loading || waiting} onClick={regenerate}>
        {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <QrCode className="mr-1 h-4 w-4" />}
        {waiting ? t("regenerateIn", { seconds: secondsLeft }) : t("regenerate")}
      </Button>
    );
  };

  return (
    <div className={cn("flex flex-col items-start gap-3", className)}>
      {failure ? (
        <>
          {/* Too many codes: the server says when to try again */}
          <p className="text-sm text-destructive">
            {failure instanceof ApiClientError && failure.code === "errors.rateLimited" ? failure.message : t("error")}
          </p>
          {regenerateButton(false)}
        </>
      ) : link && expired ? (
        <>
          <p className="text-sm text-muted-foreground">{t("expired")}</p>
          {regenerateButton(false)}
        </>
      ) : link ? (
        <>
          <div className="rounded-md bg-white p-3">
            <QRCodeSVG value={link} size={size} />
          </div>
          <p className="text-sm text-muted-foreground">{t("instructions")}</p>
          {regenerateButton(true)}
        </>
      ) : (
        <div className="flex items-center justify-center rounded-md border border-dashed" style={{ width: size + 24, height: size + 24 }}>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
