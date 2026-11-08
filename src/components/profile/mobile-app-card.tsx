"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { QrCode } from "lucide-react";
import { useConfig } from "@/hooks/use-config";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { PairingQr } from "@/components/mobile/pairing-qr";

/**
 * Signs the mobile app in by scanning a QR code: single-use, valid five minutes.
 * Renders its section title itself, so the whole section disappears when QR sign-in is off.
 */
export function MobileAppCard({ title }: { title: ReactNode }) {
  const t = useTranslations("mobile.profile");
  const { data: config } = useConfig();
  const [open, setOpen] = useState(false);
  const { can, permissionsLoading } = usePermissions();

  // Nothing until the permissions are known: "not allowed" must not flash
  if (permissionsLoading) return null;
  if (!can("mobile_app:use")) {
    return (
      <div className="space-y-3">
        {title}
        <p className="text-sm text-muted-foreground">{t("notAllowed")}</p>
      </div>
    );
  }
  if (config?.MOBILE_PAIRING_ENABLED === "false") return null;

  return (
    <div className="space-y-3">
      {title}
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      {open ? (
        <div className="flex flex-col items-start gap-3">
          <PairingQr />
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{t("hide")}</Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <QrCode className="mr-1 h-4 w-4" />
          {t("show")}
        </Button>
      )}
    </div>
  );
}
