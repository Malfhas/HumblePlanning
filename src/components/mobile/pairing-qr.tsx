"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, QrCode } from "lucide-react";
import { throwIfNotOk } from "@/lib/api-client";
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
 * created as soon as it is shown. Once expired, or when it could not be
 * created, a button creates a new one.
 */
export function PairingQr({ size = 200, className }: { size?: number; className?: string }) {
  const t = useTranslations("mobile.profile");
  const [link, setLink] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    requestPairingLink()
      .then((value) => { if (!cancelled) setLink(value); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // A code past its validity is useless: replaced by the expired state
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(() => setExpired(true), CODE_VALIDITY_MS);
    return () => clearTimeout(timer);
  }, [link]);

  async function regenerate() {
    setLoading(true);
    setFailed(false);
    try {
      const value = await requestPairingLink();
      setExpired(false);
      setLink(value);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const regenerateButton = (
    <Button variant="outline" size="sm" disabled={loading} onClick={regenerate}>
      {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <QrCode className="mr-1 h-4 w-4" />}
      {t("regenerate")}
    </Button>
  );

  return (
    <div className={cn("flex flex-col items-start gap-3", className)}>
      {failed ? (
        <>
          <p className="text-sm text-destructive">{t("error")}</p>
          {regenerateButton}
        </>
      ) : link && expired ? (
        <>
          <p className="text-sm text-muted-foreground">{t("expired")}</p>
          {regenerateButton}
        </>
      ) : link ? (
        <>
          <div className="rounded-md bg-white p-3">
            <QRCodeSVG value={link} size={size} />
          </div>
          <p className="text-sm text-muted-foreground">{t("instructions")}</p>
        </>
      ) : (
        <div className="flex items-center justify-center rounded-md border border-dashed" style={{ width: size + 24, height: size + 24 }}>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
