"use client";

import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { useAuditLabels } from "@/hooks/use-audit-labels";
import {
  sortFieldsByOrder,
  getProjectId,
  getUserIds,
  type LookupMaps,
  type AuditLogEntry,
} from "@/lib/constants/audit-labels";

interface RestoreConfirmDialogProps {
  log: AuditLogEntry | null;
  entityName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => void;
  isPending: boolean;
  maps: LookupMaps;
  cascadeLogs: AuditLogEntry[];
}

export function RestoreConfirmDialog({
  log,
  entityName,
  onOpenChange,
  onConfirm,
  isPending,
  maps,
  cascadeLogs,
}: RestoreConfirmDialogProps) {
  const t = useTranslations("admin.restore");
  const tc = useTranslations("common");
  const { formatDateTime } = useDateFormat();
  const audit = useAuditLabels();
  const { fieldLabel, resolveValue } = audit;
  if (!log) return null;

  const oldV = (log.oldValues ?? {}) as Record<string, unknown>;
  const newV = (log.newValues ?? {}) as Record<string, unknown>;
  const isDelete = log.action === "delete";
  const actionInfo = { label: audit.actionLabel(log.action), className: audit.actionClassName(log.action) };
  const entityLabel = audit.entityLabel(log.entityType);
  const projectId = getProjectId(log);
  const userIds = getUserIds(log);

  const fields = sortFieldsByOrder(
    isDelete
      ? Object.keys(oldV).filter((k) => k !== "id")
      : Object.keys(newV)
  );

  return (
    <AlertDialog open={!!log} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-foreground">{t("entityLine", { entity: entityLabel, name: entityName })}</span>
                <Badge variant="outline" className={actionInfo.className}>{actionInfo.label}</Badge>
              </div>
              {projectId && (
                <div className="text-sm">{t("project", { name: maps.projectMap.get(projectId) ?? projectId.slice(0, 8) })}</div>
              )}
              {userIds.length > 0 && (
                <div className="text-sm">
                  {t("assignedTo", { names: userIds.map((id) => maps.userMap.get(id) ?? "?").join(", ") })}
                </div>
              )}
              {cascadeLogs.length > 0 && (
                <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-400 space-y-1">
                  <div className="font-medium">{t("cascade", { count: cascadeLogs.length })}</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {cascadeLogs.map((cl) => {
                      const clChanges = cl.action === "delete"
                        ? ""
                        : cl.newValues
                          ? Object.keys(cl.newValues as Record<string, unknown>).map((k) => fieldLabel(k)).join(", ")
                          : "";
                      return (
                        <li key={cl.id}>
                          <span className="font-medium">{audit.actionLabel(cl.action)}</span>
                          {clChanges && <span className="text-amber-600 dark:text-amber-500"> — {clChanges}</span>}
                          <span className="text-amber-600/70 dark:text-amber-500/70"> ({formatDateTime(cl.timestamp)})</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-md border overflow-auto max-h-[300px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">{t("columns.field")}</TableHead>
                <TableHead>{t("columns.current")}</TableHead>
                <TableHead>{t("columns.restored")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field) => (
                <TableRow key={field}>
                  <TableCell className="font-medium text-xs">{fieldLabel(field)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {isDelete ? <span className="italic text-red-500">{t("deleted")}</span> : resolveValue(field, newV[field], maps)}
                  </TableCell>
                  <TableCell className="text-xs font-medium">
                    {resolveValue(field, oldV[field], maps)}
                  </TableCell>
                </TableRow>
              ))}
              {fields.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground text-sm">
                    {t("noChanges")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{tc("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={() => onConfirm(log.id)}
            className="bg-violet-600 text-white hover:bg-violet-700"
          >
            {tc("actions.restore")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
