"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Loader2, HardDrive, FileText, Database, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { throwIfNotOk } from "@/lib/api-client";
import { useDateFormat } from "@/hooks/use-date-format";
import { INTL_TAG, type AppLocale } from "@/i18n/config";

/** Size unit symbols per language (octet / byte). */
const SIZE_UNITS: Record<AppLocale, readonly [string, string, string, string]> = {
  fr: ["o", "Ko", "Mo", "Go"],
  en: ["B", "KB", "MB", "GB"],
  es: ["B", "KB", "MB", "GB"],
  de: ["B", "KB", "MB", "GB"],
};

/** Human-readable size in the given language (« 1,5 Mo » / « 1.5 MB »): pass `useDateFormat().locale`. */
export function formatSize(bytes: number, locale: AppLocale): string {
  const [b, kb, mb, gb] = SIZE_UNITS[locale] ?? SIZE_UNITS.fr;
  const one = (n: number) => new Intl.NumberFormat(INTL_TAG[locale] ?? INTL_TAG.fr, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
  if (bytes < 1024) return `${bytes} ${b}`;
  if (bytes < 1024 * 1024) return `${one(bytes / 1024)} ${kb}`;
  if (bytes < 1024 * 1024 * 1024) return `${one(bytes / (1024 * 1024))} ${mb}`;
  return `${one(bytes / (1024 * 1024 * 1024))} ${gb}`;
}

interface UserStorage {
  userId: string;
  userName: string;
  userColor: string;
  fileCount: number;
  totalSize: number;
}

interface StorageData {
  totalFiles: number;
  totalSize: number;
  taskCount: number;
  diskFree: number;
  diskTotal: number;
  diskUsed: number;
  perUser: UserStorage[];
}

function useStorageStats() {
  return useQuery({
    queryKey: ["storage-stats"],
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const res = await fetch("/api/storage");
      await throwIfNotOk(res);
      return await res.json() as StorageData;
    },
  });
}

export function StorageStats({ className }: { className?: string }) {
  const t = useTranslations("settings");
  const { locale } = useDateFormat();
  const { data, isLoading } = useStorageStats();

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("stats.loading")}
      </div>
    );
  }

  return (
    <div className={cn("border rounded-lg p-4 space-y-4", className ?? "max-w-2xl")}>
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <HardDrive className="h-4 w-4" />
        {t("storage.title")}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-lg font-semibold">{data.totalFiles}</p>
            <p className="text-xs text-muted-foreground">
              {t("storage.filesOnTasks", { files: data.totalFiles, tasks: data.taskCount })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-lg font-semibold">{formatSize(data.totalSize, locale)}</p>
            <p className="text-xs text-muted-foreground">{t("storage.attachments")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function UserStorageChart({ className }: { className?: string } = {}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { locale } = useDateFormat();
  const { data, isLoading } = useStorageStats();

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        {tc("states.loading")}
      </div>
    );
  }

  const users = data.perUser ?? [];
  const maxSize = users[0]?.totalSize ?? 0;

  return (
    <div className={cn("border rounded-lg p-4 space-y-3", className ?? "max-w-2xl")}>
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Users className="h-4 w-4" />
        {t("storage.perUser")}
      </h3>

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("storage.empty")}</p>
      ) : (
        <div className="space-y-2">
          {users.map((user) => {
            const percent = maxSize > 0 ? (user.totalSize / maxSize) * 100 : 0;
            return (
              <div key={user.userId} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate mr-2">{user.userName}</span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {t("storage.userFiles", { size: formatSize(user.totalSize, locale), count: user.fileCount })}
                  </span>
                </div>
                <div className="h-4 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(percent, 2)}%`,
                      backgroundColor: user.userColor,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
