"use client";

import { useState, useCallback, useRef } from "react";
import { useLogs, useClearLogs } from "@/hooks/use-logs";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/shared/error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Trash2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import type { LogLevel, LogCategory, LogEntry } from "@/lib/logger";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";

const LEVEL_COLORS: Record<LogLevel, string> = {
  ERROR: "text-red-400",
  WARN: "text-amber-400",
  INFO: "text-blue-400",
  DEBUG: "text-zinc-500",
};

const LEVEL_BG: Record<LogLevel, string> = {
  ERROR: "bg-red-500/15 text-red-400 border-red-500/30",
  WARN: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  INFO: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  DEBUG: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
};

const CATEGORIES: LogCategory[] = ["system", "auth", "api", "socket", "db", "email", "mcp", "ai_chat", "backup"];
const LEVELS: LogLevel[] = ["ERROR", "WARN", "INFO", "DEBUG"];

function formatTimestamp(ts: string, intlTag: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(intlTag, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function LogLine({ entry }: { entry: LogEntry }) {
  const { intlTag } = useDateFormat();
  const [expanded, setExpanded] = useState(false);
  const hasDetails = entry.metadata || entry.stack;

  return (
    <div
      className={cn(
        "font-mono text-[13px] leading-relaxed px-3 py-0.5 hover:bg-white/5 cursor-default border-l-2 border-transparent",
        entry.level === "ERROR" && "border-l-red-500/50",
        entry.level === "WARN" && "border-l-amber-500/50",
      )}
      onClick={() => hasDetails && setExpanded(!expanded)}
    >
      <span className="text-zinc-600 select-none">{formatTimestamp(entry.timestamp, intlTag)} </span>
      <span className={cn("font-semibold", LEVEL_COLORS[entry.level])}>
        {entry.level.padEnd(5)}
      </span>
      <span className="text-purple-400"> [{entry.category}] </span>
      <span className="text-zinc-300">{entry.message}</span>
      {hasDetails && !expanded && (
        <span className="text-zinc-600 ml-1 text-xs">...</span>
      )}
      {expanded && entry.metadata && (
        <div className="mt-1 ml-8 text-xs text-zinc-500 whitespace-pre-wrap">
          {JSON.stringify(entry.metadata, null, 2)}
        </div>
      )}
      {expanded && entry.stack && (
        <div className="mt-1 ml-8 text-xs text-red-400/70 whitespace-pre-wrap">
          {entry.stack}
        </div>
      )}
    </div>
  );
}

export default function LogsPage() {
  const t = useTranslations("admin.logs");
  const tc = useTranslations("common");
  const { can, isLoading: permLoading } = usePermissions();
  const queryClient = useQueryClient();
  const clearLogs = useClearLogs();

  const [level, setLevel] = useState<LogLevel | "">("");
  const [category, setCategory] = useState<LogCategory | "">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 400);
  }, []);

  const { data, isLoading } = useLogs(
    {
      ...(level && { level }),
      ...(category && { category }),
      ...(search && { search }),
      limit: 500,
    },
    !permLoading && can("pages:audit"),
  );

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:audit")) return <ErrorState code={403} compact showBack={false} />;

  const entries = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-mono">
            {t("entries", { count: data?.total ?? 0 })}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            title={tc("actions.refresh")}
            aria-label={tc("actions.refresh")}
            onClick={() => queryClient.invalidateQueries({ queryKey: ["logs"] })}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {can("audit:purge") && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setClearOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {t("clear")}
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tc("actions.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="h-9 pl-8 w-[220px]"
          />
        </div>

        <Select value={level} onValueChange={(v) => setLevel(v as LogLevel | "")}>
          <SelectTrigger className="h-9 w-[130px]">
            <SelectValue placeholder={t("levelPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allLevels")}</SelectItem>
            {LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                <span className={LEVEL_COLORS[l]}>{l}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={(v) => setCategory(v as LogCategory | "")}>
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue placeholder={t("categoryPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allCategories")}</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Terminal view */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 dark:bg-zinc-950 overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
          <span className="ml-2 text-xs text-zinc-500 font-mono">system-logs</span>
        </div>

        <div className="overflow-auto flex-1 min-h-0">
          {isLoading ? (
            <div className="p-4 text-zinc-500 font-mono text-sm">{t("loading")}</div>
          ) : entries.length === 0 ? (
            <div className="p-4 text-zinc-600 font-mono text-sm">{t("empty")}</div>
          ) : (
            <div className="py-1">
              {entries.map((entry, i) => (
                <LogLine key={`${entry.timestamp}-${i}`} entry={entry} />
              ))}
            </div>
          )}
        </div>

        {/* Level summary footer */}
        {entries.length > 0 && (
          <div className="flex items-center gap-3 px-3 py-1.5 bg-zinc-900 border-t border-zinc-800 shrink-0">
            {LEVELS.map((l) => {
              const count = entries.filter((e) => e.level === l).length;
              if (count === 0) return null;
              return (
                <Badge key={l} variant="outline" className={cn("text-[10px] font-mono", LEVEL_BG[l])}>
                  {l}: {count}
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      {/* Clear confirmation */}
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clearDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("clearDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                clearLogs.mutate(undefined, { onSuccess: () => setClearOpen(false) });
              }}
            >
              {t("clear")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
