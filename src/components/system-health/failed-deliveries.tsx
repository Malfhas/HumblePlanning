"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFailedDeliveries } from "@/hooks/use-system-health";
import { useDateFormat } from "@/hooks/use-date-format";
import { tDyn } from "@/i18n/dynamic";

// i18n-dynamic: admin.systemHealth.periods.*
// i18n-dynamic: admin.systemHealth.deliveries.webhookStatus.*

const PERIODS = ["1", "7", "30", "all"] as const;

function DeliveryTable({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header} className="whitespace-nowrap">{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={headers.length} className="h-16 text-center text-muted-foreground">{empty}</TableCell>
            </TableRow>
          ) : (
            rows.map((cells, index) => (
              <TableRow key={index}>
                {cells.map((cell, column) => (
                  <TableCell key={column} className="text-sm align-top">{cell}</TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Failed e-mails, SMS and webhooks (bad signature, unreadable payload) over a period. */
export function FailedDeliveries({ enabled }: { enabled: boolean }) {
  const t = useTranslations("admin.systemHealth");
  const { formatDateTime } = useDateFormat();
  const [days, setDays] = useState("7");
  const { data } = useFailedDeliveries(days, enabled);
  const emails = data?.emails ?? [];
  const sms = data?.sms ?? [];
  const webhooks = data?.webhooks ?? [];
  const date = (value: string) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(value)}</span>;
  const error = (value: string | null) => <span className="block min-w-[200px] max-w-[480px] break-words text-destructive">{value || "—"}</span>;
  const address = (value: string) => <span className="break-all">{value}</span>;
  const code = (value: string) => <span className="font-mono text-xs">{value}</span>;
  const emailRows = emails.map((e) => [date(e.at), address(e.recipient), e.subject ?? "—", error(e.error)]);
  const smsRows = sms.map((s) => [date(s.at), address(s.recipient), error(s.error)]);
  const webhookRows = webhooks.map((w) => [date(w.at), w.provider, code(w.eventType), tDyn(t, `deliveries.webhookStatus.${w.status}`), error(w.error)]);

  return (
    <Tabs defaultValue="emails" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="emails">{t("deliveries.tabs.emails", { count: emails.length })}</TabsTrigger>
          <TabsTrigger value="sms">{t("deliveries.tabs.sms", { count: sms.length })}</TabsTrigger>
          <TabsTrigger value="webhooks">{t("deliveries.tabs.webhooks", { count: webhooks.length })}</TabsTrigger>
        </TabsList>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger size="sm" className="w-[160px] text-xs" aria-label={t("incidents.filters.period")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">{tDyn(t, `periods.${p}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <TabsContent value="emails">
        <DeliveryTable
          headers={[t("deliveries.columns.date"), t("deliveries.columns.recipient"), t("deliveries.columns.subject"), t("deliveries.columns.error")]}
          rows={emailRows}
          empty={t("deliveries.empty")}
        />
      </TabsContent>
      <TabsContent value="sms">
        <DeliveryTable
          headers={[t("deliveries.columns.date"), t("deliveries.columns.recipient"), t("deliveries.columns.error")]}
          rows={smsRows}
          empty={t("deliveries.empty")}
        />
      </TabsContent>
      <TabsContent value="webhooks">
        <DeliveryTable
          headers={[t("deliveries.columns.date"), t("deliveries.columns.provider"), t("deliveries.columns.event"), t("deliveries.columns.status"), t("deliveries.columns.error")]}
          rows={webhookRows}
          empty={t("deliveries.empty")}
        />
      </TabsContent>
    </Tabs>
  );
}
