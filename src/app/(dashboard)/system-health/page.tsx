"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useSystemOverview } from "@/hooks/use-system-health";
import { usePermissions } from "@/hooks/use-permissions";
import { ErrorState } from "@/components/shared/error-state";
import { ConfigAlerts, LiveStatus, ScheduledTasks } from "@/components/system-health/overview-sections";
import { IncidentsSection } from "@/components/system-health/incidents-section";
import { FailedDeliveries } from "@/components/system-health/failed-deliveries";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default function SystemHealthPage() {
  const t = useTranslations("admin.systemHealth");
  const tc = useTranslations("common");
  const { can, isLoading: permLoading } = usePermissions();
  const allowed = !permLoading && can("pages:system_health");
  const overview = useSystemOverview(allowed);

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:system_health")) return <ErrorState code={403} compact showBack={false} />;

  const loading = (
    <div className="flex justify-center py-6">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <Section title={t("sections.live")}>
        {overview.data ? <LiveStatus data={overview.data} receivedAt={overview.dataUpdatedAt} /> : loading}
      </Section>

      <Section title={t("sections.alerts")}>
        {overview.data ? <ConfigAlerts alerts={overview.data.alerts} /> : loading}
      </Section>

      <Section title={t("sections.tasks")} description={t("sections.tasksDescription")}>
        {overview.data ? <ScheduledTasks tasks={overview.data.tasks} /> : loading}
      </Section>

      <Section title={t("sections.incidents")} description={t("sections.incidentsDescription")}>
        <IncidentsSection enabled={allowed} />
      </Section>

      <Section title={t("sections.deliveries")}>
        <FailedDeliveries enabled={allowed} />
      </Section>
    </div>
  );
}
