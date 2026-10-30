"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useProfile, useUpdatePreferences } from "@/hooks/use-profile";
import { usePermissions } from "@/hooks/use-permissions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1">
      {children}
    </h3>
  );
}

type HomePageId = "home" | "planning" | "tasks" | "projects" | "users" | "teams" | "resources" | "vehicles" | "audit" | "settings";

// i18n-dynamic: profile.preferences.homePages.*
/** Available home pages; label `profile.preferences.homePages.<id>`. */
const HOME_PAGES: { value: string; id: HomePageId }[] = [
  { value: "/home", id: "home" },
  { value: "/planning", id: "planning" },
  { value: "/tasks", id: "tasks" },
  { value: "/projects", id: "projects" },
  { value: "/users", id: "users" },
  { value: "/teams", id: "teams" },
  { value: "/resources", id: "resources" },
  { value: "/vehicles", id: "vehicles" },
  { value: "/audit", id: "audit" },
  { value: "/settings", id: "settings" },
];

export function PreferencesTab() {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const { data: profile, isLoading } = useProfile();
  const { can } = usePermissions();
  const updatePreferences = useUpdatePreferences();
  const { setTheme } = useTheme();

  const [form, setForm] = useState({
    defaultView: "users" as string,
    columnView: "days" as string,
    defaultHomePage: "/planning" as string,
    notifications: false,
    pushNotifications: false,
    smsNotifications: false,
    theme: "system" as string,
  });

  const [initialForm, setInitialForm] = useState(form);

  useEffect(() => {
    if (profile) {
      const prefs = profile.preferences ?? {};
      // If admin disabled notifications, force user preference to false
      const adminEmail = profile.notifications ?? false;
      const adminPush = profile.pushNotifications ?? false;
      const adminSms = (profile as any).smsNotifications ?? false;
      const userEmail = (profile as any).notificationsUser ?? true;
      const userPush = (profile as any).pushNotificationsUser ?? true;
      const userSms = (profile as any).smsNotificationsUser ?? true;
      const loaded = {
        defaultView: prefs.defaultView ?? "users",
        columnView: prefs.columnView ?? "days",
        defaultHomePage: prefs.defaultHomePage ?? "/planning",
        notifications: adminEmail && userEmail,
        pushNotifications: adminPush && userPush,
        smsNotifications: adminSms && userSms,
        theme: prefs.theme ?? "system",
      };
      setForm(loaded);
      setInitialForm(loaded);
    }
  }, [profile]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  const adminEmailEnabled = profile?.notifications ?? false;
  const adminPushEnabled = profile?.pushNotifications ?? false;
  const adminSmsEnabled = (profile as any)?.smsNotifications ?? false;

  function handleSave() {
    updatePreferences.mutate(form, {
      onSuccess: () => {
        setTheme(form.theme);
      },
    });
  }

  // Filter home pages by permissions
  const PAGE_PERM: Record<string, string> = {
    "/home": "pages:home",
    "/planning": "pages:planning",
    "/tasks": "pages:tasks",
    "/projects": "pages:projects",
    "/users": "pages:users",
    "/teams": "pages:teams",
    "/resources": "pages:resources",
    "/vehicles": "pages:vehicles",
    "/audit": "pages:audit",
    "/settings": "pages:settings",
  };
  const availablePages = HOME_PAGES.filter((p) => {
    const perm = PAGE_PERM[p.value];
    return !perm || can(perm);
  });

  // Auto-correct: if the current preference is no longer allowed, switch to
  // the first available page (or /home as ultimate fallback).
  // Also update initialForm so this auto-correction doesn't make the form dirty.
  useEffect(() => {
    const allowed = availablePages.map((p) => p.value);
    if (allowed.length > 0 && !allowed.includes(form.defaultHomePage)) {
      const corrected = allowed[0];
      setForm((prev) => ({ ...prev, defaultHomePage: corrected }));
      setInitialForm((prev) => ({ ...prev, defaultHomePage: corrected }));
    }
  }, [availablePages, form.defaultHomePage]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-3">
        <SectionTitle>{t("preferences.sections.display")}</SectionTitle>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>{t("preferences.homePage")}</Label>
            <Select value={form.defaultHomePage} onValueChange={(v) => setForm({ ...form, defaultHomePage: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availablePages.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {t(`preferences.homePages.${p.id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("preferences.defaultView")}</Label>
            <Select value={form.defaultView} onValueChange={(v) => setForm({ ...form, defaultView: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="users">{t("preferences.views.users")}</SelectItem>
                <SelectItem value="projects">{t("preferences.views.projects")}</SelectItem>
                <SelectItem value="resources">{t("preferences.views.resources")}</SelectItem>
                <SelectItem value="vehicles">{t("preferences.views.vehicles")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("preferences.columnView")}</Label>
            <Select value={form.columnView} onValueChange={(v) => setForm({ ...form, columnView: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="days">{t("preferences.columns.days")}</SelectItem>
                <SelectItem value="hours">{t("preferences.columns.hours")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("preferences.theme")}</Label>
            <Select value={form.theme} onValueChange={(v) => setForm({ ...form, theme: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("preferences.themes.system")}</SelectItem>
                <SelectItem value="light">{t("preferences.themes.light")}</SelectItem>
                <SelectItem value="dark">{t("preferences.themes.dark")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <SectionTitle>{t("preferences.sections.notifications")}</SectionTitle>
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="pref-notifications" className={!adminEmailEnabled ? "text-muted-foreground" : ""}>
              {t("preferences.emailNotifications")}
            </Label>
            {!adminEmailEnabled && (
              <span className="text-xs text-muted-foreground">{t("preferences.disabledByAdmin")}</span>
            )}
          </div>
          <Switch
            id="pref-notifications"
            checked={form.notifications}
            disabled={!adminEmailEnabled}
            onCheckedChange={(checked) => setForm({ ...form, notifications: !!checked })}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="pref-push-notifications" className={!adminPushEnabled ? "text-muted-foreground" : ""}>
              {t("preferences.pushNotifications")}
            </Label>
            {!adminPushEnabled && (
              <span className="text-xs text-muted-foreground">{t("preferences.disabledByAdmin")}</span>
            )}
          </div>
          <Switch
            id="pref-push-notifications"
            checked={form.pushNotifications}
            disabled={!adminPushEnabled}
            onCheckedChange={(checked) => setForm({ ...form, pushNotifications: !!checked })}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="pref-sms-notifications" className={!adminSmsEnabled ? "text-muted-foreground" : ""}>
              {t("preferences.smsNotifications")}
            </Label>
            {!adminSmsEnabled && (
              <span className="text-xs text-muted-foreground">{t("preferences.disabledByAdmin")}</span>
            )}
          </div>
          <Switch
            id="pref-sms-notifications"
            checked={form.smsNotifications}
            disabled={!adminSmsEnabled}
            onCheckedChange={(checked) => setForm({ ...form, smsNotifications: !!checked })}
          />
        </div>
      </div>

      {updatePreferences.error && (
        <p className="text-sm text-destructive">{updatePreferences.error.message}</p>
      )}
      {updatePreferences.isSuccess && (
        <p className="text-sm text-emerald-600">{t("preferences.saved")}</p>
      )}

      <Button onClick={handleSave} disabled={!dirty || updatePreferences.isPending}>
        {updatePreferences.isPending ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Save className="mr-1 h-4 w-4" />
        )}
        {updatePreferences.isPending ? tc("actions.saving") : tc("actions.save")}
      </Button>
    </div>
  );
}
