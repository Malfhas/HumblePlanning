"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, QrCode } from "lucide-react";
import { throwIfNotOk } from "@/lib/api-client";
import { useConfig } from "@/hooks/use-config";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";

/**
 * Signs the mobile app in by scanning a QR code: single-use, valid five minutes.
 * Renders its section title itself, so the whole section disappears when QR sign-in is off.
 */
export function MobileAppCard({ title }: { title: ReactNode }) {
  const t = useTranslations("mobile.profile");
  const { data: config } = useConfig();
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const { can } = usePermissions();

  if (!can("mobile_app:use")) {
    return (
      <div className="space-y-3">
        {title}
        <p className="text-sm text-muted-foreground">{t("notAllowed")}</p>
      </div>
    );
  }
  if (config?.MOBILE_PAIRING_ENABLED === "false") return null;

  async function showCode() {
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch("/api/mobile/pairing", { method: "POST" });
      await throwIfNotOk(response);
      const data = await response.json() as { link: string };
      setLink(data.link);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {title}
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {link ? (
        <div className="flex flex-col items-start gap-3">
          <div className="rounded-md bg-white p-3">
            <QRCodeSVG value={link} size={200} />
          </div>
          <p className="text-sm text-muted-foreground">{t("instructions")}</p>
          <Button variant="outline" size="sm" onClick={() => setLink(null)}>{t("hide")}</Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" disabled={loading} onClick={showCode}>
          {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <QrCode className="mr-1 h-4 w-4" />}
          {t("show")}
        </Button>
      )}
      {failed && <p className="text-sm text-destructive">{t("error")}</p>}
    </div>
  );
}
