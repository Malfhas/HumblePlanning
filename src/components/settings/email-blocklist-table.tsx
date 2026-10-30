"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useEmailBlocklist, useUnblockEmail } from "@/hooks/use-email-blocklist";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { Mail, ShieldCheck, AlertCircle, Search } from "lucide-react";
import { useDateFormat } from "@/hooks/use-date-format";

interface Props {
  isActive: boolean;
}

export function EmailBlocklistTable({ isActive }: Props) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { formatDateTime } = useDateFormat();
  const { data, isLoading } = useEmailBlocklist();
  const unblockMutation = useUnblockEmail();
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; email: string } | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((e) =>
      e.email.toLowerCase().includes(q) ||
      (e.userLogin?.toLowerCase().includes(q) ?? false) ||
      (e.userName?.toLowerCase().includes(q) ?? false) ||
      e.reason.toLowerCase().includes(q) ||
      (e.reasonDetail?.toLowerCase().includes(q) ?? false)
    );
  }, [data, search]);

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-4 p-4 border-b">
        <div className="flex items-center gap-2 shrink-0">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">{t("blocklist.title")}</h4>
          {data && data.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {search ? `${filtered.length}/${data.length}` : data.length}
            </Badge>
          )}
        </div>
        {data && data.length > 0 && (
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t("blocklist.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-7 text-xs"
            />
          </div>
        )}
      </div>

      {!isActive && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {t("blocklist.inactive")}
        </div>
      )}

      {isLoading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{tc("states.loading")}</div>
      ) : !data || data.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-green-500/50" />
          {t("blocklist.empty")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {tc("states.noResultsFor", { search })}
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead>{t("blocklist.columns.email")}</TableHead>
              <TableHead>{t("blocklist.columns.user")}</TableHead>
              <TableHead>{t("blocklist.columns.reason")}</TableHead>
              <TableHead>{t("blocklist.columns.date")}</TableHead>
              <TableHead>{t("blocklist.columns.source")}</TableHead>
              <TableHead className="text-right">{t("blocklist.columns.action")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-mono text-xs">{entry.email}</TableCell>
                <TableCell>
                  {entry.userLogin ? (
                    <span className="text-sm">{entry.userLogin}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {entry.reason === "bounce" ? (
                    <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30">{t("blocklist.reasons.bounce")}</Badge>
                  ) : entry.reason === "complaint" ? (
                    <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30">{t("blocklist.reasons.complaint")}</Badge>
                  ) : (
                    <Badge variant="outline">{entry.reason}</Badge>
                  )}
                  {entry.reasonDetail && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[200px]" title={entry.reasonDetail}>
                      {entry.reasonDetail}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {formatDateTime(entry.blockedAt)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">{entry.source}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmTarget({ id: entry.id, email: entry.email })}
                    disabled={unblockMutation.isPending}
                  >
                    {t("blocklist.unblock")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}

      <DeleteConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        onConfirm={async () => {
          if (!confirmTarget) return;
          await unblockMutation.mutateAsync(confirmTarget.id);
          setConfirmTarget(null);
        }}
        title={t("blocklist.confirm.title")}
        description={t("blocklist.confirm.description", { email: confirmTarget?.email ?? "" })}
        confirmLabel={t("blocklist.unblock")}
      />
    </div>
  );
}
