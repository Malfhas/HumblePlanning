"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft, ShieldOff, Lock, WifiOff, ServerCrash, Ban, AlertTriangle } from "lucide-react";

/** Texts: `ui.errorState.<kind>.title|description` (displayed code = HTTP status, or `unknown.code`). */
type ErrorKind = "forbidden" | "unauthenticated" | "unavailable" | "badGateway" | "rateLimited" | "unknown";

const ERROR_CONFIG: Record<string, {
  code: string | null;
  kind: ErrorKind;
  icon: typeof ShieldOff;
  color: string;
}> = {
  "403": { code: "403", kind: "forbidden", icon: ShieldOff, color: "text-amber-500" },
  "401": { code: "401", kind: "unauthenticated", icon: Lock, color: "text-amber-500" },
  "503": { code: "503", kind: "unavailable", icon: WifiOff, color: "text-blue-500" },
  "502": { code: "502", kind: "badGateway", icon: ServerCrash, color: "text-red-500" },
  "429": { code: "429", kind: "rateLimited", icon: Ban, color: "text-orange-500" },
  default: { code: null, kind: "unknown", icon: AlertTriangle, color: "text-muted-foreground" },
};

interface ErrorStateProps {
  code?: string | number;
  title?: string;
  description?: string;
  showBack?: boolean;
  showHome?: boolean;
  compact?: boolean;
}

export function ErrorState({
  code = "403",
  title,
  description,
  showBack = true,
  showHome = true,
  compact = false,
}: ErrorStateProps) {
  const t = useTranslations("ui.errorState");
  const tBack = useTranslations("common.actions");
  const tHome = useTranslations("layout.nav");
  const router = useRouter();
  const config = ERROR_CONFIG[String(code)] || ERROR_CONFIG.default;
  // i18n-dynamic: ui.errorState.*
  const displayCode = config.code ?? t("unknown.code");
  const displayTitle = title || t(`${config.kind}.title`);
  const displayDesc = description || t(`${config.kind}.description`); // i18n-ignore dynamic key

  if (compact) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="select-none text-[5rem] font-black leading-none tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-muted-foreground/15 to-muted-foreground/5">
          {displayCode}
        </div>
        <div className="mt-3 text-center">
          <h2 className="text-lg font-semibold text-foreground">{displayTitle}</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">{displayDesc}</p>
        </div>
        {(showBack || showHome) && (
          <div className="flex gap-2 mt-5">
            {showBack && (
              <Button variant="outline" size="sm" onClick={() => router.back()}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                {tBack("back")}
              </Button>
            )}
            {showHome && (
              <Button size="sm" onClick={() => router.push("/planning")}>
                <Home className="mr-1.5 h-3.5 w-3.5" />
                {tHome("home")}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-16 -right-16 h-64 w-64 rounded-full bg-muted/30" />
        <div className="absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-muted/30" />
      </div>

      <div className="relative w-full max-w-lg text-center space-y-8">
        <div>
          <div className="select-none text-[10rem] font-black leading-none tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-muted-foreground/15 to-muted-foreground/5">
            {displayCode}
          </div>
          <div className="mt-4">
            <h1 className="text-2xl font-bold text-foreground">{displayTitle}</h1>
            <p className="text-muted-foreground text-sm mt-1">{displayDesc}</p>
          </div>
        </div>

        {(showBack || showHome) && (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {showBack && (
              <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {tBack("back")}
              </Button>
            )}
            {showHome && (
              <Button onClick={() => router.push("/planning")}>
                <Home className="mr-2 h-4 w-4" />
                {tHome("home")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
