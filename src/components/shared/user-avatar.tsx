"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, contrastColor } from "@/lib/utils";

interface UserAvatarProps {
  user: {
    name: string;
    image?: string | null;
    color?: string | null;
  };
  className?: string;
  fallbackClassName?: string;
}

export function UserAvatar({ user, className, fallbackClassName }: UserAvatarProps) {
  const initials = (user.name ?? "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const bgColor = user.color || "#6b7280";
  const textColor = contrastColor(bgColor);

  return (
    <Avatar className={cn("size-7", className)}>
      {user.image && (
        <AvatarImage
          src={`/api/avatars/${user.image.replace("avatars/", "")}`}
          alt={user.name}
        />
      )}
      <AvatarFallback
        className={cn("text-xs font-medium", fallbackClassName)}
        style={{ backgroundColor: bgColor, color: textColor }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
