"use client";

import { contrastColor } from "@/lib/utils";

interface GridHeaderRowProps {
  name: string;
  color: string;
  width: string;
}

export function GridHeaderRow({ name, color, width }: GridHeaderRowProps) {
  return (
    <div
      className="flex items-center h-7"
      style={{ width, backgroundColor: color }}
    >
      <div
        className="sticky left-0 z-10 px-3 text-xs font-semibold truncate"
        style={{ color: contrastColor(color), width: "var(--sidebar-width)" }}
      >
        {name}
      </div>
    </div>
  );
}
