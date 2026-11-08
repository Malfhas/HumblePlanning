"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { Download, Smartphone } from "lucide-react";
import { useConfig } from "@/hooks/use-config";
import { usePermissions } from "@/hooks/use-permissions";
import { DEFAULT_MOBILE_STORE_URL } from "@/lib/utils/app-version";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PairingQr } from "@/components/mobile/pairing-qr";

/**
 * Header shortcut to the mobile app, shown when QR sign-in is on and the role
 * may use the app: where to download it, then the QR code that signs it in.
 * Hidden on phones, where the profile keeps the QR code.
 */
export function MobileAppButton() {
  const t = useTranslations("mobile.quickAccess");
  const { data: config } = useConfig();
  const { can, permissionsLoading } = usePermissions();
  const [open, setOpen] = useState(false);

  if (!config || permissionsLoading || !can("mobile_app:use") || config.MOBILE_PAIRING_ENABLED === "false") return null;
  const storeUrl = config.MOBILE_STORE_URL?.trim() || DEFAULT_MOBILE_STORE_URL;

  return (
    <>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-9 sm:inline-flex"
              onClick={() => setOpen(true)}
              aria-label={t("button")}
            >
              <Smartphone className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("button")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 sm:grid-cols-2">
            <section className="flex flex-col items-center gap-3 text-center">
              <h3 className="text-sm font-semibold">{t("installTitle")}</h3>
              <div className="rounded-md bg-white p-3">
                <QRCodeSVG value={storeUrl} size={160} />
              </div>
              <p className="text-sm text-muted-foreground">{t("installText")}</p>
              <Button variant="outline" size="sm" asChild>
                <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-1 h-4 w-4" />
                  {t("download")}
                </a>
              </Button>
            </section>
            <section className="flex flex-col items-center gap-3 text-center">
              <h3 className="text-sm font-semibold">{t("signInTitle")}</h3>
              {/* Created when the window opens, so each opening shows a fresh code */}
              <PairingQr size={160} className="items-center" />
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
