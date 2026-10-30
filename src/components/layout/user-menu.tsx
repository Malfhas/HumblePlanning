"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "@/lib/auth-client";
import { clearLocalSession } from "@/lib/session-cleanup";
import { LogOut, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useProfile } from "@/hooks/use-profile";

export function UserMenu() {
  const t = useTranslations("layout.userMenu");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();

  const displayName = [profile?.firstName, profile?.name].filter(Boolean).join(" ") || t("fallbackName");
  const userEmail = profile?.email ?? "";

  const avatarUser = {
    name: displayName,
    image: profile?.image ?? null,
    color: profile?.color ?? null,
  };

  async function handleSignOut() {
    // Invalidate Better Auth session server-side first so a race with a relog
    // can't leave stale tokens around.
    await signOut();
    // Then purge all client-side state (React Query cache, Zustand stores,
    // localStorage, sessionStorage) so the next account starts clean.
    queryClient.clear();
    clearLocalSession();
    // Hard reload to /login to reset any in-memory state still held by
    // mounted components (BU selector, permissions hook, etc.).
    window.location.href = "/login";
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-label={t("ariaLabel")}>
          <UserAvatar user={avatarUser} />
          {/* Mobile: avatar only (the header overflowed with the full name) */}
          <span className="hidden text-sm sm:inline">{displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Mobile: the name is no longer shown next to the avatar */}
        <DropdownMenuItem disabled className="text-sm font-medium sm:hidden">
          {displayName}
        </DropdownMenuItem>
        {userEmail && (
          <>
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              {userEmail}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => router.push("/profile")}>
          <UserCog className="mr-2 size-4" />
          {t("account")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="mr-2 size-4" />
          {t("logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
