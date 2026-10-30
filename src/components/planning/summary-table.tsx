"use client";

import { useMemo } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import type { TaskWithUsers } from "@/types";

interface SummaryTableProps {
  rows: { id: string; label: string }[];
  tasks: TaskWithUsers[];
  rowKey: string;
  width?: string;
}

export function SummaryTable({ rows, tasks, rowKey, width }: SummaryTableProps) {
  const t = useTranslations("planning.summary");
  const tc = useTranslations("common");
  const summary = useMemo(() => {
    const map = new Map<string, { count: number; days: number }>();

    for (const row of rows) {
      map.set(row.id, { count: 0, days: 0 });
    }

    for (const task of tasks) {
      const days = (() => {
        const start = parseISO(task.startDate);
        const end = task.endDate ? parseISO(task.endDate) : start;
        return differenceInCalendarDays(end, start) + 1;
      })();

      if (rowKey === "users") {
        // Multi-user: count once per assigned user
        const taskUsers = task.users ?? [];
        for (const u of taskUsers) {
          const entry = map.get(u.id);
          if (!entry) continue;
          entry.count += 1;
          entry.days += days;
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rid = (task as any)[rowKey] as string | null | undefined;
        if (!rid || !map.has(rid)) continue;
        const entry = map.get(rid)!;
        entry.count += 1;
        entry.days += days;
      }
    }

    return map;
  }, [rows, tasks, rowKey]);

  const totals = useMemo(() => {
    let totalCount = 0;
    let totalDays = 0;
    for (const v of summary.values()) {
      totalCount += v.count;
      totalDays += v.days;
    }
    return { totalCount, totalDays };
  }, [summary]);

  if (rows.length === 0) return null;

  return (
    <div className="border-t bg-muted/30" style={{ width: width ?? "100%" }}>
      <div className="flex">
        <div
          className="sticky left-0 z-10 flex items-center shrink-0 border-r bg-background px-3 text-xs font-semibold"
          style={{ width: "var(--sidebar-width)", minWidth: "var(--sidebar-width)", minHeight: 32 }}
        >
          {tc("table.total")}
        </div>
        <div className="flex items-center gap-4 px-4 text-xs text-muted-foreground">
          <span>
            {t.rich("tasks", { count: totals.totalCount, b: (c) => <strong className="text-foreground">{c}</strong> })}
          </span>
          <span>
            {t.rich("days", { count: totals.totalDays, b: (c) => <strong className="text-foreground">{c}</strong> })}
          </span>
        </div>
      </div>
    </div>
  );
}
