"use client";

import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "next-intl";
import { useAuditLabels } from "@/hooks/use-audit-labels";
import {
  sortFieldsByOrder,
  type LookupMaps,
  type AuditLogEntry,
} from "@/lib/constants/audit-labels";

interface AuditDetailPopoverProps {
  log: AuditLogEntry;
  maps: LookupMaps;
}

export function AuditDetailPopover({ log, maps }: AuditDetailPopoverProps) {
  const t = useTranslations("admin.auditDetail");
  const { fieldLabel, resolveValue } = useAuditLabels();
  const oldV = (log.oldValues ?? {}) as Record<string, unknown>;
  const newV = (log.newValues ?? {}) as Record<string, unknown>;
  const meta = (log.metadata ?? {}) as Record<string, unknown>;

  // Determine what to show based on action type
  if (log.action === "login" || log.action === "login_fail") {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t("details")}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-60" align="end">
          <div className="text-sm space-y-1">
            {meta.email ? <div><span className="text-muted-foreground">{t("email")}</span> {String(meta.email)}</div> : null}
            {meta.ip ? <div><span className="text-muted-foreground">{t("ip")}</span> {String(meta.ip)}</div> : null}
            {meta.userAgent ? <div className="truncate"><span className="text-muted-foreground">{t("userAgent")}</span> {String(meta.userAgent)}</div> : null}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  if (log.action === "email_sent") {
    const recipients = (meta.recipients ?? []) as string[];
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t("details")}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="end">
          <div className="text-sm space-y-1">
            <div><span className="text-muted-foreground">{t("type")}</span> {String(meta.eventType ?? "—")}</div>
            <div><span className="text-muted-foreground">{t("recipients")}</span></div>
            <ul className="list-disc pl-4 text-xs">
              {recipients.map((email, i) => <li key={i}>{email}</li>)}
            </ul>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // For create: show all newValues
  // For delete: show all oldValues
  // For update/move/resize: show before/after comparison
  const isCreate = log.action === "create" || log.action === "copy";
  const isDelete = log.action === "delete";
  const isUpdate = !isCreate && !isDelete;

  const fields = sortFieldsByOrder(
    isDelete
      ? Object.keys(oldV).filter((k) => k !== "id")
      : Object.keys(newV).filter((k) => k !== "id")
  );

  if (fields.length === 0 && !meta.fileName) {
    // file_upload / file_delete
    if (log.action === "file_upload" || log.action === "file_delete") {
      const fName = (newV.fileName ?? oldV.fileName ?? "—") as string;
      return (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-60" align="end">
            <div className="text-sm">
              <span className="text-muted-foreground">{t("file")}</span> {fName}
            </div>
          </PopoverContent>
        </Popover>
      );
    }
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="end">
        <div className="max-h-60 overflow-auto" onWheel={(e) => e.stopPropagation()}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px] text-xs">{t("columns.field")}</TableHead>
                {isUpdate && <TableHead className="text-xs">{t("columns.before")}</TableHead>}
                <TableHead className="text-xs">{isUpdate ? t("columns.after") : t("columns.value")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field) => (
                <TableRow key={field}>
                  <TableCell className="font-medium text-xs py-1">{fieldLabel(field)}</TableCell>
                  {isUpdate && (
                    <TableCell className="text-xs text-muted-foreground py-1">
                      {resolveValue(field, oldV[field], maps)}
                    </TableCell>
                  )}
                  <TableCell className="text-xs py-1">
                    {isDelete
                      ? resolveValue(field, oldV[field], maps)
                      : resolveValue(field, newV[field], maps)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PopoverContent>
    </Popover>
  );
}
