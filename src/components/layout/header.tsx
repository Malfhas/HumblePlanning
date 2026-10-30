"use client";

import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { NotificationBell } from "./notification-bell";
import { BuSelector } from "./bu-selector";
import { useSidebarStore } from "./sidebar";
import { usePermissions } from "@/hooks/use-permissions";

export function Header() {
  const { setMobileOpen } = useSidebarStore();
  const { can } = usePermissions();
  const t = useTranslations("common.a11y");

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label={t("openMenu")}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
        >
          <Menu className="size-5" />
        </button>
        <BuSelector />
      </div>
      <div className="flex items-center gap-1">
        <LocaleSwitcher />
        <ThemeToggle />
        {can("notifications:view") && <NotificationBell />}
        <UserMenu />
      </div>
    </header>
  );
}
