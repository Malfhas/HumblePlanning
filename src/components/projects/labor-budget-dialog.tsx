"use client";

import { useProjectLaborBudgets } from "@/hooks/use-project-labor-budgets";
import { useProject } from "@/hooks/use-projects";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, HardHat } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/hooks/use-date-format";

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
    </div>
  );
}

function getBarColor(pct: number): string {
  if (pct > 100) return "bg-red-500";
  if (pct > 80) return "bg-amber-500";
  return "bg-emerald-500";
}

interface LaborBudgetDialogProps {
  projectId: string | null;
  onClose: () => void;
}

export function LaborBudgetDialog({ projectId, onClose }: LaborBudgetDialogProps) {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const { formatNumber } = useDateFormat();
  const hours = (value: number) => t("laborBudget.hours", { value: formatNumber(value) });
  const { data: project } = useProject(projectId);
  const { data: budgets, isLoading } = useProjectLaborBudgets(projectId);

  const rows = (budgets ?? []).map((b) => {
    const planned = parseFloat(b.plannedHours);
    const consumed = b.consumed ?? 0;
    const upcoming = b.upcoming ?? 0;
    const remaining = Math.round((planned - consumed - upcoming) * 100) / 100;
    const pctReal = planned > 0 ? Math.round((consumed / planned) * 100) : 0;
    const pctForecast = planned > 0 ? Math.round(((consumed + upcoming) / planned) * 100) : 0;
    return { ...b, planned, consumed, upcoming, remaining, pctReal, pctForecast };
  });

  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0);
  const totalConsumed = rows.reduce((s, r) => s + r.consumed, 0);
  const totalUpcoming = rows.reduce((s, r) => s + r.upcoming, 0);
  const totalRemaining = Math.round((totalPlanned - totalConsumed - totalUpcoming) * 100) / 100;
  const totalPctReal = totalPlanned > 0 ? Math.round((totalConsumed / totalPlanned) * 100) : 0;
  const totalPctForecast = totalPlanned > 0 ? Math.round(((totalConsumed + totalUpcoming) / totalPlanned) * 100) : 0;

  return (
    <Dialog open={!!projectId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardHat className="h-5 w-5" />
            {t("laborBudget.dialogTitle", { name: (project as any)?.name ?? t("laborBudget.projectFallback") })}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !budgets || budgets.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            {t("laborBudget.empty")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-3 py-2.5 font-medium">{t("laborBudget.columns.type")}</th>
                    <th className="text-right px-3 py-2.5 font-medium">{t("laborBudget.columns.planned")}</th>
                    <th className="text-right px-3 py-2.5 font-medium">{t("laborBudget.columns.consumed")}</th>
                    <th className="text-right px-3 py-2.5 font-medium">{t("laborBudget.columns.upcoming")}</th>
                    <th className="text-right px-3 py-2.5 font-medium">{t("laborBudget.columns.remaining")}</th>
                    <th className="px-3 py-2.5 font-medium w-32">{t("laborBudget.columns.actualProgress")}</th>
                    <th className="px-3 py-2.5 font-medium w-32">{t("laborBudget.columns.forecastProgress")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-[10px] uppercase px-1.5 py-0.5">
                            {r.laborType?.initials}
                          </Badge>
                          <span className="font-medium">{r.laborType?.name}</span>
                        </div>
                      </td>
                      <td className="text-right px-3 py-3 font-medium">{hours(r.planned)}</td>
                      <td className="text-right px-3 py-3">{hours(r.consumed)}</td>
                      <td className="text-right px-3 py-3">{hours(r.upcoming)}</td>
                      <td className={`text-right px-3 py-3 font-medium ${r.remaining < 0 ? "text-red-500" : ""}`}>
                        {hours(r.remaining)}
                      </td>
                      <td className="px-3 py-3">
                        <ProgressBar pct={r.pctReal} color={getBarColor(r.pctReal)} />
                      </td>
                      <td className="px-3 py-3">
                        <ProgressBar pct={r.pctForecast} color="bg-blue-500" />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 font-semibold border-t-2">
                    <td className="px-3 py-3">{tc("table.total")}</td>
                    <td className="text-right px-3 py-3">{hours(totalPlanned)}</td>
                    <td className="text-right px-3 py-3">{hours(totalConsumed)}</td>
                    <td className="text-right px-3 py-3">{hours(totalUpcoming)}</td>
                    <td className={`text-right px-3 py-3 ${totalRemaining < 0 ? "text-red-500" : ""}`}>
                      {hours(totalRemaining)}
                    </td>
                    <td className="px-3 py-3">
                      <ProgressBar pct={totalPctReal} color={getBarColor(totalPctReal)} />
                    </td>
                    <td className="px-3 py-3">
                      <ProgressBar pct={totalPctForecast} color="bg-blue-500" />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-2.5 rounded-sm bg-emerald-500" />
                {t("laborBudget.legend.actualLow")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-2.5 rounded-sm bg-amber-500" />
                {t("laborBudget.legend.actualHigh")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-2.5 rounded-sm bg-red-500" />
                {t("laborBudget.legend.overrun")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-2.5 rounded-sm bg-blue-500" />
                {t("laborBudget.legend.forecast")}
              </span>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={onClose}>{tc("actions.close")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
