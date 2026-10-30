"use client";

import { useMemo, useState, useCallback } from "react";
import { useAuditLogs, useRestoreAudit, type AuditLog } from "@/hooks/use-audit";
import { useUsers } from "@/hooks/use-users";
import { useProjects } from "@/hooks/use-projects";
import { useStatuses } from "@/hooks/use-statuses";
import { usePlaces } from "@/hooks/use-places";
import { useResources } from "@/hooks/use-resources";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RotateCcw, Check, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";
import { useAuditLabels } from "@/hooks/use-audit-labels";
import { cn } from "@/lib/utils";
import {
  type LookupMaps,
  type AuditLogEntry,
} from "@/lib/constants/audit-labels";
import { AuditDetailPopover } from "@/components/shared/audit-detail-popover";

type AuditLabels = ReturnType<typeof useAuditLabels>;
type AuditT = ReturnType<typeof useTranslations<"audit">>;

function getChangedFieldLabels(log: AuditLogEntry, audit: AuditLabels, tAudit: AuditT): string[] {
  if (log.action === "email_sent") {
    const meta = log.metadata as Record<string, unknown> | null;
    return [tAudit("changes.recipients", { count: Number(meta?.recipientCount ?? 0) })];
  }
  if (log.action === "file_upload" || log.action === "file_delete") {
    const vals = (log.newValues ?? log.oldValues ?? {}) as Record<string, unknown>;
    return vals.fileName ? [String(vals.fileName)] : [];
  }
  if (["create", "copy", "delete", "login", "login_fail", "restore"].includes(log.action)) return [];
  if (!log.newValues) return [];
  return Object.keys(log.newValues as Record<string, unknown>).map((k) => audit.fieldLabel(k));
}

interface TaskAuditHistoryProps {
  taskId: string;
  canRestore?: boolean;
}

export function TaskAuditHistory({ taskId, canRestore = false }: TaskAuditHistoryProps) {
  const t = useTranslations("taskForm.history");
  const tAudit = useTranslations("audit");
  const tCommon = useTranslations("common");
  const audit = useAuditLabels();
  const { formatDateTime } = useDateFormat();
  const { data, isLoading } = useAuditLogs({ entityType: "task", entityId: taskId, limit: 50, page: 1 });
  const { data: usersData } = useUsers(undefined, false);
  const { data: projectsData } = useProjects(undefined, true);
  const { data: statusesData } = useStatuses();
  const { data: placesData } = usePlaces();
  const { data: resourcesData } = useResources();
  const restoreAudit = useRestoreAudit();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const maps = useMemo<LookupMaps>(() => {
    const projectMap = new Map<string, string>();
    const userMap = new Map<string, string>();
    const statusMap = new Map<string, string>();
    const placeMap = new Map<string, string>();
    const resourceMap = new Map<string, string>();
    if (projectsData) {
      for (const p of projectsData) projectMap.set(p.id, p.name);
    }
    if (usersData) {
      for (const u of usersData) userMap.set(u.id, [u.firstName, u.name].filter(Boolean).join(" ") || t("unnamed"));
    }
    if (statusesData) {
      for (const s of statusesData) statusMap.set(s.id, s.name);
    }
    if (placesData) {
      for (const p of placesData) placeMap.set(p.id, p.name);
    }
    if (resourcesData) {
      for (const r of resourcesData) resourceMap.set(r.id, r.name);
    }
    return { projectMap, userMap, statusMap, placeMap, resourceMap, entityNameMap: data?.entityNames ?? {} };
  }, [projectsData, usersData, statusesData, placesData, resourcesData, data?.entityNames, t]);

  const logs = data?.data ?? [];

  const handleRestore = useCallback((id: string) => {
    restoreAudit.mutate(id, { onSuccess: () => setConfirmingId(null) });
  }, [restoreAudit]);

  if (isLoading) return <p className="text-xs text-muted-foreground py-2">{tCommon("states.loading")}</p>;
  if (logs.length === 0) return <p className="text-xs text-muted-foreground py-2">{t("empty")}</p>;

  return (
    <div className="space-y-0.5 max-h-[250px] overflow-auto">
      {logs.map((log) => {
        const actionInfo = { label: audit.actionLabel(log.action), className: audit.actionClassName(log.action) };
        const fieldLabels = getChangedFieldLabels(log, audit, tAudit);
        const isRestorable = canRestore
          && (log.action === "update" || log.action === "delete" || log.action === "move" || log.action === "resize")
          && !!log.oldValues;
        const isConfirming = confirmingId === log.id;

        return (
          <div key={log.id} className="rounded px-2 py-1.5 hover:bg-muted/50">
            <div className="flex items-center gap-1.5 text-xs min-w-0">
              <Badge variant="outline" className={cn(actionInfo.className, "text-[10px] shrink-0")}>
                {actionInfo.label}
              </Badge>
              {fieldLabels.length > 0 && (
                <span className="text-muted-foreground truncate min-w-0">
                  {fieldLabels.join(", ")}
                </span>
              )}
              <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                <AuditDetailPopover log={log} maps={maps} />
                {isRestorable && !isConfirming && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setConfirmingId(log.id)}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{tCommon("actions.restore")}</TooltipContent>
                  </Tooltip>
                )}
                {isConfirming && (
                  <div className="flex items-center gap-0.5">
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">{t("restoreConfirm")}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-green-600 hover:text-green-700 hover:bg-green-100 dark:hover:bg-green-900/30"
                      disabled={restoreAudit.isPending}
                      onClick={() => handleRestore(log.id)}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      disabled={restoreAudit.isPending}
                      onClick={() => setConfirmingId(null)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 mt-0.5 pl-0.5">
              <span>{formatDateTime(log.timestamp)}</span>
              <span>·</span>
              <span>{log.user ? [(log.user as any).firstName, log.user.name].filter(Boolean).join(" ") || "—" : "—"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
