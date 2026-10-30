"use client";

import React, { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfig, useUpdateConfig, parseConfigMeta } from "@/hooks/use-config";
import { Loader2, Save, Send, Upload, X, CheckCircle2, XCircle, ChevronDown, Check, Sun, Moon, CalendarDays, Download, Trash2, HardDrive, ShieldCheck, ShieldX, Database, Wifi, WifiOff, Radio, KeyRound, AlertTriangle, ShieldAlert, UploadCloud, Merge, Replace } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimePicker } from "@/components/shared/time-picker";
import { parseISO, format } from "date-fns";
import { useTranslations } from "next-intl";
import { tDyn, hasDyn } from "@/i18n/dynamic";
import { legalTextMessageKey } from "@/lib/constants/legal-text-defaults";
import { useDateFormat } from "@/hooks/use-date-format";
import { useApiErrorMessage } from "@/hooks/use-api-error-message";
import { throwIfNotOk } from "@/lib/api-client";
import { StorageStats, formatSize } from "@/components/shared/storage-stats";
import { EmailStats } from "@/components/shared/email-stats";
import { WebhookStatusCard } from "@/components/settings/webhook-status-card";
import { WebhookLogsTable } from "@/components/settings/webhook-logs-table";
import { EmailBlocklistTable } from "@/components/settings/email-blocklist-table";
import { AiChatSettingsPanel } from "@/components/settings/ai-chat-settings-panel";
import { AiChatQuotasPanel } from "@/components/settings/ai-chat-quotas-panel";
import { SmsStats } from "@/components/shared/sms-stats";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Menu, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { clearLocalSession } from "@/lib/session-cleanup";
import { useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/use-permissions";
import { useBackups, useCreateBackup, useDeleteBackup, useDownloadBackup } from "@/hooks/use-backups";
import { useAnalyzeImport, useExecuteImport, useCleanupImport, type ImportAnalysis } from "@/hooks/use-import";
import { useAnalyzeMigration, useExecuteMigration, useCleanupMigration, type MigrationAnalysis, type MigrationResult } from "@/hooks/use-migration";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { ColorPicker } from "@/components/shared/color-picker";
import { IconPicker } from "@/components/shared/icon-picker";
import { ErrorState } from "@/components/shared/error-state";
import { DeleteConfirmDialog } from "@/components/shared/delete-confirm-dialog";
import { VersionPanel } from "@/components/settings/version-panel";

// Labels resolved at render time from the identifiers (`settings` catalog):
// i18n-dynamic: settings.categories.*
// i18n-dynamic: settings.nav.*
// i18n-dynamic: settings.sections.*
// i18n-dynamic: settings.fields.*
// i18n-dynamic: settings.timezones.*
// i18n-dynamic: settings.options.*
// i18n-dynamic: settings.panels.import.tables.*
// i18n-dynamic: settings.panels.migration.entities.*
// i18n-dynamic: settings.panels.migration.warnings.*

interface SelectOption {
  value: string;
  /** Detail shown after a generated label (date format: "FR", "ISO"…). */
  hint?: string;
  /** "Recommended" badge. */
  recommended?: boolean;
}

/**
 * Configuration field. The texts are not here: they are read at render time
 * from `settings.fields.<key>.label|description|actionLabel|options.<value>`.
 */
interface ConfigField {
  key: string;
  type: "text" | "number" | "boolean" | "password" | "select" | "image" | "themed-image" | "multiselect" | "taglist" | "richtext" | "datetime" | "color" | "icon" | "time" | "action";
  defaultValue?: string;
  /** ICU parameters of the description (literal braces such as `{{SOCIETE}}`). */
  descriptionParams?: Record<string, string>;
  /** Start of a section: stable identifier (label: settings.sections.<section>). */
  section?: string;
  options?: SelectOption[];
  /** Prefix of shared option labels (default: `fields.<key>.options`). */
  optionLabels?: string;
  /** Generated option labels: sample date in the option's format. */
  generatedOptionLabels?: "dateFormat";
  accept?: string;
  uploadType?: "logo" | "favicon" | "login-bg";
  lightKey?: string;
  darkKey?: string;
  visibleWhen?: { key: string; value: string | string[]; and?: { key: string; value: string | string[] } };
  actionId?: string;
  actionVariant?: "default" | "destructive" | "outline";
  readOnly?: boolean;
}

// Sidebar navigation per tab — entries shown in the left nav.
// `id`: stable identifier (state, comparisons, label settings.nav.<id>);
// `section`: id of the field section where the entry starts (default = id);
// `disabled`: grayed-out entry, reason settings.navDisabledReason.
type NavItem = { id: string; section?: string; disabled?: boolean };
const CATEGORY_NAV: Record<string, NavItem[]> = {
  general: [
    { id: "application" },
    { id: "appearance" },
    { id: "workDurations" },
    { id: "announcement" },
  ],
  communication: [
    { id: "email" },
    { id: "sms", section: "smsSentDm", disabled: true },
    { id: "emailNotifications" },
    { id: "weeklySummary" },
    { id: "pushNotifications" },
    { id: "smsNotifications", disabled: true },
  ],
  security: [
    { id: "passwords", section: "passwordPolicy" },
    { id: "forgotPassword" },
    { id: "twoFactor" },
    { id: "sessions" },
    { id: "captcha" },
    { id: "gdpr", section: "cookieBanner" },
  ],
  system: [
    { id: "files" },
    { id: "audit" },
    { id: "logs" },
    { id: "apiAccess" },
    { id: "cache" },
    { id: "purge" },
  ],
  ai: [
    { id: "mcp" },
    { id: "aiChat" },
    { id: "aiChatQuotas" },
  ],
  "backup-import": [
    { id: "backup" },
    { id: "import" },
    { id: "migration" },
  ],
  version: [
    { id: "version" },
  ],
};

/** Former `?tab=` values (French category ids): still accepted so bookmarks keep working. */
const LEGACY_TAB_IDS: Record<string, string> = { systeme: "system", ia: "ai", "sauvegarde-import": "backup-import" };

/** Variables of the privacy policy content (replaced by the /privacy page). */
// i18n-ignore literal variable names
const PRIVACY_VARIABLES = ["{{SOCIETE}}", "{{EMAIL_DPO}}", "{{DUREE_CONSERVATION}}"] as const;

const CONFIG_CATEGORIES: { id: string; fields: ConfigField[] }[] = [
  {
    id: "general",
    fields: [
      // ── Application ──
      { key: "APP_TITLE", type: "text", defaultValue: "HumblePlanning", section: "application" },
      { key: "APP_BASE_URL", type: "text", defaultValue: "http://localhost:3000" },
      { key: "TIMEZONE", type: "select", defaultValue: "auto", optionLabels: "timezones", options: [
        { value: "auto" },
        { value: "Europe/Paris" },
        { value: "Europe/London" },
        { value: "Europe/Berlin" },
        { value: "Europe/Madrid" },
        { value: "Europe/Rome" },
        { value: "Europe/Brussels" },
        { value: "Europe/Zurich" },
        { value: "Europe/Luxembourg" },
        { value: "Europe/Amsterdam" },
        { value: "Europe/Lisbon" },
        { value: "Europe/Vienna" },
        { value: "Europe/Warsaw" },
        { value: "Europe/Prague" },
        { value: "Europe/Bucharest" },
        { value: "Europe/Athens" },
        { value: "Europe/Helsinki" },
        { value: "Europe/Stockholm" },
        { value: "Europe/Oslo" },
        { value: "Europe/Copenhagen" },
        { value: "Europe/Dublin" },
        { value: "Europe/Moscow" },
        { value: "Europe/Istanbul" },
        { value: "America/New_York" },
        { value: "America/Chicago" },
        { value: "America/Denver" },
        { value: "America/Los_Angeles" },
        { value: "America/Toronto" },
        { value: "America/Montreal" },
        { value: "America/Sao_Paulo" },
        { value: "America/Mexico_City" },
        { value: "America/Martinique" },
        { value: "America/Guadeloupe" },
        { value: "America/Cayenne" },
        { value: "Indian/Reunion" },
        { value: "Indian/Mayotte" },
        { value: "Pacific/Tahiti" },
        { value: "Pacific/Noumea" },
        { value: "Asia/Tokyo" },
        { value: "Asia/Shanghai" },
        { value: "Asia/Dubai" },
        { value: "Asia/Singapore" },
        { value: "Asia/Kolkata" },
        { value: "Australia/Sydney" },
        { value: "Africa/Casablanca" },
        { value: "Africa/Tunis" },
        { value: "Africa/Algiers" },
        { value: "Africa/Dakar" },
        { value: "Africa/Abidjan" },
        { value: "UTC" },
      ]},
      { key: "APP_LOCALE", type: "select", defaultValue: "auto", options: [
        { value: "auto" },
        { value: "fr" },
        { value: "en" },
        { value: "es" },
        { value: "de" },
      ]},
      { key: "PLANNING_DATE_FORMAT", type: "select", defaultValue: "dd/MM/yyyy", generatedOptionLabels: "dateFormat", options: [
        { value: "dd/MM/yyyy", hint: "FR" },
        { value: "dd.MM.yyyy", hint: "CH/DE" }, // i18n-ignore country codes
        { value: "dd-MM-yyyy" },
        { value: "yyyy-MM-dd", hint: "ISO" },
        { value: "MM/dd/yyyy", hint: "US" },
        { value: "d MMMM yyyy" },
        { value: "d MMM yyyy" },
        { value: "EEEE d MMMM yyyy" },
      ]},
      { key: "TIME_FORMAT", type: "select", defaultValue: "24h", options: [
        { value: "24h" },
        { value: "12h" },
      ]},
      { key: "MODULE_VEHICLES", type: "boolean" },
      { key: "MODULE_RESOURCES", type: "boolean" },
      { key: "MAINTENANCE_MODE", type: "boolean", section: "maintenance" },
      { key: "DEFAULT_HOME_PAGE", type: "select", defaultValue: "/planning", section: "newUserDefaults", options: [
        { value: "/home" },
        { value: "/planning" },
        { value: "/tasks" },
        { value: "/projects" },
        { value: "/users" },
        { value: "/teams" },
        { value: "/resources" },
        { value: "/vehicles" },
        { value: "/audit" },
        { value: "/settings" },
      ]},
      { key: "DEFAULT_PLANNING_VIEW", type: "select", defaultValue: "users", options: [
        { value: "users" },
        { value: "projects" },
        { value: "resources" },
        { value: "vehicles" },
      ]},
      { key: "DEFAULT_COLUMN_VIEW", type: "select", defaultValue: "days", options: [
        { value: "days" },
        { value: "hours" },
      ]},
      { key: "DEFAULT_THEME", type: "select", defaultValue: "system", options: [
        { value: "system" },
        { value: "light" },
        { value: "dark" },
      ]},
      { key: "DEFAULT_NOTIFICATIONS", type: "boolean" },
      { key: "DEFAULT_PUSH_NOTIFICATIONS", type: "boolean" },
      { key: "DEFAULT_SMS_NOTIFICATIONS", type: "boolean" },
      // ── Appearance ──
      { key: "APP_LOGO", type: "themed-image", section: "appearance", accept: "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml", uploadType: "logo", lightKey: "APP_LOGO_LIGHT", darkKey: "APP_LOGO_DARK" },
      { key: "APP_FAVICON", type: "themed-image", accept: "image/png,image/jpeg,image/webp,image/gif,image/avif", uploadType: "favicon", lightKey: "APP_FAVICON_LIGHT", darkKey: "APP_FAVICON_DARK" },
      { key: "LOGIN_BACKGROUND", type: "themed-image", accept: "image/png,image/jpeg,image/webp,image/gif,image/avif", uploadType: "login-bg", lightKey: "LOGIN_BACKGROUND_LIGHT", darkKey: "LOGIN_BACKGROUND_DARK" },
      // ── Planning display ──
      { key: "PLANNING_MIN_CELL_WIDTH", type: "number", defaultValue: "55", section: "planningDisplay" },
      { key: "PLANNING_MAX_CELL_WIDTH", type: "number", defaultValue: "170" },
      { key: "PLANNING_DEFAULT_CELL_WIDTH", type: "number", defaultValue: "75" },
      { key: "PLANNING_MAX_CELL_WIDTH_MOBILE", type: "number", defaultValue: "140" },
      { key: "PLANNING_SIDEBAR_WIDTH", type: "text", defaultValue: "auto" },
      { key: "PLANNING_SIDEBAR_WIDTH_MOBILE", type: "number", defaultValue: "140" },
      { key: "PLANNING_LINE_HEIGHT", type: "number", defaultValue: "24" },
      { key: "PLANNING_CELL_FONTSIZE", type: "number", defaultValue: "11" },
      {
        key: "PLANNING_FONT_FAMILY",
        type: "select",
        defaultValue: "geist",
        options: [
          { value: "geist" },
          { value: "inter" },
          { value: "roboto" },
          { value: "ibm-plex-sans" },
          { value: "source-sans" },
        ],
      },
      { key: "PLANNING_FONT_BOLD", type: "boolean", defaultValue: "false" },
      { key: "DEFAULT_NB_MONTHS_DISPLAYED", type: "number", defaultValue: "2" },
      { key: "PLANNING_MAX_TASKS_PER_DAY", type: "number", defaultValue: "0" },
      // ── Work durations ──
      { key: "AM_START", type: "text", defaultValue: "08:00", section: "workDurations" },
      { key: "AM_END", type: "text", defaultValue: "12:00" },
      { key: "PM_START", type: "text", defaultValue: "14:00" },
      { key: "PM_END", type: "text", defaultValue: "17:00" },
      { key: "DURATION_DAY", type: "text", defaultValue: "07:30" },
      { key: "INCLUDE_WEEKENDS", type: "boolean", defaultValue: "false" },
      { key: "INCLUDE_HOLIDAYS", type: "boolean", defaultValue: "false" },
      // ── Announcement ──
      { key: "ANNOUNCEMENT_ENABLED", type: "boolean", section: "announcement" },
      { key: "ANNOUNCEMENT_CONTENT", type: "richtext", visibleWhen: { key: "ANNOUNCEMENT_ENABLED", value: "true" } },
      { key: "ANNOUNCEMENT_COLOR", type: "color", defaultValue: "#3b82f6", visibleWhen: { key: "ANNOUNCEMENT_ENABLED", value: "true" } },
      { key: "ANNOUNCEMENT_ICON", type: "icon", defaultValue: "Megaphone", visibleWhen: { key: "ANNOUNCEMENT_ENABLED", value: "true" } },
      { key: "ANNOUNCEMENT_EXPIRES_AT", type: "datetime", visibleWhen: { key: "ANNOUNCEMENT_ENABLED", value: "true" } },
      { key: "ANNOUNCEMENT_REPEAT", type: "select", defaultValue: "never", options: [
        { value: "never" },
        { value: "day" },
        { value: "week" },
        { value: "month" },
      ], visibleWhen: { key: "ANNOUNCEMENT_ENABLED", value: "true" } },
    ],
  },
  {
    id: "communication",
    fields: [
      // Email
      { key: "EMAIL_PROVIDER", type: "select", defaultValue: "nuntly", section: "email", options: [
        { value: "nuntly" },
        { value: "smtp" },
        { value: "mailgun" },
      ]},
      { key: "SMTP_FROM", type: "text" },
      // Nuntly
      { key: "NUNTLY_API_KEY", type: "password", visibleWhen: { key: "EMAIL_PROVIDER", value: "nuntly" } },
      { key: "NUNTLY_WEBHOOK_SECRET", type: "password", visibleWhen: { key: "EMAIL_PROVIDER", value: "nuntly" } },
      // SMTP
      { key: "SMTP_HOST", type: "text", visibleWhen: { key: "EMAIL_PROVIDER", value: "smtp" } },
      { key: "SMTP_PORT", type: "number", defaultValue: "587", visibleWhen: { key: "EMAIL_PROVIDER", value: "smtp" } },
      { key: "SMTP_LOGIN", type: "text", visibleWhen: { key: "EMAIL_PROVIDER", value: "smtp" } },
      { key: "SMTP_PASSWORD", type: "password", visibleWhen: { key: "EMAIL_PROVIDER", value: "smtp" } },
      { key: "SMTP_SECURE", type: "boolean", visibleWhen: { key: "EMAIL_PROVIDER", value: "smtp" } },
      // Mailgun
      { key: "MAILGUN_API_KEY", type: "password", visibleWhen: { key: "EMAIL_PROVIDER", value: "mailgun" } },
      { key: "MAILGUN_DOMAIN", type: "text", visibleWhen: { key: "EMAIL_PROVIDER", value: "mailgun" } },
      { key: "MAILGUN_REGION", type: "select", defaultValue: "eu", options: [
        { value: "eu" },
        { value: "us" },
      ], visibleWhen: { key: "EMAIL_PROVIDER", value: "mailgun" } },
      // SMS / WhatsApp (Sent.dm)
      { key: "SENT_API_KEY", type: "password", section: "smsSentDm" },
      { key: "SENT_SENDER_ID", type: "text" },
      { key: "SENT_TEMPLATE_ID", type: "text", descriptionParams: { v1: "{{1}}", v2: "{{2}}", v3: "{{3}}", v4: "{{4}}", v5: "{{5}}" } },
      { key: "SENT_DEFAULT_COUNTRY", type: "text", defaultValue: "FR" },
      // Notifications
      { key: "NOTIFICATION_EMAIL_COCHE", type: "boolean", section: "emailNotifications" },
      { key: "EMAIL_SEND_DELAY", type: "number", defaultValue: "60", visibleWhen: { key: "NOTIFICATION_EMAIL_COCHE", value: "true" } },
      { key: "EMAIL_THROTTLE_DELAY", type: "number", defaultValue: "0", visibleWhen: { key: "NOTIFICATION_EMAIL_COCHE", value: "true" } },
      { key: "EMAIL_NOTIFICATION_TRIGGERS", type: "multiselect", optionLabels: "options.triggers", defaultValue: "task_created,task_deleted,task_title_changed,task_dates_changed,task_times_changed,task_status_changed,task_project_changed,task_notes_changed,task_user_added,task_user_removed,task_file_added,task_file_deleted", options: [
        { value: "task_created" },
        { value: "task_deleted" },
        { value: "task_title_changed" },
        { value: "task_dates_changed" },
        { value: "task_times_changed" },
        { value: "task_status_changed" },
        { value: "task_project_changed" },
        { value: "task_notes_changed" },
        { value: "task_user_added" },
        { value: "task_user_removed" },
        { value: "task_file_added" },
        { value: "task_file_deleted" },
      ], visibleWhen: { key: "NOTIFICATION_EMAIL_COCHE", value: "true" } },
      // Weekly summary (email)
      { key: "WEEKLY_SUMMARY_ENABLED", type: "boolean", section: "weeklySummary" },
      { key: "WEEKLY_SUMMARY_DAY", type: "select", defaultValue: "1", options: [
        { value: "1" },
        { value: "2" },
        { value: "3" },
        { value: "4" },
        { value: "5" },
        { value: "6" },
        { value: "7" },
      ], visibleWhen: { key: "WEEKLY_SUMMARY_ENABLED", value: "true" } },
      { key: "WEEKLY_SUMMARY_TIME", type: "time", defaultValue: "08:00", visibleWhen: { key: "WEEKLY_SUMMARY_ENABLED", value: "true" } },
      // Push notifications
      { key: "NOTIFICATION_PUSH_ENABLED", type: "boolean", section: "pushNotifications" },
      { key: "PUSH_NOTIFICATION_TRIGGERS", type: "multiselect", optionLabels: "options.triggers", defaultValue: "task_created,task_deleted,task_title_changed,task_dates_changed,task_times_changed,task_status_changed,task_project_changed,task_notes_changed,task_user_added,task_user_removed,task_file_added,task_file_deleted", options: [
        { value: "task_created" },
        { value: "task_deleted" },
        { value: "task_title_changed" },
        { value: "task_dates_changed" },
        { value: "task_times_changed" },
        { value: "task_status_changed" },
        { value: "task_project_changed" },
        { value: "task_notes_changed" },
        { value: "task_user_added" },
        { value: "task_user_removed" },
        { value: "task_file_added" },
        { value: "task_file_deleted" },
      ], visibleWhen: { key: "NOTIFICATION_PUSH_ENABLED", value: "true" } },
      { key: "PUSH_RETENTION_DAYS", type: "number", defaultValue: "30", visibleWhen: { key: "NOTIFICATION_PUSH_ENABLED", value: "true" } },
      { key: "__purge_notifications", type: "action", actionId: "purge_notifications", actionVariant: "destructive", visibleWhen: { key: "NOTIFICATION_PUSH_ENABLED", value: "true" } }, // i18n-ignore identifier
      // SMS / WhatsApp notifications
      { key: "NOTIFICATION_SMS_ENABLED", type: "boolean", section: "smsNotifications" },
      { key: "SMS_THROTTLE_DELAY", type: "number", defaultValue: "0", visibleWhen: { key: "NOTIFICATION_SMS_ENABLED", value: "true" } },
      { key: "SMS_NOTIFICATION_TRIGGERS", type: "multiselect", optionLabels: "options.triggers", defaultValue: "task_created,task_deleted,task_title_changed,task_dates_changed,task_times_changed,task_status_changed,task_project_changed,task_notes_changed,task_user_added,task_user_removed,task_file_added,task_file_deleted", options: [
        { value: "task_created" },
        { value: "task_deleted" },
        { value: "task_title_changed" },
        { value: "task_dates_changed" },
        { value: "task_times_changed" },
        { value: "task_status_changed" },
        { value: "task_project_changed" },
        { value: "task_notes_changed" },
        { value: "task_user_added" },
        { value: "task_user_removed" },
        { value: "task_file_added" },
        { value: "task_file_deleted" },
      ], visibleWhen: { key: "NOTIFICATION_SMS_ENABLED", value: "true" } },
    ],
  },
  {
    id: "security",
    fields: [
      // Password policy
      { key: "PWD_MIN_LENGTH", type: "number", defaultValue: "8", section: "passwordPolicy" },
      { key: "PWD_MAX_LENGTH", type: "number", defaultValue: "128" },
      { key: "PWD_REQUIRE_UPPERCASE", type: "boolean" },
      { key: "PWD_REQUIRE_LOWERCASE", type: "boolean" },
      { key: "PWD_REQUIRE_DIGIT", type: "boolean" },
      { key: "PWD_REQUIRE_SPECIAL", type: "boolean" },
      { key: "PWD_HISTORY_COUNT", type: "number", defaultValue: "0" },
      // Password generator
      { key: "PWD_GEN_LENGTH", type: "number", defaultValue: "16", section: "passwordGenerator" },
      { key: "PWD_GEN_INCLUDE_SPECIAL", type: "boolean" },
      // Password blacklist
      { key: "PWD_BLACKLIST_ENABLED", type: "boolean", section: "passwordBlacklist" },
      { key: "PWD_BLACKLIST", type: "taglist", visibleWhen: { key: "PWD_BLACKLIST_ENABLED", value: "true" } },
      // Forgot password
      { key: "FORGOT_PASSWORD_ENABLED", type: "boolean", section: "forgotPassword" },
      // Anti-bruteforce
      { key: "BRUTEFORCE_MAX_ATTEMPTS", type: "number", defaultValue: "5", section: "bruteforce" },
      { key: "BRUTEFORCE_LOCKOUT_SECONDS", type: "number", defaultValue: "300" },
      // 2FA
      { key: "TWOFACTOR_REQUIRED", type: "boolean", section: "twoFactor" },
      // Sessions
      { key: "SESSION_DURATION_DAYS", type: "number", defaultValue: "7", section: "sessions" },
      { key: "SESSION_REMEMBER_DAYS", type: "number", defaultValue: "30" },
      // Captcha
      { key: "CAPTCHA_ENABLED", type: "boolean", section: "captcha" },
      { key: "CAPTCHA_PROVIDER", type: "select", defaultValue: "altcha", options: [
        { value: "altcha", recommended: true },
        { value: "turnstile" },
        { value: "recaptcha" },
      ], visibleWhen: { key: "CAPTCHA_ENABLED", value: "true" } },
      { key: "CAPTCHA_SITE_KEY", type: "text", visibleWhen: { key: "CAPTCHA_ENABLED", value: "true", and: { key: "CAPTCHA_PROVIDER", value: ["turnstile", "recaptcha"] } } },
      { key: "CAPTCHA_SECRET_KEY", type: "password", visibleWhen: { key: "CAPTCHA_ENABLED", value: "true", and: { key: "CAPTCHA_PROVIDER", value: ["turnstile", "recaptcha"] } } },
      // GDPR
      { key: "COOKIE_BANNER_ENABLED", type: "boolean", section: "cookieBanner" },
      // GDPR texts: no saved default value; empty = text translated
      // in the reader's language (LEGAL_TEXT_DEFAULT_KEYS, shown as an example).
      { key: "COOKIE_BANNER_TITLE", type: "text", visibleWhen: { key: "COOKIE_BANNER_ENABLED", value: "true" } },
      { key: "COOKIE_BANNER_DESCRIPTION", type: "text", visibleWhen: { key: "COOKIE_BANNER_ENABLED", value: "true" } },
      { key: "COOKIE_BANNER_POSITION", type: "select", defaultValue: "bottom center", options: [
        { value: "bottom center" },
        { value: "bottom left" },
        { value: "bottom right" },
        { value: "top center" },
      ], visibleWhen: { key: "COOKIE_BANNER_ENABLED", value: "true" } },
      { key: "COOKIE_ANALYTICS_ENABLED", type: "boolean", visibleWhen: { key: "COOKIE_BANNER_ENABLED", value: "true" } },
      { key: "COOKIE_ANALYTICS_LABEL", type: "text", visibleWhen: { key: "COOKIE_ANALYTICS_ENABLED", value: "true" } },
      { key: "COOKIE_FUNCTIONAL_ENABLED", type: "boolean", visibleWhen: { key: "COOKIE_BANNER_ENABLED", value: "true" } },
      { key: "COOKIE_FUNCTIONAL_LABEL", type: "text", visibleWhen: { key: "COOKIE_FUNCTIONAL_ENABLED", value: "true" } },
      { key: "PRIVACY_POLICY_ENABLED", type: "boolean", section: "privacyPolicy" },
      { key: "PRIVACY_POLICY_TITLE", type: "text", visibleWhen: { key: "PRIVACY_POLICY_ENABLED", value: "true" } },
      { key: "LEGAL_COMPANY_NAME", type: "text", section: "legalInfo", descriptionParams: { variable: PRIVACY_VARIABLES[0] } },
      { key: "LEGAL_CONTACT_EMAIL", type: "text", descriptionParams: { variable: PRIVACY_VARIABLES[1] } },
      { key: "LEGAL_DATA_RETENTION_DAYS", type: "number", defaultValue: "365", descriptionParams: { variable: PRIVACY_VARIABLES[2] } },
      { key: "PRIVACY_POLICY_CONTENT", type: "richtext", visibleWhen: { key: "PRIVACY_POLICY_ENABLED", value: "true" } },
      { key: "FOOTER_COPYRIGHT_TEXT", type: "text", section: "footer" },
      { key: "FOOTER_SHOW_PRIVACY_LINK", type: "boolean", defaultValue: "true" },
      { key: "FOOTER_SHOW_VERSION", type: "boolean", defaultValue: "true" },
    ],
  },
  {
    id: "system",
    fields: [
      // Files
      { key: "ENABLE_FILE_UPLOAD", type: "boolean", defaultValue: "true", section: "files" },
      { key: "WHITELIST_UPLOAD", type: "text", defaultValue: "pdf,doc,docx,xls,xlsx,png,jpg,jpeg,gif,webp" },
      { key: "MAX_UPLOAD_SIZE_MB", type: "number", defaultValue: "10" },
      { key: "MAX_TOTAL_SIZE_MB", type: "number", defaultValue: "25" },
      { key: "MAX_FILES_PER_TASK", type: "number", defaultValue: "5" },
      { key: "FILE_RETENTION", type: "select", optionLabels: "options.retention", defaultValue: "0", options: [
        { value: "7" },
        { value: "30" },
        { value: "90" },
        { value: "180" },
        { value: "365" },
        { value: "0" },
      ]},
      // Audit
      { key: "MODULE_AUDIT", type: "boolean", section: "audit" },
      { key: "AUDIT_TASKS", type: "boolean" },
      { key: "AUDIT_PROJECTS", type: "boolean" },
      { key: "AUDIT_USERS", type: "boolean" },
      { key: "AUDIT_LOGINS", type: "boolean" },
      { key: "AUDIT_RETENTION", type: "select", optionLabels: "options.retention", defaultValue: "30", options: [
        { value: "7" },
        { value: "30" },
        { value: "90" },
        { value: "180" },
        { value: "365" },
        { value: "0" },
      ]},
      // System logs
      { key: "LOGS_ENABLED", type: "boolean", section: "logs", defaultValue: "true" },
      { key: "LOGS_LEVEL", type: "select" as const, defaultValue: "INFO", visibleWhen: { key: "LOGS_ENABLED", value: "true" }, options: [
        { value: "ERROR" },
        { value: "WARN" },
        { value: "INFO" },
        { value: "DEBUG" },
      ]},
      { key: "LOGS_MAX_ENTRIES", type: "number", defaultValue: "500", visibleWhen: { key: "LOGS_ENABLED", value: "true" } },
      // API access
      { key: "API_ENABLED", type: "boolean", section: "apiAccess" },
      { key: "API_RATE_LIMIT_MINUTE", type: "number", defaultValue: "60", visibleWhen: { key: "API_ENABLED", value: "true" } },
      { key: "API_RATE_LIMIT_HOUR", type: "number", defaultValue: "1000", visibleWhen: { key: "API_ENABLED", value: "true" } },
      { key: "API_RATE_LIMIT_EXPORT", type: "number", defaultValue: "5", visibleWhen: { key: "API_ENABLED", value: "true" } },
      // Cache
      { key: "CACHE_ENABLED", type: "boolean", section: "cache" },
      { key: "CACHE_TTL", type: "number", defaultValue: "300", visibleWhen: { key: "CACHE_ENABLED", value: "true" } },
      // Purge (manual only)
      { key: "_purge_files", type: "action", actionId: "purge_files", actionVariant: "destructive", section: "purge" },
      { key: "_purge_tasks", type: "action", actionId: "purge_tasks", actionVariant: "destructive" },
    ],
  },
  {
    id: "ai",
    fields: [
      { key: "MCP_ENABLED", type: "boolean", section: "mcp" },
      { key: "MCP_MAX_KEYS_PER_USER", type: "number", defaultValue: "5", visibleWhen: { key: "MCP_ENABLED", value: "true" } },
      // Sentinel fields — "AI chat" and "AI chat quotas" sections (dedicated panels, settings outside /api/config)
      { key: "_AI_CHAT_SECTION", type: "text", section: "aiChat", visibleWhen: { key: "_NEVER_VISIBLE_", value: "true" } },
      { key: "_AI_CHAT_QUOTAS_SECTION", type: "text", section: "aiChatQuotas", visibleWhen: { key: "_NEVER_VISIBLE_", value: "true" } },
    ],
  },
  {
    id: "backup-import",
    fields: [
      { key: "BACKUP_ENABLED", type: "boolean", section: "backup" },
      { key: "BACKUP_SCHEDULE", type: "select", defaultValue: "daily", options: [
        { value: "6h" },
        { value: "12h" },
        { value: "daily" },
        { value: "weekly" },
      ], visibleWhen: { key: "BACKUP_ENABLED", value: "true" } },
      { key: "BACKUP_TIME", type: "time", defaultValue: "02:00", visibleWhen: { key: "BACKUP_ENABLED", value: "true" } },
      { key: "BACKUP_RETENTION_DAYS", type: "select", defaultValue: "30", options: [
        { value: "7" },
        { value: "30" },
        { value: "90" },
        { value: "365" },
      ], visibleWhen: { key: "BACKUP_ENABLED", value: "true" } },
      { key: "BACKUP_MAX_COUNT", type: "number", defaultValue: "10", visibleWhen: { key: "BACKUP_ENABLED", value: "true" } },
      // Sentinel field — marks the start of the "Importer" section (no visible field, just for nav partitioning)
      { key: "_IMPORT_SECTION", type: "text", section: "import", visibleWhen: { key: "_NEVER_VISIBLE_", value: "true" } },
      // Sentinel field — marks the start of the "Migration" section
      { key: "_MIGRATION_SECTION", type: "text", section: "migration", visibleWhen: { key: "_NEVER_VISIBLE_", value: "true" } },
    ],
  },
  {
    id: "version",
    fields: [
      { key: "UPDATE_CHECK_ENABLED", type: "boolean", defaultValue: "true", section: "updateCheck" },
    ],
  },
];

/** Key segment of an option value (`Europe/Paris` → `Europe_Paris`, `/home` → `home`). */
function optionKey(value: string): string {
  return value.replace(/^\//, "").replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Sample date for the date formats (Thursday, December 31, 2026). */
const DATE_FORMAT_SAMPLE = new Date(2026, 11, 31);

/** Texts of a configuration field, read at render time from `settings.fields.<key>.*`. */
function useFieldText() {
  const t = useTranslations("settings");
  const tPublic = useTranslations("public");
  const { format: formatLocal } = useDateFormat();
  return {
    label: (field: ConfigField) => tDyn(t, `fields.${field.key}.label`),
    description: (field: ConfigField): string | null => {
      const key = `fields.${field.key}.description`; // i18n-ignore message key
      if (hasDyn(t, key)) return tDyn(t, key, field.descriptionParams);
      return legalTextMessageKey(field.key) ? t("field.translatedDefaultHelp") : null;
    },
    /** Sample text: translated default text (GDPR texts), otherwise default value. */
    placeholder: (field: ConfigField): string | undefined => {
      const defaultKey = legalTextMessageKey(field.key);
      return defaultKey ? tPublic(defaultKey) : field.defaultValue;
    },
    actionLabel: (field: ConfigField) => tDyn(t, `fields.${field.key}.actionLabel`),
    option: (field: ConfigField, opt: SelectOption): string => {
      if (field.generatedOptionLabels === "dateFormat") {
        const sample = formatLocal(DATE_FORMAT_SAMPLE, opt.value);
        return opt.hint ? `${sample} (${opt.hint})` : sample;
      }
      return tDyn(t, `${field.optionLabels ?? `fields.${field.key}.options`}.${optionKey(opt.value)}`);
    },
  };
}

/**
 * Mobile navigation in a side Sheet: a single compact breadcrumb button
 * at the top of the page opens a panel with the whole hierarchy
 * (8 categories + their sub-sections), displayed as an indented
 * list with section headers + clickable items. Closes the sheet
 * on any tap for fluidity (iOS / Android Settings pattern).
 *
 * Hidden: `md:hidden` — only visible on smartphones. Tablet / desktop
 * keep their existing layout (Tabs + side nav).
 */
function SettingsMobileNav({
  activeTab,
  activeSubSection,
  onSelect,
}: {
  activeTab: string;
  activeSubSection: Record<string, string>;
  onSelect: (catId: string, subId: string | null) => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const activeCategory = CONFIG_CATEGORIES.find((c) => c.id === activeTab);
  const activeNavId = activeSubSection[activeTab];
  const activeNavLabel = activeNavId && CATEGORY_NAV[activeTab]?.some((n) => n.id === activeNavId) ? tDyn(t, `nav.${activeNavId}`) : "";

  return (
    <div className="mt-3 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" className="w-full justify-between gap-2 h-11">
            <span className="flex items-center gap-2 min-w-0">
              <Menu className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="font-medium truncate">{activeCategory ? tDyn(t, `categories.${activeCategory.id}`) : t("page.title")}</span>
                {activeNavLabel && CATEGORY_NAV[activeTab] && CATEGORY_NAV[activeTab].length > 1 && (
                  <>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                    <span className="text-muted-foreground truncate">{activeNavLabel}</span>
                  </>
                )}
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[85%] max-w-sm p-0 flex flex-col">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>{t("page.title")}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto overscroll-contain py-2">
            {CONFIG_CATEGORIES.map((cat) => {
              const isActiveCat = cat.id === activeTab;
              const navItems = CATEGORY_NAV[cat.id] ?? [];
              const hasSubs = navItems.length > 1;
              return (
                <div key={cat.id} className="px-2">
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(cat.id, null);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2.5 rounded-md text-sm font-semibold transition-colors",
                      isActiveCat ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50"
                    )}
                  >
                    <span className="truncate">{tDyn(t, `categories.${cat.id}`)}</span>
                    {hasSubs && (
                      <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isActiveCat && "rotate-90")} />
                    )}
                  </button>
                  {isActiveCat && hasSubs && (
                    <div className="ml-3 mt-0.5 mb-1 border-l border-border/60 pl-2 space-y-0.5">
                      {navItems.map((nav, i) => {
                        const isActiveSub = nav.id === activeNavId;
                        return (
                          <button
                            key={nav.id ?? i}
                            type="button"
                            disabled={nav.disabled}
                            onClick={() => {
                              if (nav.disabled) return;
                              onSelect(cat.id, nav.id);
                              setOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-2 rounded-md text-[13px] transition-colors truncate text-left",
                              nav.disabled
                                ? "text-muted-foreground/40 cursor-not-allowed"
                                : isActiveSub
                                  ? "bg-accent/60 text-foreground font-medium"
                                  : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
                            )}
                          >
                            <span className="truncate">{tDyn(t, `nav.${nav.id}`)}</span>
                            {nav.disabled && (
                              <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">({tc("states.comingSoon")})</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SettingsSectionNav({ navItems, activeSection, onSelect }: {
  navItems: NavItem[];
  /** id of the active entry */
  activeSection: string;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  return (
    <>
      {/* Tablet only (md → lg): sub-section Select.
          On mobile (< md), the SettingsMobileNav Sheet takes
          over. On desktop (≥ lg), the side nav below. */}
      <div className="hidden md:block lg:hidden mb-4">
        <Select value={activeSection} onValueChange={onSelect}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {navItems.map((nav, i) => (
              <SelectItem key={nav.id ?? i} value={nav.id} disabled={nav.disabled}>
                {tDyn(t, `nav.${nav.id}`)}
                {nav.disabled && (
                  <span className="text-xs text-muted-foreground ml-2">({tc("states.comingSoon")})</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <nav className="hidden lg:block w-44 shrink-0">
        <div className="sticky top-32 space-y-0.5">
          {navItems.map((nav, i) => {
            const btn = (
              <button
                key={i}
                type="button"
                disabled={nav.disabled}
                onClick={() => {
                  if (nav.disabled) return;
                  onSelect(nav.id);
                }}
                className={cn(
                  "block w-full text-left text-[13px] px-2.5 py-1.5 rounded-md transition-colors truncate",
                  nav.disabled
                    ? "text-muted-foreground/40 cursor-not-allowed"
                    : activeSection === nav.id
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                {tDyn(t, `nav.${nav.id}`)}
              </button>
            );
            if (nav.disabled) {
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="block">{btn}</span>
                  </TooltipTrigger>
                  <TooltipContent side="right">{tc("states.comingSoon")}</TooltipContent>
                </Tooltip>
              );
            }
            return btn;
          })}
        </div>
      </nav>
    </>
  );
}

function TagListInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [inputValue, setInputValue] = useState("");
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const tags = value ? value.split(",").filter(Boolean) : [];
  const filteredTags = search
    ? tags.filter((tag) => tag.toLowerCase().includes(search.toLowerCase()))
    : tags;

  function addTag(tag: string) {
    const cleaned = tag.trim().toLowerCase();
    if (!cleaned || tags.includes(cleaned)) return;
    onChange([...tags, cleaned].sort().join(","));
    setInputValue("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((existing) => existing !== tag).join(","));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    const newTags = text.split(/[,;\n\r\t]+/).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
    const unique = [...new Set([...tags, ...newTags])].sort();
    onChange(unique.join(","));
    setInputValue("");
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t("tagList.placeholder")}
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => addTag(inputValue)}
          disabled={!inputValue.trim()}
        >
          {tc("actions.add")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("tagList.help")}
      </p>
      {tags.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t("tagList.count", { count: tags.length })}</span>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("tagList.filterPlaceholder")}
              className="h-7 w-40 text-xs"
            />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-input bg-background p-2">
            <div className="flex flex-wrap gap-1.5">
              {filteredTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-mono"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {filteredTags.length === 0 && search && (
                <span className="text-xs text-muted-foreground py-1">{tc("states.noResultsFor", { search })}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MultiselectCheckboxes({
  field,
  selected,
  onChange,
}: {
  field: ConfigField;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const tc = useTranslations("common");
  const fieldText = useFieldText();
  const [open, setOpen] = useState(true);
  const options = field.options ?? [];
  const allSelected = options.length > 0 && options.every((o) => selected.includes(o.value));

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((s) => s !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const toggleAll = () => {
    if (allSelected) {
      onChange([]);
    } else {
      onChange(options.map((o) => o.value));
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" type="button" className="w-full justify-between px-2 h-8 text-sm">
          <span className="flex items-center gap-1.5">
            {fieldText.label(field)}
            <span className="text-xs text-muted-foreground">({selected.length}/{options.length})</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        <div className="border rounded-md p-2 space-y-0.5">
          <div
            role="option"
            aria-selected={allSelected}
            className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer border-b pb-2 mb-1"
            onClick={toggleAll}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAll(); } }}
            tabIndex={0}
          >
            <div className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-colors",
              allSelected ? "border-primary bg-primary text-primary-foreground" : "border-input"
            )}>
              {allSelected && <Check className="h-3 w-3" />}
            </div>
            <span className="font-medium">{tc("actions.selectAll")}</span>
          </div>
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
                onClick={() => toggle(opt.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(opt.value); } }}
                tabIndex={0}
              >
                <div className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs transition-colors",
                  isSelected ? "border-primary bg-primary text-primary-foreground" : "border-input"
                )}>
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                <span>{fieldText.option(field, opt)}</span>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ImageField({
  field,
  value,
  onUploaded,
  onDeleted,
}: {
  field: ConfigField;
  value: string | undefined;
  onUploaded: (key: string, path: string) => void;
  onDeleted: (key: string) => void;
}) {
  const t = useTranslations("settings");
  const fieldText = useFieldText();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const queryClient = useQueryClient();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !field.uploadType) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", field.uploadType);

      const res = await fetch("/api/branding/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");

      const json = await res.json();
      onUploaded(field.key, json.path);
      setCacheBuster(Date.now());
      queryClient.invalidateQueries({ queryKey: ["config"] });
      // Force browser favicon refresh
      if (field.uploadType === "favicon") {
        const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
        if (link) link.href = `/icon?v=${Date.now()}`; // i18n-ignore URL
      }
    } catch {
      // silent
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = () => {
    onDeleted(field.key);
    setCacheBuster(Date.now());
    if (field.uploadType === "favicon") {
      const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
      if (link) link.href = `/icon?v=${Date.now()}`; // i18n-ignore URL
    }
  };

  const previewUrl = value ? `/api/${value.startsWith("branding/") ? "" : "files/"}${value}?t=${cacheBuster}` : null;
  const isLogo = field.uploadType === "logo";
  const isBackground = field.uploadType === "login-bg";

  return (
    <div className="grid gap-1.5">
      <Label>{fieldText.label(field)}</Label>
      <div className="flex items-center gap-3">
        {previewUrl && (
          <div className="relative group shrink-0">
            <img
              src={previewUrl}
              alt={fieldText.label(field)}
              className={`object-contain ${isBackground ? "h-24 w-40 rounded border bg-white" : isLogo ? "h-20 max-w-[200px]" : "h-10 w-10 rounded border bg-white"}`}
            />
            <button
              type="button"
              onClick={handleDelete}
              className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={field.accept}
          onChange={handleUpload}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
          {uploading ? t("image.uploading") : t("image.chooseFile")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("image.formats")}
      </p>
    </div>
  );
}

function ThemedImageVariant({
  label,
  icon: Icon,
  configKey,
  value,
  uploadType,
  variant,
  accept,
  bgClass,
  onUploaded,
  onDeleted,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  configKey: string;
  value: string | undefined;
  uploadType: string;
  variant: "light" | "dark";
  accept?: string;
  bgClass: string;
  onUploaded: (key: string, path: string) => void;
  onDeleted: (key: string) => void;
}) {
  const t = useTranslations("settings");
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const queryClient = useQueryClient();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", uploadType);
      formData.append("variant", variant);

      const res = await fetch("/api/branding/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");

      const json = await res.json();
      onUploaded(configKey, json.path);
      setCacheBuster(Date.now());
      queryClient.invalidateQueries({ queryKey: ["config"] });
      if (uploadType === "favicon") {
        const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
        if (link) link.href = `/icon?v=${Date.now()}`; // i18n-ignore URL
      }
    } catch {
      // silent
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = () => {
    onDeleted(configKey);
    setCacheBuster(Date.now());
    if (uploadType === "favicon") {
      const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
      if (link) link.href = `/icon?v=${Date.now()}`; // i18n-ignore URL
    }
  };

  const previewUrl = value ? `/api/${value.startsWith("branding/") ? "" : "files/"}${value}?t=${cacheBuster}` : null;
  const isBackground = uploadType === "login-bg";
  const isLogo = uploadType === "logo";

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={cn("rounded-md p-3 flex min-w-0 items-center justify-center min-h-[60px]", bgClass)}>
        {previewUrl ? (
          <div className="relative group min-w-0 max-w-full">
            {/* max-w-full: at 375 px the thumbnail is ~100 px wide, the logo must not overflow it */}
            <img
              src={previewUrl}
              alt={label}
              className={`object-contain max-w-full ${isBackground ? "h-20 w-36 rounded" : isLogo ? "h-20 w-auto sm:max-w-[200px]" : "h-8 w-8"}`}
            />
            <button
              type="button"
              onClick={handleDelete}
              className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{t("image.noImage")}</span>
        )}
      </div>
      <input ref={inputRef} type="file" accept={accept} onChange={handleUpload} className="hidden" />
      <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
        {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
        {uploading ? t("image.uploading") : t("image.choose")}
      </Button>
    </div>
  );
}

function ThemedImageField({
  field,
  values,
  onUploaded,
  onDeleted,
}: {
  field: ConfigField;
  values: Record<string, string>;
  onUploaded: (key: string, path: string) => void;
  onDeleted: (key: string) => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const fieldText = useFieldText();
  const lightKey = field.lightKey!;
  const darkKey = field.darkKey!;

  return (
    <div className="grid gap-1.5">
      <Label>{fieldText.label(field)}</Label>
      <div className="grid grid-cols-2 gap-3">
        <ThemedImageVariant
          label={tc("theme.light")}
          icon={Sun}
          configKey={lightKey}
          value={values[lightKey]}
          uploadType={field.uploadType!}
          variant="light"
          accept={field.accept}
          bgClass="bg-white border"
          onUploaded={onUploaded}
          onDeleted={onDeleted}
        />
        <ThemedImageVariant
          label={tc("theme.dark")}
          icon={Moon}
          configKey={darkKey}
          value={values[darkKey]}
          uploadType={field.uploadType!}
          variant="dark"
          accept={field.accept}
          bgClass="bg-zinc-900 border border-zinc-700"
          onUploaded={onUploaded}
          onDeleted={onDeleted}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("image.themedFormats")}
      </p>
    </div>
  );
}

function DateTimePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { format: formatLocal } = useDateFormat();
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Parse "YYYY-MM-DD HH:MM" format
  const datePart = value ? value.split(" ")[0] : "";
  const timePart = value ? value.split(" ")[1] || "" : "";
  const selectedDate = datePart ? parseISO(datePart) : undefined;

  function handleDateSelect(date: Date | undefined) {
    if (!date) {
      onChange("");
      setCalendarOpen(false);
      return;
    }
    const dateStr = format(date, "yyyy-MM-dd");
    onChange(timePart ? `${dateStr} ${timePart}` : `${dateStr} 18:00`);
    setCalendarOpen(false);
  }

  function handleTimeChange(time: string) {
    if (!datePart) {
      // Auto-set to today if no date selected
      const today = format(new Date(), "yyyy-MM-dd");
      onChange(time ? `${today} ${time}` : "");
      return;
    }
    onChange(time ? `${datePart} ${time}` : datePart);
  }

  function handleClear() {
    onChange("");
  }

  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "flex-1 justify-start text-left font-normal h-9",
                !datePart && "text-muted-foreground"
              )}
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              {selectedDate
                ? formatLocal(selectedDate, "d MMMM yyyy")
                : t("dateTime.selectDate")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              defaultMonth={selectedDate}
              weekStartsOn={1}
            />
          </PopoverContent>
        </Popover>

        <div className="w-[140px]">
          <TimePicker
            value={timePart}
            onChange={handleTimeChange}
            placeholder={t("dateTime.timePlaceholder")}
            minuteStep={15}
          />
        </div>

        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={handleClear}
            title={tc("actions.clear")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function TestSmsButton() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [testPhone, setTestPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const qc = useQueryClient();

  const handleTest = async () => {
    if (!testPhone) {
      setResult({ ok: false, message: t("test.sms.phoneRequired") });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/sms/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testPhone }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setResult({ ok: true, message: t("test.sms.success") });
      } else {
        setResult({ ok: false, message: json.error || t("test.sendError") });
      }
    } catch {
      setResult({ ok: false, message: t("test.connectionError") });
    } finally {
      setSending(false);
      qc.invalidateQueries({ queryKey: ["sms-stats"] });
    }
  };

  return (
    <div className="mt-6 pt-6 border-t max-w-2xl">
      <Label className="text-sm font-medium">{t("test.sms.title")}</Label>
      <div className="flex gap-2 mt-2">
        <Input
          type="tel"
          placeholder="+33612345678"
          value={testPhone}
          onChange={(e) => setTestPhone(e.target.value)}
          className="max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={handleTest} disabled={sending}>
          {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
          {sending ? tc("states.sending") : tc("actions.test")}
        </Button>
      </div>
      {result && (
        <p className={`flex items-center gap-1 text-sm mt-2 ${result.ok ? "text-green-600" : "text-red-600"}`}>
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {result.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        {t("test.sms.help")}
      </p>
    </div>
  );
}

function SentDmTemplatesPanel() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sent.dm variables `{{1}}`…`{{5}}`: literal braces passed as parameters.
  const baseTemplate = t("sentDm.template", { v1: "{{1}}", v2: "{{2}}", v3: "{{3}}", v4: "{{4}}", v5: "{{5}}" });
  const renderVar = (chunks: React.ReactNode) => <code className="bg-muted px-1 py-0.5 rounded">{chunks}</code>;
  const renderBold = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

  const handleCopy = () => {
    navigator.clipboard.writeText(baseTemplate).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mt-6 pt-6 border-t max-w-2xl">
      <Label className="text-sm font-medium">{t("sentDm.title")}</Label>
      <p className="text-xs text-muted-foreground mt-1 mb-3">
        {t.rich("sentDm.intro", {
          link: (chunks) => <a href="https://app.sent.dm" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{chunks}</a>,
        })}
      </p>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left hover:bg-muted/50 transition-colors">
            <span className="text-lg">💬</span>
            <span className="flex-1 text-sm font-medium">{t("sentDm.templateName")}</span>
            <span className="rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 px-2 py-0.5 text-[10px] font-medium">{t("sentDm.variablesBadge", { count: 5 })}</span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-3 pt-3 space-y-2 text-xs text-muted-foreground">
          <p>
            {t("sentDm.createWith")}
          </p>
          <ul className="list-disc list-inside ml-2 space-y-0.5">
            <li>{t.rich("sentDm.vars.appName", { variable: "{{1}}", code: renderVar, b: renderBold })}</li>
            <li>{t.rich("sentDm.vars.eventType", { variable: "{{2}}", code: renderVar })}</li>
            <li>{t.rich("sentDm.vars.projectName", { variable: "{{3}}", code: renderVar })}</li>
            <li>{t.rich("sentDm.vars.taskTitle", { variable: "{{4}}", code: renderVar })}</li>
            <li>{t.rich("sentDm.vars.appUrl", { variable: "{{5}}", code: renderVar, b: renderBold })}</li>
          </ul>
          <p className="mt-2">{t("sentDm.suggestedContent")}</p>
          <div className="relative">
            <pre className="rounded-md border bg-muted/50 p-3 text-xs font-mono overflow-x-auto select-all pr-16 whitespace-pre-wrap">{baseTemplate}</pre>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute top-1.5 right-1.5 h-7 text-xs"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : tc("actions.copy")}
            </Button>
          </div>
          <p className="mt-2">
            {t.rich("sentDm.outro", { b: renderBold })}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function WeeklySummaryTestButton() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTest = async () => {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/weekly-summary/test", { method: "POST" });
      const json = await res.json();
      if (res.ok && json.success) {
        setResult({ ok: true, message: t("test.weeklySummary.success") });
      } else {
        setResult({ ok: false, message: json.error || t("test.sendError") });
      }
    } catch {
      setResult({ ok: false, message: t("test.connectionError") });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-6 pt-6 border-t max-w-2xl">
      <Label className="text-sm font-medium">{t("test.weeklySummary.title")}</Label>
      <div className="flex gap-2 mt-2">
        <Button variant="outline" size="sm" onClick={handleTest} disabled={sending}>
          {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
          {sending ? tc("states.sending") : t("test.weeklySummary.send")}
        </Button>
      </div>
      {result && (
        <p className={`flex items-center gap-1 text-sm mt-2 ${result.ok ? "text-green-600" : "text-amber-600"}`}>
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {result.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        {t("test.weeklySummary.help")}
      </p>
    </div>
  );
}

function TestEmailButton() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [testEmail, setTestEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const qc = useQueryClient();

  const handleTest = async () => {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmail || undefined }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setResult({ ok: true, message: t("test.email.success") });
      } else {
        setResult({ ok: false, message: json.error || t("test.sendError") });
      }
    } catch {
      setResult({ ok: false, message: t("test.connectionError") });
    } finally {
      setSending(false);
      qc.invalidateQueries({ queryKey: ["email-stats"] });
    }
  };

  return (
    <div className="mt-6 pt-6 border-t max-w-2xl">
      <Label className="text-sm font-medium">{t("test.email.title")}</Label>
      <div className="flex gap-2 mt-2">
        <Input
          type="email"
          placeholder={t("test.email.placeholder")}
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          className="max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={handleTest} disabled={sending}>
          {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
          {sending ? tc("states.sending") : tc("actions.test")}
        </Button>
      </div>
      {result && (
        <p className={`flex items-center gap-1 text-sm mt-2 ${result.ok ? "text-green-600" : "text-red-600"}`}>
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {result.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        {t("test.email.help")}
      </p>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const fieldText = useFieldText();
  const { format: formatLocal } = useDateFormat();
  const urlSearchParams = useSearchParams();
  const rawTabParam = urlSearchParams.get("tab");
  const tabParam = rawTabParam ? (LEGACY_TAB_IDS[rawTabParam] ?? rawTabParam) : null;
  const [activeTab, setActiveTab] = useState("general");

  useEffect(() => {
    if (tabParam && CONFIG_CATEGORIES.some(c => c.id === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const { data: config, isLoading } = useConfig();
  const updateConfig = useUpdateConfig();

  // Metadata exposed by GET /api/config for secret-handling UI
  const { envManaged, dbConfigured, emailStatus, altchaConfigured } = parseConfigMeta(config);
  const envManagedSet = new Set(envManaged);
  const dbConfiguredSet = new Set(dbConfigured);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [activeSubSection, setActiveSubSection] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const cat of CONFIG_CATEGORIES) {
      const nav = CATEGORY_NAV[cat.id];
      if (nav?.[0]) initial[cat.id] = nav[0].id;
    }
    return initial;
  });

  useEffect(() => {
    if (config) {
      const v: Record<string, string> = {};
      // Seed default values for all fields so they get saved on first save
      for (const cat of CONFIG_CATEGORIES) {
        for (const field of cat.fields) {
          if (field.defaultValue && !config[field.key]) {
            v[field.key] = field.defaultValue;
          }
        }
      }
      for (const [key, val] of Object.entries(config)) {
        // Skip metadata keys (_envManaged, _dbConfigured, _emailStatus) and non-string values
        if (key.startsWith("_")) continue;
        if (typeof val === "string") v[key] = val;
      }
      // Auto-compute DURATION_DAY from work hours
      v.DURATION_DAY = computeDurationDay(v);
      setValues(v);
      setDirty(false);
    }
  }, [config]);

  const queryClient = useQueryClient();
  const { can, isLoading: permLoading } = usePermissions();

  const setValue = (key: string, value: string) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-calculate DURATION_DAY when work hours change
      if (["AM_START", "AM_END", "PM_START", "PM_END"].includes(key)) {
        next.DURATION_DAY = computeDurationDay(next);
      }
      return next;
    });
    setDirty(true);
  };

  function computeDurationDay(v: Record<string, string>): string {
    const parseMin = (t: string) => { const [h, m] = (t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
    const am = parseMin(v.AM_END || "12:00") - parseMin(v.AM_START || "08:00");
    const pm = parseMin(v.PM_END || "17:00") - parseMin(v.PM_START || "13:30");
    const total = Math.max(0, am) + Math.max(0, pm);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const deleteImageValue = async (key: string) => {
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: "" }),
      });
      setValues((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["config"] });
    } catch {
      // silent
    }
  };

  const handleSave = () => {
    // Auto-bump announcement version when announcement is enabled
    if (values.ANNOUNCEMENT_ENABLED === "true") {
      values.ANNOUNCEMENT_VERSION = String(Date.now());
    }
    // Build payload: exclude env-managed secrets (backend would ignore them anyway)
    // and exclude empty password fields already stored in DB (avoid overwriting with empty).
    const payload: Record<string, string> = {};
    for (const [key, val] of Object.entries(values)) {
      if (envManagedSet.has(key)) continue;
      if (dbConfiguredSet.has(key) && (val === "" || val == null)) continue;
      payload[key] = val;
    }
    updateConfig.mutate(payload, { onSuccess: () => setDirty(false) });
  };

  // --- Purge button with date picker (files / tasks) ---
  function PurgeWithDateButton({
    entity,
    label,
    variant = "destructive",
  }: {
    entity: "files" | "tasks";
    label: string;
    variant?: "default" | "destructive" | "outline";
  }) {
    const [open, setOpen] = useState(false);
    const [dateOpen, setDateOpen] = useState(false);
    const [before, setBefore] = useState<string>("");
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<number | null>(null);

    const endpoint = entity === "files" ? "/api/files/purge" : "/api/tasks/purge";
    const title = entity === "files" ? t("purge.files.title") : t("purge.tasks.title");
    const description = entity === "files" ? t("purge.files.description") : t("purge.tasks.description");

    async function handlePurge() {
      if (!before || pending) return;
      setPending(true);
      setResult(null);
      try {
        const res = await fetch(endpoint, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ before }),
        });
        await throwIfNotOk(res);
        const data = await res.json();
        const count = (data?.deleted as number | undefined) ?? 0;
        setResult(count);
        setBefore("");
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: entity === "files" ? ["files"] : ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["storage-stats"] });
        queryClient.invalidateQueries({ queryKey: ["audit"] });
        setTimeout(() => setResult(null), 5000);
      } catch {
        // ignore
      } finally {
        setPending(false);
      }
    }

    return (
      <>
        <Button variant={variant} size="sm" onClick={() => setOpen(true)} disabled={pending}>
          {label}
        </Button>
        {result !== null && (
          <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">
            {t("purge.result", { count: result })}
          </span>
        )}
        <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setBefore(""); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-2">
              <Label className="text-xs">{t("purge.dateLabel")}</Label>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start mt-1", !before && "text-muted-foreground")}>
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {before ? formatLocal(parseISO(before), "d MMMM yyyy") : t("dateTime.selectDate")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={before ? parseISO(before) : undefined}
                    onSelect={(d) => { setBefore(d ? format(d, "yyyy-MM-dd") : ""); setDateOpen(false); }}
                    weekStartsOn={1}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={!before || pending}
                onClick={handlePurge}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {pending ? t("purge.pending") : t("purge.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  // --- Action button component with confirmation dialog ---
  function ActionButton({ actionId, label, variant = "destructive" }: {
    actionId: string; label: string; variant?: "default" | "destructive" | "outline";
  }) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [done, setDone] = useState(false);

    async function handleAction() {
      if (pending) return;
      setPending(true);
      setDone(false);
      try {
        if (actionId === "purge_notifications") {
          const res = await fetch("/api/notifications/purge", { method: "DELETE" });
          await throwIfNotOk(res);
        }
        setDone(true);
        setConfirmOpen(false);
        setTimeout(() => setDone(false), 3000);
      } catch {
        // ignore
      } finally {
        setPending(false);
      }
    }

    return (
      <>
        <Button variant={variant} size="sm" onClick={() => setConfirmOpen(true)} disabled={done}>
          {done ? t("actionButton.done") : label}
        </Button>
        <DeleteConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t("actionButton.purgeNotifications.title")}
          description={t("actionButton.purgeNotifications.description")}
          onConfirm={handleAction}
          isPending={pending}
          variant="danger"
        />
      </>
    );
  }

  if (permLoading) return <p className="text-center text-muted-foreground p-8">{tc("states.loading")}</p>;
  if (!can("pages:settings")) return <ErrorState code={403} compact showBack={false} />;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <Tabs
      value={activeTab}
      className="-mt-3 md:-mt-6"
      onValueChange={(v) => {
        setActiveTab(v);
        // Reset all sub-sections to their first item when switching main tab
        const reset: Record<string, string> = {};
        for (const cat of CONFIG_CATEGORIES) {
          const nav = CATEGORY_NAV[cat.id];
          if (nav?.[0]) reset[cat.id] = nav[0].id;
        }
        setActiveSubSection(reset);
      }}
    >
      {/* Sticky header + tabs */}
      <div className="sticky -top-3 md:-top-6 z-30 bg-background border-b -mx-3 md:-mx-6 px-3 md:px-6 pb-3 pt-2 md:pt-3 mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("page.title")}</h1>
          <div className="flex items-center gap-3">
            {updateConfig.error && (
              <span className="text-sm text-destructive max-w-md truncate" title={updateConfig.error.message}>
                {updateConfig.error.message}
              </span>
            )}
            <Button
              onClick={handleSave}
              disabled={!dirty || updateConfig.isPending}
              size="sm"
            >
              <Save className="mr-1.5 h-4 w-4" />
              {updateConfig.isPending ? tc("actions.saving") : tc("actions.save")}
            </Button>
          </div>
        </div>
        {/* Mobile: compact "Category ▸ Section" breadcrumb that opens
            a side Sheet with the full hierarchy as an accordion.
            UX benefit: a single tap to navigate between categories AND
            sub-sections, while keeping a clean look on screen. */}
        <SettingsMobileNav
          activeTab={activeTab}
          activeSubSection={activeSubSection}
          onSelect={(catId, subId) => {
            setActiveTab(catId);
            setActiveSubSection((prev) => {
              const next = { ...prev };
              if (subId) {
                next[catId] = subId;
              } else {
                const navItems = CATEGORY_NAV[catId];
                if (navItems?.[0]) next[catId] = navItems[0].id;
              }
              return next;
            });
          }}
        />
        <TabsList className="mt-3 hidden md:flex md:flex-wrap h-auto gap-1 p-1">
          {CONFIG_CATEGORIES.map((cat) => (
            <TabsTrigger key={cat.id} value={cat.id}>
              {tDyn(t, `categories.${cat.id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

        {CONFIG_CATEGORIES.map((cat) => {
          const navItems = CATEGORY_NAV[cat.id] ?? [];
          const showNav = navItems.length > 1;
          // id of the active nav entry (stable identifier, never a label)
          const activeNav = activeSubSection[cat.id] ?? navItems[0]?.id ?? "";

          // Partition fields: only show fields belonging to the active nav section
          const navStartSections = navItems.map(n => n.section ?? n.id);
          const activeNavIdx = navItems.findIndex(n => n.id === activeNav);
          const activeHeader = navStartSections[activeNavIdx] ?? "";
          const nextHeader = activeNavIdx + 1 < navStartSections.length ? navStartSections[activeNavIdx + 1] : null;
          const startIdx = cat.fields.findIndex(f => f.section === activeHeader);
          const endIdx = nextHeader ? cat.fields.findIndex(f => f.section === nextHeader) : cat.fields.length;
          const sectionFields = startIdx >= 0 ? cat.fields.slice(startIdx, endIdx >= 0 ? endIdx : cat.fields.length) : cat.fields;

          return (
          <TabsContent key={cat.id} value={cat.id} className="mt-4 pb-24 md:pb-12">
            <div className={showNav ? "flex flex-col lg:flex-row lg:gap-6" : ""}>
              {showNav && (
                <SettingsSectionNav
                  navItems={navItems}
                  activeSection={activeNav}
                  onSelect={(label) => setActiveSubSection(prev => ({ ...prev, [cat.id]: label }))}
                />
              )}
              <div className="flex-1 min-w-0 min-h-[60vh]">
            <div className="space-y-6 max-w-2xl">
              {activeNav === "files" && <StorageStats />}
              {cat.id === "version" && <VersionPanel />}
              {(() => {
                const visibleFields = sectionFields.filter((field) => {
                  if (!field.visibleWhen) return true;
                  const currentVal = values[field.visibleWhen.key] ?? "";
                  const expected = field.visibleWhen.value;
                  const matches = Array.isArray(expected) ? expected.includes(currentVal) : currentVal === expected;
                  if (!matches) return false;
                  if (field.visibleWhen.and) {
                    const andVal = values[field.visibleWhen.and.key] ?? "";
                    const andExpected = field.visibleWhen.and.value;
                    return Array.isArray(andExpected) ? andExpected.includes(andVal) : andVal === andExpected;
                  }
                  return true;
                });
                // Group fields by section (stable id; displayed title: settings.sections.<id>)
                const sections: { id: string | null; header: string | null; fields: typeof visibleFields }[] = [];
                let currentSection: typeof sections[0] = { id: null, header: null, fields: [] };
                for (const field of visibleFields) {
                  if (field.section) {
                    if (currentSection.fields.length > 0) sections.push(currentSection);
                    currentSection = { id: field.section, header: tDyn(t, `sections.${field.section}`), fields: [field] };
                  } else {
                    currentSection.fields.push(field);
                  }
                }
                if (currentSection.fields.length > 0) sections.push(currentSection);
                return sections.map((section, si) => (
                  <React.Fragment key={si}>
                  <div className={cn(section.header ? "rounded-lg border bg-card p-4 space-y-4" : "space-y-4")}>
                    {section.header && (
                      <h3 className="text-sm font-semibold text-foreground border-b pb-2">{section.header}</h3>
                    )}
                    {section.id === "email" && emailStatus && !emailStatus.configured && (
                      <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                        <div className="space-y-1">
                          <p className="font-medium text-destructive">{t("alerts.emailDisabled.title")}</p>
                          <p className="text-muted-foreground">
                            {t.rich("alerts.emailDisabled.description", {
                              provider: emailStatus.provider,
                              keys: emailStatus.missingKeys.join(", "),
                              b: (chunks) => <strong>{chunks}</strong>,
                              code: (chunks) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{chunks}</code>,
                            })}
                          </p>
                        </div>
                      </div>
                    )}
                    {section.id === "captcha" && values.CAPTCHA_ENABLED === "true" && (values.CAPTCHA_PROVIDER || "altcha") === "altcha" && !altchaConfigured && (
                      <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                        <div className="space-y-1">
                          <p className="font-medium text-destructive">{t("alerts.altchaMissing.title")}</p>
                          <p className="text-muted-foreground">
                            {t.rich("alerts.altchaMissing.description", {
                              code: (chunks) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{chunks}</code>,
                            })}
                          </p>
                        </div>
                      </div>
                    )}
                    {section.fields.map((field) => (
                <div key={field.key}>
                  <div className="grid gap-1.5">
                  {field.type === "themed-image" ? (
                    <ThemedImageField
                      field={field}
                      values={values}
                      onUploaded={(key, path) => setValue(key, path)}
                      onDeleted={deleteImageValue}
                    />
                  ) : field.type === "image" ? (
                    <ImageField
                      field={field}
                      value={values[field.key]}
                      onUploaded={(key, path) => setValue(key, path)}
                      onDeleted={deleteImageValue}
                    />
                  ) : field.type === "richtext" ? (
                    <>
                      <Label>{fieldText.label(field)}</Label>
                      {field.key === "PRIVACY_POLICY_CONTENT" && (
                        <p className="text-xs text-muted-foreground -mt-1">
                          {t("richText.variables")}{PRIVACY_VARIABLES.map((v) => <React.Fragment key={v}>{" "}<code className="bg-muted px-1 rounded text-[10px]">{v}</code></React.Fragment>)}
                        </p>
                      )}
                      <RichTextEditor
                        content={values[field.key] ?? ""}
                        onChange={(html) => {
                          setValue(field.key, html);
                          if (field.key === "PRIVACY_POLICY_CONTENT") {
                            // ISO date (yyyy-MM-dd): /privacy formats it in the reader's language.
                            setValue("PRIVACY_POLICY_LAST_UPDATED", format(new Date(), "yyyy-MM-dd"));
                          }
                        }}
                        placeholder={field.key === "ANNOUNCEMENT_CONTENT" ? t("richText.announcementPlaceholder") : t("richText.privacyPlaceholder")}
                      />
                      {field.key === "PRIVACY_POLICY_CONTENT" && (
                        <p className="text-xs text-muted-foreground">
                          {t("richText.pageUrl")} <a href={`${values.APP_BASE_URL || "http://localhost:3000"}/privacy`} target="_blank" className="text-primary underline">{values.APP_BASE_URL || "http://localhost:3000"}/privacy</a>
                        </p>
                      )}
                    </>
                  ) : field.type === "boolean" ? (
                    <div className="flex items-center justify-between">
                      <Label htmlFor={field.key} className={field.key === "DEFAULT_SMS_NOTIFICATIONS" ? "text-muted-foreground/60" : undefined}>
                        {fieldText.label(field)}
                      </Label>
                      {field.key === "DEFAULT_SMS_NOTIFICATIONS" ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Switch id={field.key} checked={false} disabled />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{tc("states.comingSoon")}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Switch
                          id={field.key}
                          checked={values[field.key] === "true" || values[field.key] === "1"}
                          onCheckedChange={(checked) =>
                            setValue(field.key, checked ? "true" : "false")
                          }
                        />
                      )}
                    </div>
                  ) : field.type === "select" && field.options ? (
                    <>
                      <Label htmlFor={field.key}>{fieldText.label(field)}</Label>
                      <Select
                        value={values[field.key] ?? field.defaultValue ?? ""}
                        onValueChange={(v) => setValue(field.key, v)}
                      >
                        <SelectTrigger id={field.key} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              <span className="flex items-center gap-2">
                                {fieldText.option(field, opt)}
                                {opt.recommended && (
                                  <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: "#7c3aed" }}>
                                    {t("badges.recommended")}
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : field.type === "multiselect" && field.options ? (
                    <MultiselectCheckboxes
                      field={field}
                      selected={(values[field.key] ?? field.defaultValue ?? "").split(",").filter(Boolean)}
                      onChange={(ids) => setValue(field.key, ids.join(","))}
                    />
                  ) : field.type === "taglist" ? (
                    <TagListInput
                      label={fieldText.label(field)}
                      value={values[field.key] ?? ""}
                      onChange={(v) => setValue(field.key, v)}
                    />
                  ) : field.type === "color" ? (
                    <>
                      <Label>{fieldText.label(field)}</Label>
                      <ColorPicker
                        value={values[field.key] ?? field.defaultValue ?? "#3b82f6"}
                        onChange={(c) => setValue(field.key, c)}
                      />
                    </>
                  ) : field.type === "icon" ? (
                    <>
                      <Label>{fieldText.label(field)}</Label>
                      <IconPicker
                        value={values[field.key] ?? field.defaultValue ?? "Megaphone"}
                        onChange={(icon) => setValue(field.key, icon)}
                      />
                    </>
                  ) : field.type === "time" ? (
                    <>
                      <Label>{fieldText.label(field)}</Label>
                      <div className="w-[160px]">
                        <TimePicker
                          value={values[field.key] ?? field.defaultValue ?? "00:00"}
                          onChange={(v) => setValue(field.key, v)}
                          placeholder="HH:MM"
                          minuteStep={15}
                        />
                      </div>
                    </>
                  ) : field.type === "datetime" ? (
                    <DateTimePicker
                      label={fieldText.label(field)}
                      value={values[field.key] ?? ""}
                      onChange={(v) => setValue(field.key, v)}
                    />
                  ) : field.type === "action" ? (
                    field.actionId === "purge_files" || field.actionId === "purge_tasks" ? (
                      <PurgeWithDateButton
                        entity={field.actionId === "purge_files" ? "files" : "tasks"}
                        label={fieldText.actionLabel(field)}
                        variant={field.actionVariant}
                      />
                    ) : (
                      <ActionButton
                        actionId={field.actionId!}
                        label={fieldText.actionLabel(field)}
                        variant={field.actionVariant}
                      />
                    )
                  ) : (
                    (() => {
                      const isEnvManaged = field.type === "password" && envManagedSet.has(field.key);
                      const isDbConfigured = field.type === "password" && dbConfiguredSet.has(field.key);
                      const displayValue = isEnvManaged
                        ? "••••••••••••"
                        : (values[field.key] ?? field.defaultValue ?? "");
                      const placeholder = isDbConfigured && !values[field.key]
                        ? t("field.keepSecretPlaceholder")
                        : fieldText.placeholder(field);
                      const disabled = isEnvManaged;
                      const readOnly = field.key === "DURATION_DAY" || field.readOnly || isEnvManaged;
                      return (
                        <>
                          <div className="flex items-center gap-2">
                            <Label htmlFor={field.key}>{fieldText.label(field)}</Label>
                            {isEnvManaged && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:text-amber-200">
                                    <KeyRound className="h-3 w-3" />
                                    {t("field.envManaged")}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("field.envManagedTooltip")}
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {isDbConfigured && !isEnvManaged && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-900 dark:text-emerald-200">
                                <CheckCircle2 className="h-3 w-3" />
                                {t("field.configured")}
                              </span>
                            )}
                          </div>
                          <Input
                            id={field.key}
                            type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                            value={displayValue}
                            onChange={(e) => setValue(field.key, e.target.value)}
                            placeholder={placeholder}
                            readOnly={readOnly}
                            disabled={disabled}
                            className={readOnly || disabled ? "bg-muted cursor-not-allowed" : ""}
                          />
                        </>
                      );
                    })()
                  )}
                  {(() => {
                    const description = fieldText.description(field);
                    return description && <p className="text-xs text-muted-foreground">{description}</p>;
                  })()}
                  </div>
                </div>
                    ))}
                  </div>
                  </React.Fragment>
                ));
              })()}
              {activeNav === "application" && <SocketStatusPanel />}
              {activeNav === "email" && (
                <>
                  <EmailStats />
                  <TestEmailButton />
                  {values.EMAIL_PROVIDER === "nuntly" && (
                    <>
                      <WebhookStatusCard />
                      <WebhookLogsTable />
                    </>
                  )}
                  <EmailBlocklistTable isActive={values.EMAIL_PROVIDER === "nuntly"} />
                </>
              )}
              {activeNav === "sms" && (
                <>
                  <SmsStats />
                  <TestSmsButton />
                  <SentDmTemplatesPanel />
                </>
              )}
              {activeNav === "weeklySummary" && <WeeklySummaryTestButton />}
              {activeNav === "apiAccess" && values.API_ENABLED === "true" && <ApiKeysPanel baseUrl={values.APP_BASE_URL || "http://localhost:3000"} />}
              {activeNav === "cache" && values.CACHE_ENABLED === "true" && <CacheStatsPanel />}
              {activeNav === "mcp" && values.MCP_ENABLED === "true" && (
                <>
                  <McpSetupGuide baseUrl={values.APP_BASE_URL || "http://localhost:3000"} />
                  <McpAllKeysPanel />
                </>
              )}
              {activeNav === "aiChat" && <AiChatSettingsPanel />}
              {activeNav === "aiChatQuotas" && <AiChatQuotasPanel />}
              {activeNav === "backup" && <BackupPanel />}
              {activeNav === "import" && <ImportPanel />}
              {activeNav === "migration" && <MigrationPanel />}
            </div>
              </div>
            </div>
          </TabsContent>
          );
        })}
    </Tabs>
  );
}

function ApiKeysPanel({ baseUrl }: { baseUrl: string }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { formatDateTime } = useDateFormat();
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { can } = usePermissions();
  const canEdit = can("settings:edit");

  const loadKeys = async () => {
    try {
      const res = await fetch("/api/api-keys");
      if (res.ok) setKeys(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { loadKeys(); }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedKey(data.fullKey);
        setNewKeyName("");
        loadKeys();
      }
    } catch { /* silent */ }
    setCreating(false);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/api-keys/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      loadKeys();
    } catch { /* silent */ }
    setDeleting(false);
  };

  const copyKey = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="text-xs text-muted-foreground">
          {t.rich("panels.apiKeys.intro", { code: (chunks) => <code className="bg-muted px-1 rounded text-[11px]">{chunks}</code> })}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-1.5">
        <Label className="text-xs font-medium">{t("panels.apiKeys.apiUrl")}</Label>
        <code className="block rounded-md border bg-muted px-3 py-2 text-sm font-mono select-all">
          {baseUrl}/api
        </code>
        <div className="flex gap-2 pt-1">
          <a href="/api-docs" target="_blank" className="text-xs text-primary hover:underline">
            {t("panels.apiKeys.docsLink")}
          </a>
        </div>
      </div>

      {/* Created key alert */}
      {createdKey && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 p-4 space-y-2">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            {t("panels.apiKeys.created")}
          </p>
          <div className="flex gap-2">
            <code className="flex-1 rounded-md border bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono select-all break-all">
              {createdKey}
            </code>
            <Button variant="outline" size="sm" onClick={() => copyKey(createdKey)}>
              {keyCopied ? <Check className="h-4 w-4 text-emerald-600" /> : tc("actions.copy")}
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setCreatedKey(null)}>
            {t("panels.apiKeys.copiedClose")}
          </Button>
        </div>
      )}

      {/* Create new key */}
      {canEdit && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h4 className="text-sm font-medium">{t("panels.apiKeys.createTitle")}</h4>
          <div className="flex gap-2">
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t("panels.apiKeys.namePlaceholder")}
              className="flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <Button size="sm" onClick={handleCreate} disabled={creating || !newKeyName.trim()}>
              {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {tc("actions.create")}
            </Button>
          </div>
        </div>
      )}

      {/* Keys list */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t("panels.apiKeys.activeKeys")}</h4>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("panels.apiKeys.empty")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2 text-left font-medium">{t("keys.columns.name")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("keys.columns.key")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("keys.columns.createdAt")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("keys.columns.lastUsed")}</th>
                  {canEdit && <th className="px-3 py-2 w-10" />}
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{k.name}</td>
                    <td className="px-3 py-2"><code className="bg-muted px-1 rounded text-xs">{k.keyPrefix}</code></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDateTime(k.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : tc("time.never")}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget({ id: k.id, name: k.name })}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        variant="danger"
        title={t("panels.apiKeys.confirmDelete.title")}
        description={t("panels.apiKeys.confirmDelete.description", { name: deleteTarget?.name ?? "" })}
        onConfirm={handleDeleteConfirm}
        isPending={deleting}
        confirmLabel={tc("actions.delete")}
      />
    </div>
  );
}

function CacheStatsPanel() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { data: configData } = useConfig();
  const [stats, setStats] = useState<{ enabled: boolean; ttlSeconds: number; entries: number; expired: number } | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      const res = await fetch("/api/cache");
      if (res.ok) setStats(await res.json());
    } catch { /* silent */ }
  };

  // Reload stats when config changes (after save)
  useEffect(() => { loadStats(); }, [configData?.CACHE_ENABLED, configData?.CACHE_TTL]);

  const handleClear = async () => {
    setClearing(true);
    setClearResult(null);
    try {
      const res = await fetch("/api/cache", { method: "DELETE" });
      if (res.ok) {
        setClearResult(t("panels.cache.cleared"));
        loadStats();
      }
    } catch {
      setClearResult(tc("status.error"));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="max-w-2xl mt-6 pt-6 border-t space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">{t("panels.cache.howItWorks.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("panels.cache.howItWorks.description")}
        </p>
      </div>

      {stats && (
        <div className="rounded-lg border bg-card p-4">
          <h4 className="text-sm font-medium mb-3">{t("panels.cache.state")}</h4>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{stats.entries}</p>
              <p className="text-xs text-muted-foreground">{t("panels.cache.entries")}</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.ttlSeconds}s</p>
              <p className="text-xs text-muted-foreground">{t("panels.cache.ttl")}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">{stats.enabled ? tc("states.active") : tc("states.inactive")}</p>
              <p className="text-xs text-muted-foreground">{t("panels.cache.status")}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={handleClear} disabled={clearing}>
          {clearing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <X className="mr-1 h-4 w-4" />}
          {t("panels.cache.clear")}
        </Button>
        <Button variant="ghost" size="sm" onClick={loadStats}>
          {t("panels.cache.refreshStats")}
        </Button>
      </div>

      {clearResult && (
        <p className="flex items-center gap-1 text-sm text-emerald-600">
          <CheckCircle2 className="h-4 w-4" />
          {clearResult}
        </p>
      )}
    </div>
  );
}

function McpAllKeysPanel() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tMcp = useTranslations("mcp");
  const { formatDateTime } = useDateFormat();
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; user: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/mcp/keys");
      if (res.ok) setKeys(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => {
    if (open && keys.length === 0) loadKeys();
  }, [open]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/mcp/keys/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      loadKeys();
    } catch { /* silent */ }
    setDeleting(false);
  };

  return (
    <div className="max-w-2xl mt-6 pt-6 border-t">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" type="button" className="w-full justify-between px-2 h-9 text-sm font-semibold">
            <span>{t("panels.mcpKeys.title", { count: open ? String(keys.length) : "..." })}</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{t("panels.mcpKeys.empty")}</p>
          ) : (
            <>
            {/* Mobile: stacked cards (the 5-column table does not fit in 375 px). */}
            <ul className="space-y-2 sm:hidden">
              {keys.map((k) => {
                const displayName = [k.userFirstName, k.userName].filter(Boolean).join(" ");
                return (
                  <li key={k.id} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="font-medium break-words">{k.name || "—"}</p>
                      <p className="break-words">
                        {displayName}
                        {k.userLogin && <span className="text-xs text-muted-foreground ml-1">({k.userLogin})</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tMcp("keys.list.createdOn", { date: formatDateTime(k.createdAt) })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {k.lastUsedAt ? tMcp("lastUsed", { date: formatDateTime(k.lastUsedAt) }) : tMcp("keys.list.neverUsed")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                      aria-label={tMcp("revoke")}
                      onClick={() => setDeleteTarget({ id: k.id, name: k.name || t("panels.mcpKeys.unnamed"), user: displayName })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-hidden rounded-lg border sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium">{t("keys.columns.name")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("keys.columns.user")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("keys.columns.createdAt")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("keys.columns.lastUsed")}</th>
                    <th className="px-3 py-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => {
                    const displayName = [k.userFirstName, k.userName].filter(Boolean).join(" ");
                    return (
                      <tr key={k.id} className="border-b last:border-0">
                        <td className="px-3 py-2">{k.name || "—"}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{displayName}</span>
                          {k.userLogin && <span className="text-xs text-muted-foreground ml-1">({k.userLogin})</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {formatDateTime(k.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : tc("time.never")}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            aria-label={tMcp("revoke")}
                            onClick={() => setDeleteTarget({ id: k.id, name: k.name || t("panels.mcpKeys.unnamed"), user: displayName })}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
          {!loading && keys.length > 0 && (
            <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={loadKeys}>
              {t("panels.mcpKeys.refresh")}
            </Button>
          )}
        </CollapsibleContent>
      </Collapsible>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        variant="danger"
        title={t("panels.mcpKeys.confirmRevoke.title")}
        description={t("panels.mcpKeys.confirmRevoke.description", { name: deleteTarget?.name ?? "", user: deleteTarget?.user ?? "" })}
        onConfirm={handleDelete}
        isPending={deleting}
        confirmLabel={t("panels.mcpKeys.confirmRevoke.confirm")}
      />
    </div>
  );
}

function McpClientGuide({ title, icon, method, children }: { title: string; icon: string; method: "remote" | "local" | "both"; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const methodBadge = method === "remote" ? "Remote (HTTP)" : method === "local" ? "Local (stdio)" : "Remote + Local";
  const methodColor = method === "remote" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
    method === "local" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
    "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="w-full flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left hover:bg-muted/50 transition-colors">
          <span className="text-lg">{icon}</span>
          <span className="flex-1 text-sm font-medium">{title}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", methodColor)}>{methodBadge}</span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-3 pt-2 space-y-2 text-xs text-muted-foreground">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function McpSetupGuide({ baseUrl }: { baseUrl: string }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const mcpUrl = `${baseUrl}/api/mcp`;
  const keyPlaceholder = t("panels.mcpGuide.keyPlaceholder");
  const [copiedText, setCopiedText] = useState("");
  const renderBold = (chunks: React.ReactNode) => <strong>{chunks}</strong>;
  const renderCode = (chunks: React.ReactNode) => <code className="bg-muted px-1 rounded">{chunks}</code>;

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedText(id);
      setTimeout(() => setCopiedText(""), 2000);
    });
  }

  function CodeSnippet({ code, id }: { code: string; id: string }) {
    return (
      <div className="relative">
        <pre className="rounded-md border bg-muted/50 p-3 text-xs font-mono overflow-x-auto select-all pr-16">
          {code}
        </pre>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute top-1.5 right-1.5 h-7 text-xs"
          onClick={() => copy(code, id)}
        >
          {copiedText === id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : tc("actions.copy")}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mt-6 pt-6 border-t space-y-5">
      <div>
        <h3 className="text-sm font-semibold mb-1">{t("panels.mcpGuide.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("panels.mcpGuide.intro")}
        </p>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50 px-4 py-3 space-y-1">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          {t.rich("panels.mcpGuide.oauthInfo", { b: renderBold })}
        </p>
        <p className="text-xs text-blue-700 dark:text-blue-300">
          {t.rich("panels.mcpGuide.manualInfo", { b: renderBold, code: (chunks) => <code>{chunks}</code> })}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">{t("panels.mcpGuide.serverUrl")}</Label>
        <div className="flex items-stretch gap-2">
          <code className="flex-1 min-w-0 break-all rounded-md border bg-muted px-3 py-2 text-sm font-mono select-all flex items-center">
            {mcpUrl}
          </code>
          <Button type="button" variant="outline" className="h-auto px-4" onClick={() => copy(mcpUrl, "url")}>
            {copiedText === "url" ? <Check className="h-4 w-4 text-emerald-600" /> : tc("actions.copy")}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium">{t("panels.mcpGuide.integrations")}</Label>

        <McpClientGuide title="Claude (web, Desktop, mobile)" icon="🖥️" method="remote">
          <p>{t.rich("panels.mcpGuide.clients.claude.step", { b: renderBold })}</p>
          <CodeSnippet code={mcpUrl} id="claude-desktop-url" />
          <p>{t("panels.mcpGuide.clients.claude.note")}</p>
        </McpClientGuide>

        <McpClientGuide title="Claude Code (CLI)" icon="⌨️" method="remote">
          <p>{t("panels.mcpGuide.clients.claudeCode.run")}</p>
          <CodeSnippet code={`claude mcp add --scope user --transport http humbleplanning ${mcpUrl}`} id="claude-code" />
          <p>{t.rich("panels.mcpGuide.clients.claudeCode.withKey", { code: renderCode })}</p>
          <CodeSnippet code={`claude mcp add --scope user --transport http humbleplanning ${mcpUrl} --header "Authorization: Bearer ${keyPlaceholder}"`} id="claude-code-key" />
        </McpClientGuide>

        <McpClientGuide title="ChatGPT (Web & Desktop)" icon="💬" method="remote">
          <p>{t("panels.mcpGuide.clients.chatgpt.devMode")}</p>
          <p>{t("panels.mcpGuide.clients.chatgpt.createApp")}</p>
          <CodeSnippet code={mcpUrl} id="chatgpt-url" />
          <p>{t("panels.mcpGuide.clients.chatgpt.oauth")}</p>
        </McpClientGuide>

        <McpClientGuide title="Cursor" icon="📝" method="both">
          <p>{t.rich("panels.mcpGuide.clients.cursor.remote", { b: renderBold, code: renderCode })}</p>
          <CodeSnippet code={JSON.stringify({ mcpServers: { humbleplanning: { url: mcpUrl, headers: { Authorization: `Bearer ${keyPlaceholder}` } } } }, null, 2)} id="cursor" />
        </McpClientGuide>

        <McpClientGuide title="VS Code / Copilot" icon="💎" method="both">
          <p>{t("panels.mcpGuide.clients.vscode.add")}</p>
          <CodeSnippet code={JSON.stringify({ servers: { humbleplanning: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${keyPlaceholder}` } } } }, null, 2)} id="vscode" />
        </McpClientGuide>

        <McpClientGuide title="Windsurf" icon="🏄" method="both">
          <CodeSnippet code={JSON.stringify({ mcpServers: { humbleplanning: { serverUrl: mcpUrl, headers: { Authorization: `Bearer ${keyPlaceholder}` } } } }, null, 2)} id="windsurf" />
        </McpClientGuide>

        <McpClientGuide title="JetBrains AI Assistant" icon="🧠" method="remote">
          <p>{t("panels.mcpGuide.clients.jetbrains.path")}</p>
          <CodeSnippet code={JSON.stringify({ mcpServers: { humbleplanning: { url: mcpUrl } } }, null, 2)} id="jetbrains" />
        </McpClientGuide>

        <McpClientGuide title={t("panels.mcpGuide.clients.other.title")} icon="🔌" method="both">
          <p>{t.rich("panels.mcpGuide.clients.other.remote", { b: renderBold })}</p>
          <p>{t.rich("panels.mcpGuide.clients.other.bearer", { b: renderBold })}</p>
          <CodeSnippet code={`Authorization: Bearer ${keyPlaceholder}`} id="other-header" />
          <p>{t.rich("panels.mcpGuide.clients.other.noQueryToken", { code: renderCode })}</p>
        </McpClientGuide>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 px-4 py-3">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t.rich("panels.mcpGuide.prerequisite", {
            b: renderBold,
            code: (chunks) => <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-[11px]">{chunks}</code>,
          })}
        </p>
      </div>
    </div>
  );
}

function BackupPanel() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const errorMessage = useApiErrorMessage();
  const { formatDateTime, formatNumber, locale } = useDateFormat();
  const { can } = usePermissions();
  const canView = can("pages:backups");
  const canCreate = can("backups:create");
  const canDownload = can("backups:download");
  const canDelete = can("backups:delete");

  const [page, setPage] = useState(1);
  const { data, isLoading } = useBackups(page, 10);
  const createBackup = useCreateBackup();
  const deleteBackup = useDeleteBackup();
  const downloadBackup = useDownloadBackup();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; filename: string } | null>(null);

  if (!canView) return null;

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${formatNumber(ms)}ms`;
    return `${formatNumber(ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`;
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 10);
  const keyConfigured = data?.encryptionKeyConfigured ?? false;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <h3 className="text-sm font-semibold text-foreground border-b pb-2">{tc("table.actions")}</h3>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {keyConfigured ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-950 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                <ShieldCheck className="size-3.5" />
                {t("panels.backup.keyConfigured")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-950 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                <ShieldX className="size-3.5" />
                {t("panels.backup.keyMissing")}
              </span>
            )}
          </div>
          {canCreate && (
            <Button
              onClick={() => createBackup.mutate()}
              disabled={createBackup.isPending || !keyConfigured}
              size="sm"
            >
              {createBackup.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Database className="mr-1.5 h-4 w-4" />
              )}
              {createBackup.isPending ? t("panels.backup.creating") : t("panels.backup.create")}
            </Button>
          )}
        </div>
        {!keyConfigured && (
          <p className="text-xs text-muted-foreground">
            {t.rich("panels.backup.keyHelp", { code: (chunks) => <code className="bg-muted px-1 rounded text-[10px]">{chunks}</code> })}
          </p>
        )}
        {createBackup.error && (
          <p className="text-sm text-destructive">{createBackup.error.message}</p>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t.rich("panels.backup.warning", { b: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-4">
        <h3 className="text-sm font-semibold text-foreground border-b pb-2">
          {t("panels.backup.history")} {total > 0 && <span className="text-muted-foreground font-normal">({total})</span>}
        </h3>

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{t("panels.backup.empty")}</p>
        ) : (
          <>
            <div
              className="overflow-x-auto overflow-y-auto overscroll-contain touch-pan-y max-h-[620px] [-webkit-overflow-scrolling:touch]"
              // 10 fully visible rows (~58 px each with the user
              // sub-label × 10 = 580 px + header ~40 px ≈ 620 px). Beyond that, a
              // vertical scrollbar appears inside the table to
              // browse the following rows — the pagination below
              // handles moving to the next 10 entries.
              // Sticky header to stay visible while scrolling. Touch-pan-y +
              // -webkit-overflow-scrolling for smooth iOS scrolling.
            >
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">{t("panels.backup.columns.date")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("panels.backup.columns.size")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("panels.backup.columns.duration")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("panels.backup.columns.type")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("panels.backup.columns.status")}</th>
                    <th className="pb-2 font-medium text-right">{tc("table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((backup) => (
                    <tr key={backup.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <div className="font-medium">{formatDateTime(backup.createdAt)}</div>
                        {backup.user && (
                          <div className="text-xs text-muted-foreground">
                            {backup.user.firstName ? `${backup.user.firstName} ${backup.user.name}` : backup.user.name}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">{formatSize(backup.sizeBytes, locale)}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">{formatDuration(backup.durationMs)}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                          backup.triggerType === "manual"
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                            : "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                        )}>
                          {backup.triggerType === "manual" ? t("panels.backup.trigger.manual") : t("panels.backup.trigger.scheduled")}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        {backup.status === "completed" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 px-2 py-0.5 text-xs font-medium">
                            <CheckCircle2 className="size-3" /> {t("panels.backup.status.completed")}
                          </span>
                        ) : backup.status === "failed" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 px-2 py-0.5 text-xs font-medium" title={backup.errorMessage ? errorMessage({ code: backup.errorMessage, message: backup.errorMessage }) : ""}>
                            <XCircle className="size-3" /> {t("panels.backup.status.failed")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300 px-2 py-0.5 text-xs font-medium">
                            <Loader2 className="size-3 animate-spin" /> {t("panels.backup.status.inProgress")}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canDownload && backup.status === "completed" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => downloadBackup.mutate(backup.id)}
                              disabled={downloadBackup.isPending}
                              title={tc("actions.download")}
                            >
                              <Download className="size-3.5" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget({ id: backup.id, filename: backup.filename })}
                              title={tc("actions.delete")}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                  {tc("pagination.pageOf", { page, total: totalPages })}
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    {tc("pagination.previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    {tc("pagination.next")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("panels.backup.confirmDelete.title")}
        description={t("panels.backup.confirmDelete.description", { filename: deleteTarget?.filename ?? "" })}
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) {
            deleteBackup.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
          }
        }}
        isPending={deleteBackup.isPending}
      />
    </div>
  );
}

/** "Server unreachable" error sentinel (translated at render time). */
const SOCKET_UNREACHABLE = "unreachable";

function SocketStatusPanel() {
  const t = useTranslations("settings");
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [serverInfo, setServerInfo] = useState<{ uptime: number; clients: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function check() {
      try {
        // Go through a Next.js route (same origin) that proxies to
        // localhost:3001/health — avoids CSP + no need to expose port 3001.
        const res = await fetch(`/api/socket-health`, { signal: AbortSignal.timeout(5000) });
        if (!mounted) return;
        if (res.ok) {
          const data = await res.json();
          setStatus("connected");
          setServerInfo(data);
          setError(null);
        } else {
          setStatus("disconnected");
          setError(`HTTP ${res.status}`);
        }
      } catch {
        if (!mounted) return;
        setStatus("disconnected");
        setError(SOCKET_UNREACHABLE);
      }
    }
    check();
    const interval = setInterval(check, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return t("panels.socket.uptimeDays", { d, h, m });
    if (h > 0) return t("panels.socket.uptimeHours", { h, m });
    return t("panels.socket.uptimeMinutes", { m });
  }

  return (
    <div className="max-w-2xl">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground border-b pb-2 flex items-center gap-2">
          <Radio className="size-4" />
          {t("panels.socket.title")}
        </h3>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status === "connected" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 dark:bg-green-950 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                <Wifi className="size-3.5" />
                {t("panels.socket.connected")}
              </span>
            ) : status === "connecting" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-50 dark:bg-yellow-950 px-2.5 py-1 text-xs font-medium text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800">
                <Loader2 className="size-3.5 animate-spin" />
                {t("panels.socket.connecting")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-950 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                <WifiOff className="size-3.5" />
                {t("panels.socket.disconnected")}
              </span>
            )}
          </div>

          {serverInfo && status === "connected" && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>{t("panels.socket.uptime", { value: formatUptime(serverInfo.uptime) })}</span>
              <span>{t("panels.socket.clients", { count: serverInfo.clients })}</span>
            </div>
          )}
        </div>

        {error && status === "disconnected" && (
          <p className="text-xs text-muted-foreground">
            {t.rich("panels.socket.notResponding", { error: error === SOCKET_UNREACHABLE ? t("panels.socket.unreachable") : error, code: (chunks) => <code className="bg-muted px-1 rounded text-[10px]">{chunks}</code> })}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {t("panels.socket.description")}
        </p>
      </div>
    </div>
  );
}

function ImportPanel() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const errorMessage = useApiErrorMessage();
  const tableLabel = (table: string) => {
    const key = `panels.import.tables.${table}`;
    return hasDyn(t, key) ? tDyn(t, key) : table;
  };
  const analyzeImport = useAnalyzeImport();
  const executeImport = useExecuteImport();
  const cleanupImport = useCleanupImport();
  const createBackup = useCreateBackup();
  const downloadBackup = useDownloadBackup();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = React.useState<"idle" | "analyzing" | "analyzed" | "executing" | "done">("idle");
  const [analysis, setAnalysis] = React.useState<ImportAnalysis | null>(null);
  const [result, setResult] = React.useState<{ success: boolean; mode: string; inserted?: Record<string, number>; error?: string } | null>(null);
  const [replaceDialogOpen, setReplaceDialogOpen] = React.useState(false);
  const [backupDone, setBackupDone] = React.useState(false);
  const [backupError, setBackupError] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [fileName, setFileName] = React.useState<string | null>(null);

  // Cleanup temp DB on unmount only (not on step changes)
  const stepRef = React.useRef(step);
  stepRef.current = step;
  React.useEffect(() => {
    return () => {
      if (stepRef.current === "analyzed") cleanupImport.mutate();
    };
  }, []);

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".dump")) {
      setResult({ success: false, mode: "", error: t("panels.import.dumpOnly") });
      setStep("done");
      return;
    }
    setFileName(file.name);
    setStep("analyzing");
    setResult(null);
    try {
      const data = await analyzeImport.mutateAsync(file);
      setAnalysis(data);
      setStep("analyzed");
    } catch (err) {
      setResult({ success: false, mode: "", error: errorMessage(err) });
      setStep("done");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleMerge = async () => {
    setStep("executing");
    try {
      const res = await executeImport.mutateAsync("merge");
      setResult({ success: true, mode: "merge", inserted: res.inserted });
      setStep("done");
    } catch (err) {
      setResult({ success: false, mode: "merge", error: errorMessage(err) });
      setStep("done");
    }
  };

  const handleReplace = async () => {
    setReplaceDialogOpen(false);
    setStep("executing");
    try {
      await executeImport.mutateAsync("replace");
      setResult({ success: true, mode: "replace" });
      setStep("done");
      // Sessions have been invalidated server-side — force full page reload after 3s
      setTimeout(() => {
        window.location.href = "/login";
      }, 3000);
    } catch (err) {
      setResult({ success: false, mode: "replace", error: errorMessage(err) });
      setStep("done");
    }
  };

  const handleBackupAndDownload = async () => {
    setBackupError(null);
    try {
      const backup = await createBackup.mutateAsync();
      await downloadBackup.mutateAsync((backup as any).id);
      setBackupDone(true);
    } catch {
      setBackupError(t("panels.backupStep.error"));
    }
  };

  const handleCancel = () => {
    cleanupImport.mutate();
    setStep("idle");
    setAnalysis(null);
    setResult(null);
    setFileName(null);
  };

  const handleReset = () => {
    setStep("idle");
    setAnalysis(null);
    setResult(null);
    setFileName(null);
    setBackupDone(false);
    setBackupError(null);
  };

  return (
    <div className="space-y-6">
      {/* Explanation + Upload zone */}
      {step === "idle" && (
        <>
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b pb-3 flex items-center gap-2">
              <Database className="h-4 w-4" />
              {t("panels.import.title")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t.rich("panels.import.intro", { code: (chunks) => <code className="text-xs bg-muted px-1 py-0.5 rounded">{chunks}</code> })}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div className="rounded-md border p-3 space-y-1">
                <p className="font-medium text-foreground flex items-center gap-1.5">
                  <Merge className="h-3.5 w-3.5 text-primary" />
                  {t("panels.import.mergeMode.title")}
                </p>
                <p>{t("panels.import.mergeMode.description")}</p>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <p className="font-medium text-foreground flex items-center gap-1.5">
                  <Replace className="h-3.5 w-3.5 text-red-500" />
                  {t("panels.import.replaceMode.title")}
                </p>
                <p>{t("panels.import.replaceMode.description")}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("panels.import.analysisNote")}
            </p>
          </div>

          <div
            className={cn(
              "rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".dump" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
            <UploadCloud className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">{t("panels.import.dropTitle")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("panels.import.dropHint")}</p>
          </div>
        </>
      )}

      {/* Analyzing */}
      {step === "analyzing" && (
        <div className="rounded-lg border bg-card p-8 text-center space-y-3">
          <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
          <p className="text-sm font-medium">{t("panels.import.analyzing")}</p>
          <p className="text-xs text-muted-foreground">{t("panels.import.analyzingDetail")}</p>
          {fileName && <p className="text-xs font-mono text-muted-foreground">{fileName}</p>}
        </div>
      )}

      {/* Analysis results */}
      {step === "analyzed" && analysis && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <h3 className="text-sm font-semibold border-b pb-3">{t("panels.import.content")}</h3>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium">{t("panels.import.columns.entity")}</th>
                    <th className="pb-2 font-medium text-right">{t("panels.import.columns.inDump")}</th>
                    <th className="pb-2 font-medium text-right">{t("panels.import.columns.live")}</th>
                    <th className="pb-2 font-medium text-right">{t("panels.import.columns.new")}</th>
                    <th className="pb-2 font-medium text-right">{t("panels.import.columns.conflicts")}</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.tables.filter(row => row.countInDump > 0).map((row) => {
                    const newCount = Math.max(0, row.countInDump - row.conflictCount);
                    return (
                      <tr key={row.table} className="border-b last:border-0">
                        <td className="py-2">{tableLabel(row.table)}</td>
                        <td className="py-2 text-right font-mono">{row.countInDump}</td>
                        <td className="py-2 text-right font-mono">{row.countInLive}</td>
                        <td className={cn("py-2 text-right font-mono", newCount > 0 && "text-green-600 dark:text-green-400 font-medium")}>{newCount}</td>
                        <td className={cn("py-2 text-right font-mono", row.conflictCount > 0 && "text-orange-600 dark:text-orange-400 font-medium")}>{row.conflictCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const totalNew = analysis.tables.filter(row => row.countInDump > 0).reduce((sum, row) => sum + Math.max(0, row.countInDump - row.conflictCount), 0);
                    return (
                      <tr className="border-t font-medium">
                        <td className="pt-2">{tc("table.total")}</td>
                        <td className="pt-2 text-right font-mono">{analysis.totalInDump}</td>
                        <td className="pt-2 text-right font-mono">{analysis.tables.filter(row => row.countInDump > 0).reduce((sum, row) => sum + row.countInLive, 0)}</td>
                        <td className={cn("pt-2 text-right font-mono", totalNew > 0 && "text-green-600 dark:text-green-400")}>{totalNew}</td>
                        <td className={cn("pt-2 text-right font-mono", analysis.totalConflicts > 0 && "text-orange-600 dark:text-orange-400")}>{analysis.totalConflicts}</td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>
          </div>

          {analysis.totalConflicts > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950/30">
              <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm text-orange-700 dark:text-orange-400">
                {t("panels.import.conflicts", { count: analysis.totalConflicts })}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(() => {
              const totalNew = analysis.tables.filter(row => row.countInDump > 0).reduce((sum, row) => sum + Math.max(0, row.countInDump - row.conflictCount), 0);
              const disabled = totalNew === 0;
              return (
                <button type="button" onClick={disabled ? undefined : handleMerge}
                  disabled={disabled}
                  className={cn("rounded-lg border p-4 text-left transition-colors", disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-accent/50 cursor-pointer")}>
                  <div className="flex items-center gap-2 mb-2">
                    <Merge className="h-5 w-5 text-primary" />
                    <span className="text-sm font-semibold">{t("panels.import.merge.title")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {disabled ? t("panels.import.merge.nothing") : t("panels.import.merge.description")}
                  </p>
                </button>
              );
            })()}
            <button type="button" onClick={() => { setReplaceDialogOpen(true); setBackupDone(false); setBackupError(null); }}
              className="rounded-lg border border-red-200 p-4 text-left hover:bg-red-50/50 dark:border-red-800 dark:hover:bg-red-950/20 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <Replace className="h-5 w-5 text-red-500" />
                <span className="text-sm font-semibold text-red-700 dark:text-red-400">{t("panels.import.replace.title")}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("panels.import.replace.description")}
              </p>
            </button>
          </div>

          <Button variant="outline" onClick={handleCancel} className="w-full">{t("panels.import.cancel")}</Button>
        </div>
      )}

      {/* Executing */}
      {step === "executing" && (
        <div className="rounded-lg border bg-card p-8 text-center space-y-3">
          <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
          <p className="text-sm font-medium">{t("panels.import.executing")}</p>
          <p className="text-xs text-muted-foreground">{t("panels.import.executingDetail")}</p>
        </div>
      )}

      {/* Result */}
      {step === "done" && result && (
        <div className="space-y-4">
          {result.success ? (
            <div className="rounded-lg border border-green-200 bg-green-50/50 p-4 space-y-3 dark:border-green-800 dark:bg-green-950/20">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                  {t("panels.import.success", { mode: result.mode })}
                </span>
              </div>
              {result.inserted && Object.entries(result.inserted).filter(([, v]) => v > 0).length > 0 && (
                <div className="text-xs text-green-700 dark:text-green-400 space-y-0.5">
                  {Object.entries(result.inserted).filter(([, v]) => v > 0).map(([table, count]) => (
                    <div key={table} className="flex justify-between">
                      <span>{tableLabel(table)}</span>
                      <span className="font-mono">{t("panels.import.added", { count })}</span>
                    </div>
                  ))}
                </div>
              )}
              {result.mode === "replace" && (
                <div className="flex items-center gap-2 pt-2 border-t border-green-200 dark:border-green-800">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-green-600 dark:text-green-400" />
                  <p className="text-xs text-green-700 dark:text-green-400">
                    {t("panels.import.sessionsInvalidated")}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 space-y-2 dark:border-red-800 dark:bg-red-950/20">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <span className="text-sm font-semibold text-red-700 dark:text-red-400">{t("panels.import.failed")}</span>
              </div>
              {result.error && <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>}
            </div>
          )}
          <Button variant="outline" onClick={handleReset} className="w-full">{tc("actions.finish")}</Button>
        </div>
      )}

      {/* Replace confirmation dialog */}
      <AlertDialog open={replaceDialogOpen} onOpenChange={(open) => { setReplaceDialogOpen(open); if (!open) { setBackupDone(false); setBackupError(null); } }}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              {t("panels.import.replaceDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("panels.import.replaceDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className={cn("rounded-lg border p-4 space-y-3", backupDone ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20" : "border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20")}>
            <div className="flex items-center gap-2">
              <div className={cn("flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold shrink-0", backupDone ? "bg-green-500 text-white" : "bg-orange-500 text-white")}>
                {backupDone ? <Check className="h-3.5 w-3.5" /> : "1"}
              </div>
              <span className="text-sm font-medium">{backupDone ? t("panels.backupStep.done") : t("panels.backupStep.todo")}</span>
            </div>
            {!backupDone && (
              <Button onClick={handleBackupAndDownload} disabled={createBackup.isPending || downloadBackup.isPending} variant="outline" className="w-full">
                {createBackup.isPending ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {t("panels.backupStep.creating")}</>
                  : downloadBackup.isPending ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {t("panels.backupStep.downloading")}</>
                  : <><Database className="mr-1.5 h-3.5 w-3.5" /> {t("panels.backupStep.createAndDownload")}</>}
              </Button>
            )}
            {backupDone && (
              <>
                <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{t("panels.backupStep.downloaded")} <button type="button" onClick={handleBackupAndDownload} className="underline hover:no-underline ml-1">{t("panels.backupStep.redownload")}</button></p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{t("panels.backupStep.unencrypted")}</p>
              </>
            )}
            {backupError && <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 shrink-0" />{backupError}</p>}
          </div>

          <div className={cn("rounded-lg border p-4 space-y-3", backupDone ? "border-border" : "border-muted bg-muted/30 opacity-60")}>
            <div className="flex items-center gap-2">
              <div className={cn("flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold shrink-0", backupDone ? "bg-destructive text-destructive-foreground" : "bg-muted-foreground/30 text-muted-foreground")}>2</div>
              <span className="text-sm font-medium">{t("panels.import.replaceDialog.confirmStep")}</span>
            </div>
            {!backupDone && <p className="text-xs text-muted-foreground">{t("panels.backupStep.downloadFirst")}</p>}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleReplace} disabled={!backupDone}
              className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90", !backupDone && "opacity-50 cursor-not-allowed")}>
              {t("panels.import.replace.title")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Migration ───────────────────────────────────────────────────────────────

const MIGRATION_SOURCES = [
  { value: "soplanning-1.55", label: "SoPlanning", version: "v1.55.00" },
  { value: "soplanning-1.56", label: "SoPlanning", version: "v1.56.00" },
  { value: "soplanning-1.57", label: "SoPlanning", version: "v1.57.00" },
] as const;

type MigrationSource = typeof MIGRATION_SOURCES[number]["value"];
// The SoPlanning entries use the same component: the analysis
// service automatically detects the version in version.info and the
// processing (CSV mapping, deduplication, etc.) is identical.
const isSoPlanning = (s: string) => s.startsWith("soplanning-");

function MigrationPanel() {
  const t = useTranslations("settings");
  const [source, setSource] = React.useState<MigrationSource | "">("");

  return (
    <div className="space-y-6">
      {/* Source selector */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground border-b pb-3 flex items-center gap-2">
          <Database className="h-4 w-4" />
          {t("panels.migration.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("panels.migration.intro")}
        </p>
        <div className="max-w-xl">
          <Label htmlFor="migration-source" className="text-xs text-muted-foreground mb-1.5 block">{t("panels.migration.source")}</Label>
          <Select value={source} onValueChange={(v) => setSource(v as MigrationSource)}>
            <SelectTrigger id="migration-source" className="h-11">
              <SelectValue placeholder={t("panels.migration.sourcePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {MIGRATION_SOURCES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label} {s.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Render the appropriate migration panel */}
      {isSoPlanning(source) && <SoPlanningMigration />}
    </div>
  );
}

// ─── SoPlanning Migration ────────────────────────────────────────────────────

function SoPlanningMigration() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const errorMessage = useApiErrorMessage();
  const entityLabel = (entity: string) => {
    const key = `panels.migration.entities.${entity}`;
    return hasDyn(t, key) ? tDyn(t, key) : entity;
  };
  const renderBold = (chunks: React.ReactNode) => <strong>{chunks}</strong>;
  const analyzeMigration = useAnalyzeMigration();
  const executeMigration = useExecuteMigration();
  const cleanupMigration = useCleanupMigration();
  const createBackup = useCreateBackup();
  const downloadBackup = useDownloadBackup();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = React.useState<"idle" | "analyzing" | "analyzed" | "executing" | "done">("idle");
  const [analysis, setAnalysis] = React.useState<MigrationAnalysis | null>(null);
  const [result, setResult] = React.useState<MigrationResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [replaceDialogOpen, setReplaceDialogOpen] = React.useState(false);
  const [backupDone, setBackupDone] = React.useState(false);
  const [backupError, setBackupError] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [finalizeDialogOpen, setFinalizeDialogOpen] = React.useState(false);

  // Cleanup on unmount
  const stepRef = React.useRef(step);
  stepRef.current = step;
  React.useEffect(() => {
    return () => {
      if (stepRef.current === "analyzed") cleanupMigration.mutate();
    };
  }, []);

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".zip")) {
      setError(t("panels.migration.soplanning.zipOnly"));
      setStep("done");
      return;
    }
    setFileName(file.name);
    setStep("analyzing");
    setError(null);
    setResult(null);
    try {
      const data = await analyzeMigration.mutateAsync(file);
      setAnalysis(data);
      setStep("analyzed");
    } catch (err) {
      setError(errorMessage(err));
      setStep("done");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleExecute = async () => {
    setReplaceDialogOpen(false);
    setStep("executing");
    try {
      const res = await executeMigration.mutateAsync();
      setResult(res);
      setStep("done");
    } catch (err) {
      setError(errorMessage(err));
      setStep("done");
    }
  };

  const handleBackupAndDownload = async () => {
    setBackupError(null);
    try {
      const backup = await createBackup.mutateAsync();
      await downloadBackup.mutateAsync((backup as any).id);
      setBackupDone(true);
    } catch {
      setBackupError(t("panels.backupStep.error"));
    }
  };

  const handleCancel = () => {
    cleanupMigration.mutate();
    setStep("idle");
    setAnalysis(null);
    setResult(null);
    setError(null);
    setFileName(null);
  };

  const handleReset = () => {
    setStep("idle");
    setAnalysis(null);
    setResult(null);
    setError(null);
    setFileName(null);
    setBackupDone(false);
    setBackupError(null);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  // Sessions were purged by the migration: start again from a clean
  // client state and send back to /login (full reload).
  const handleFinalize = () => {
    clearLocalSession();
    window.location.href = "/login";
  };

  return (
    <div className="space-y-6">
      {/* ── Idle: explanation + upload ── */}
      {step === "idle" && (
        <>
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b pb-3 flex items-center gap-2">
              <Database className="h-4 w-4" />
              {t("panels.migration.soplanning.title")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("panels.migration.soplanning.intro")}
            </p>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5 text-xs">
              <p className="font-medium text-amber-800 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("panels.migration.soplanning.important")}
              </p>
              <ul className="list-disc list-inside text-amber-700 space-y-1">
                <li>{t("panels.migration.soplanning.notes.passwords")}</li>
                <li>{t("panels.migration.soplanning.notes.changePassword")}</li>
                <li>{t("panels.migration.soplanning.notes.roles")}</li>
                <li>{t("panels.migration.soplanning.notes.superAdmin", { login: "humbleplanning" })}</li>
                <li>{t("panels.migration.soplanning.notes.backup")}</li>
              </ul>
            </div>
          </div>

          <div
            className={cn(
              "rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".zip" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
            <UploadCloud className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">{t("panels.migration.soplanning.dropTitle")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("panels.migration.soplanning.dropHint")}</p>
          </div>
        </>
      )}

      {/* ── Analyzing ── */}
      {step === "analyzing" && (
        <div className="rounded-lg border bg-card p-8 text-center space-y-3">
          <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
          <p className="text-sm font-medium">{t("panels.migration.soplanning.analyzing")}</p>
          <p className="text-xs text-muted-foreground">{t("panels.migration.soplanning.analyzingDetail")}</p>
          {fileName && <p className="text-xs font-mono text-muted-foreground">{fileName}</p>}
        </div>
      )}

      {/* ── Analyzed: results table ── */}
      {step === "analyzed" && analysis && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <h3 className="text-sm font-semibold border-b pb-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              {t("panels.migration.soplanning.analysisTitle", { version: analysis.version })}
            </h3>

            {/* Warnings */}
            {analysis.warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1 text-xs text-amber-700">
                {analysis.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {tDyn(t, `panels.migration.warnings.${w.key}`, w.params)}
                  </p>
                ))}
              </div>
            )}

            {/* Summary table */}
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium">{t("panels.migration.soplanning.columns.entity")}</th>
                    <th className="pb-2 font-medium text-right">{t("panels.migration.soplanning.columns.count")}</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.tables.filter(row => row.count > 0).map((row) => (
                    <tr key={row.entity} className="border-b last:border-0">
                      <td className="py-2">{entityLabel(row.entity)}</td>
                      <td className="py-2 text-right font-mono">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td className="pt-2">{tc("table.total")}</td>
                    <td className="pt-2 text-right font-mono">{analysis.totalRecords}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={handleCancel}>{tc("actions.cancel")}</Button>
            <Button variant="destructive" onClick={() => { setBackupDone(false); setBackupError(null); setReplaceDialogOpen(true); }}
              className="flex items-center gap-2">
              <Replace className="h-4 w-4" />
              {t("panels.migration.soplanning.start")}
            </Button>
          </div>
        </div>
      )}

      {/* ── Executing ── */}
      {step === "executing" && (
        <div className="rounded-lg border bg-card p-8 text-center space-y-3">
          <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
          <p className="text-sm font-medium">{t("panels.migration.soplanning.executing")}</p>
          <p className="text-xs text-muted-foreground">{t("panels.migration.soplanning.executingDetail")}</p>
        </div>
      )}

      {/* ── Done ── */}
      {step === "done" && (
        <div className="space-y-4">
          {error && !result && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-sm font-medium text-red-800 flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                {t("panels.migration.soplanning.failed")}
              </p>
              <p className="text-xs text-red-600">{error}</p>
              <Button variant="outline" size="sm" onClick={handleReset}>{t("panels.migration.soplanning.restart")}</Button>
            </div>
          )}

          {result?.success && (
            <div className="space-y-4">
              {/* Success summary */}
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-3">
                <p className="text-sm font-medium text-green-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("panels.migration.soplanning.success")}
                </p>
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {Object.entries(result.imported).map(([entity, count]) => (
                        <tr key={entity} className="border-b last:border-0">
                          <td className="py-1.5 text-green-700">{entityLabel(entity)}</td>
                          <td className="py-1.5 text-right font-mono text-green-800">{count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Passwords — critical info */}
              <div className="rounded-lg border-2 border-violet-300 bg-violet-50 p-5 space-y-4">
                <p className="text-sm font-bold text-violet-900 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5" />
                  {t("panels.migration.soplanning.credentials.title")}
                </p>
                <p className="text-xs text-violet-700">
                  {t("panels.migration.soplanning.credentials.warning")}
                </p>

                {/* All users password */}
                <div className="rounded-md bg-white border border-violet-200 p-3 space-y-1">
                  <p className="text-xs font-medium text-violet-800">{t("panels.migration.soplanning.credentials.usersPassword")}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm font-mono bg-violet-100 px-2 py-1 rounded select-all">{result.userPassword}</code>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copyToClipboard(result.userPassword, "user")}>
                      {copied === "user" ? <Check className="h-3 w-3" /> : tc("actions.copy")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("panels.migration.soplanning.credentials.usersPasswordHelp")}</p>
                </div>

                {/* Admin password */}
                <div className="rounded-md bg-white border border-violet-200 p-3 space-y-1">
                  <p className="text-xs font-medium text-violet-800">{t("panels.migration.soplanning.credentials.superAdmin")}</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16">{t("panels.migration.soplanning.credentials.login")}</span>
                      <code className="flex-1 text-sm font-mono bg-violet-100 px-2 py-1 rounded select-all">{result.adminLogin}</code>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copyToClipboard(result.adminLogin, "login")}>
                        {copied === "login" ? <Check className="h-3 w-3" /> : tc("actions.copy")}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16">{t("panels.migration.soplanning.credentials.password")}</span>
                      <code className="flex-1 text-sm font-mono bg-violet-100 px-2 py-1 rounded select-all">{result.adminPassword}</code>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copyToClipboard(result.adminPassword, "admin")}>
                        {copied === "admin" ? <Check className="h-3 w-3" /> : tc("actions.copy")}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Permissions reminder — SoPlanning rights don't map 1:1 to HumblePlanning RBAC */}
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 space-y-2">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {t("panels.migration.soplanning.reviewRoles.title")}
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  {t.rich("panels.migration.soplanning.reviewRoles.description", {
                    b: (chunks) => <span className="font-medium">{chunks}</span>,
                  })}
                </p>
              </div>

              {/* Manual redirect button — confirmation required */}
              <Button className="w-full" onClick={() => setFinalizeDialogOpen(true)}>
                {t("panels.migration.soplanning.finalize")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Finalize confirmation dialog ── */}
      <AlertDialog open={finalizeDialogOpen} onOpenChange={setFinalizeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t("panels.migration.soplanning.finalizeDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                {t.rich("panels.migration.soplanning.finalizeDialog.credentialsHidden", { b: renderBold })}
              </span>
              <span className="block">
                {t.rich("panels.migration.soplanning.finalizeDialog.logout", { b: renderBold })}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("panels.migration.soplanning.finalizeDialog.back")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalize}>
              {t("panels.migration.soplanning.finalizeDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Replace confirmation dialog with mandatory backup ── */}
      <AlertDialog open={replaceDialogOpen} onOpenChange={setReplaceDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t("panels.migration.soplanning.replaceDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">{t.rich("panels.migration.soplanning.replaceDialog.description", { b: renderBold })}</span>
              <span className="block font-medium">{t("panels.migration.soplanning.replaceDialog.step1")}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className={cn("rounded-lg border p-4 space-y-3", backupDone ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20" : "border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20")}>
            <div className="flex items-center gap-2">
              <div className={cn("flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold shrink-0", backupDone ? "bg-green-500 text-white" : "bg-orange-500 text-white")}>
                {backupDone ? <Check className="h-3.5 w-3.5" /> : "1"}
              </div>
              <span className="text-sm font-medium">{backupDone ? t("panels.backupStep.done") : t("panels.backupStep.todo")}</span>
            </div>
            {!backupDone && (
              <Button onClick={handleBackupAndDownload} disabled={createBackup.isPending || downloadBackup.isPending} variant="outline" className="w-full">
                {createBackup.isPending ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {t("panels.backupStep.creating")}</>
                  : downloadBackup.isPending ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {t("panels.backupStep.downloading")}</>
                  : <><Database className="mr-1.5 h-3.5 w-3.5" /> {t("panels.backupStep.createAndDownload")}</>}
              </Button>
            )}
            {backupDone && (
              <>
                <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{t("panels.backupStep.downloaded")} <button type="button" onClick={handleBackupAndDownload} className="underline hover:no-underline ml-1">{t("panels.backupStep.redownload")}</button></p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{t("panels.backupStep.unencrypted")}</p>
              </>
            )}
            {backupError && <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 shrink-0" />{backupError}</p>}
          </div>

          <div className={cn("rounded-lg border p-4 space-y-3", backupDone ? "border-border" : "border-muted bg-muted/30 opacity-60")}>
            <div className="flex items-center gap-2">
              <div className={cn("flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold shrink-0", backupDone ? "bg-destructive text-destructive-foreground" : "bg-muted-foreground/30 text-muted-foreground")}>2</div>
              <span className="text-sm font-medium">{t("panels.migration.soplanning.replaceDialog.confirmStep")}</span>
            </div>
            {!backupDone && <p className="text-xs text-muted-foreground">{t("panels.backupStep.downloadFirst")}</p>}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleExecute} disabled={!backupDone}
              className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90", !backupDone && "opacity-50 cursor-not-allowed")}>
              {t("panels.migration.soplanning.start")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

