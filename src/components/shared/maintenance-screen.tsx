"use client";

import { useTranslations } from "next-intl";
import { Wrench } from "lucide-react";

const GEAR_STYLE = `
@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes spin-slow-reverse {
  from { transform: rotate(0deg); }
  to { transform: rotate(-360deg); }
}
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
@keyframes pulse-ring {
  0% { transform: scale(0.8); opacity: 0.5; }
  50% { transform: scale(1); opacity: 0.15; }
  100% { transform: scale(0.8); opacity: 0.5; }
}
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

function GearSVG({ size, className, reverse }: { size: number; className?: string; reverse?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ animation: `${reverse ? "spin-slow-reverse" : "spin-slow"} ${reverse ? "8s" : "6s"} linear infinite` }}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function MaintenanceScreen() {
  const t = useTranslations("ui.maintenance");
  return (
    <>
      <style>{GEAR_STYLE}</style>
      <div className="flex flex-1 items-center justify-center h-full w-full relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <GearSVG size={120} className="absolute -top-6 -right-6 text-muted-foreground/[0.07]" />
          <GearSVG size={80} className="absolute top-16 right-20 text-muted-foreground/[0.05]" reverse />
          <GearSVG size={100} className="absolute -bottom-8 -left-8 text-muted-foreground/[0.06]" reverse />
          <GearSVG size={60} className="absolute bottom-20 left-16 text-muted-foreground/[0.04]" />
          <GearSVG size={50} className="absolute top-1/4 left-1/4 text-muted-foreground/[0.03]" />
          <GearSVG size={70} className="absolute bottom-1/4 right-1/4 text-muted-foreground/[0.04]" reverse />
        </div>

        {/* Main content */}
        <div
          className="relative flex flex-col items-center gap-6 text-center max-w-lg px-6"
          style={{ animation: "fade-in-up 0.6s ease-out" }}
        >
          {/* Icon with pulsing ring */}
          <div className="relative" style={{ animation: "float 3s ease-in-out infinite" }}>
            <div
              className="absolute inset-0 rounded-full bg-amber-500/20 dark:bg-amber-400/20"
              style={{ animation: "pulse-ring 2s ease-in-out infinite", margin: "-12px" }}
            />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/25">
              <Wrench className="h-10 w-10 text-white" />
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-2xl font-bold tracking-tight">
              {t("title")}
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              {t("description")}
            </p>
          </div>

          {/* Animated progress dots */}
          <div className="flex items-center gap-1.5 mt-2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-full bg-amber-500 dark:bg-amber-400"
                style={{
                  animation: "pulse-ring 1.4s ease-in-out infinite",
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground/60 mt-4">
            {t("retryLater")}
          </p>
        </div>
      </div>
    </>
  );
}
