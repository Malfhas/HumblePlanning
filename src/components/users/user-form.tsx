"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser, useCreateUser, useUpdateUser } from "@/hooks/use-users";
import { useQueryClient } from "@tanstack/react-query";
import { useTeams } from "@/hooks/use-teams";
import { useBuStore } from "@/stores/bu-store";
import { useQualifications } from "@/hooks/use-qualifications";
import { useRoles, useRoleDisplayName } from "@/hooks/use-roles";
import { useConfig } from "@/hooks/use-config";
import { useBusinessUnits } from "@/hooks/use-business-units";
import { useLaborTypes } from "@/hooks/use-labor-types";
import { useIsEmailBlocked } from "@/hooks/use-email-blocklist";
import type { UserWithTeam } from "@/types";
import { policyFromConfig, evaluatePassword } from "@/lib/password-policy";
import { PasswordStrengthBar } from "@/components/shared/password-strength-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ColorPicker } from "@/components/shared/color-picker";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, X, Shield, Lock, Pencil, Eye, EyeOff, Wand2, Clock, Mail, Loader2, CheckCircle2, Trash2, ShieldCheck, ShieldOff, Building2, UsersRound, HardHat, FileSignature } from "lucide-react";
import { CONTRACT_TYPES, getContractLabel, type ContractTypeKey } from "@/lib/constants/contract-types";
import { hasDyn, tDyn } from "@/i18n/dynamic";
import { generatePasswordFromConfig } from "@/lib/password-generator";
import { QualificationIcon } from "@/components/shared/icon-picker";
import { cn, contrastColor } from "@/lib/utils";
import { parseFieldErrors, clearFieldError, zodIssuesToFieldErrors } from "@/lib/utils/field-errors";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PhoneInputCustom, isValidPhoneNumber } from "@/components/shared/phone-input";

interface UserFormProps {
  id: string | null;
  /**
   * When set (and `id` is null), loads this user and pre-fills only the "generic"
   * fields (team, role, BU, labor type, color, qualifications, preferences, etc.)
   * — never the personal info (name, email, login, phone, password).
   */
  duplicateFromId?: string | null;
  onClose: () => void;
  onDelete?: () => void;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1">
      {children}
    </h3>
  );
}

// i18n-dynamic: users.contractTypes.*
export function UserForm({ id, duplicateFromId, onClose, onDelete }: UserFormProps) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const roleName = useRoleDisplayName();
  const contractLabel = (key: ContractTypeKey) => tDyn(t, `contractTypes.${key}`);
  /** `validation.zod.*` messages for Zod issues returned on a 422. */
  const zodMessage = (key: string) => {
    const k = key.replace(/^validation\./, "");
    return hasDyn(tv, k) ? tDyn(tv, k) : null;
  };
  // unscoped=true : /users page grants edit/duplicate on any user in the BU,
  // bypassing userScope (scope:users_* is planning-only).
  const { data: user, isLoading } = useUser(id, true);
  const { data: sourceUser } = useUser(duplicateFromId && !id ? duplicateFromId : null, true);
  const { data: teams } = useTeams();
  const { selectedBuIds } = useBuStore();
  const { data: qualifications } = useQualifications();
  const { data: roles } = useRoles();
  const { data: configData } = useConfig();
  const { data: businessUnitsList } = useBusinessUnits();
  const { data: laborTypesList } = useLaborTypes();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const queryClient = useQueryClient();

  const passwordPolicy = useMemo(
    () => policyFromConfig(configData ?? {}),
    [configData]
  );

  const [form, setForm] = useState({
    name: "",
    firstName: "",
    email: "",
    username: "",
    teamId: "",
    roleId: "",
    color: "#FFFFFF",
    job: "",
    phone: "",
    mobile: "",
    address: "",
    comment: "",
    active: true,
    notifications: false,
    pushNotifications: false,
    smsNotifications: false,
    visibleOnPlanning: true,
    defaultHourlyRate: "",
    password: "",
    qualificationIds: [] as string[],
    businessUnitId: "",
    laborTypeId: "",
    contractType: "",
  });

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atTop = el.scrollTop === 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (!atTop && !atBottom) e.stopPropagation();
  }, []);

  const [qualSearchTerm, setQualSearchTerm] = useState("");
  const [teamPopoverOpen, setTeamPopoverOpen] = useState(false);
  const [buPopoverOpen, setBuPopoverOpen] = useState(false);
  const [rolePopoverOpen, setRolePopoverOpen] = useState(false);
  const [laborTypePopoverOpen, setLaborTypePopoverOpen] = useState(false);
  const [contractTypePopoverOpen, setContractTypePopoverOpen] = useState(false);
  const [passwordLocked, setPasswordLocked] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [generateRandomPwd, setGenerateRandomPwd] = useState(false);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);
  const [copiedPwd, setCopiedPwd] = useState(false);
  const [forceTwoFactor, setForceTwoFactor] = useState(false);
  const [disable2FAState, setDisable2FAState] = useState<"idle" | "confirm" | "loading">("idle");
  const [resetEmailState, setResetEmailState] = useState<"idle" | "sending" | "sent">("idle");
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const userToggledNotifications = useRef(false);
  const userToggledSms = useRef(false);

  useEffect(() => {
    if (user && id) {
      const u = user as UserWithTeam & { hasPassword?: boolean };
      setForm({
        name: u.name ?? "",
        firstName: u.firstName ?? "",
        email: u.email ?? "",
        username: u.username ?? "",
        teamId: u.teamId ?? "",
        roleId: u.role?.id ?? "",
        color: u.color ?? "#FFFFFF",
        job: u.job ?? "",
        phone: u.phone ?? "",
        mobile: u.mobile ?? "",
        address: u.address ?? "",
        comment: u.comment ?? "",
        active: u.active ?? true,
        notifications: u.notifications ?? false,
        pushNotifications: u.pushNotifications ?? false,
        smsNotifications: (u as any).smsNotifications ?? false,
        visibleOnPlanning: u.visibleOnPlanning ?? true,
        defaultHourlyRate: u.defaultHourlyRate ?? "",
        password: "",
        qualificationIds: u.qualifications?.map((q) => q.id) ?? [],
        businessUnitId: (u as any).businessUnit?.id ?? "",
        laborTypeId: (u as any).laborType?.id ?? "",
        contractType: (u as any).contractType ?? "",
      });
      setPasswordLocked(!!u.hasPassword);
      setForcePasswordChange(false);
      setForceTwoFactor(u.forceTwoFactor ?? false);
      setDisable2FAState("idle");
    } else if (!id && duplicateFromId && sourceUser) {
      // Duplicate mode: pre-fill only the GENERIC fields from the source user.
      // Personal fields (name, firstName, email, username, phone, mobile, address,
      // comment, password) are left empty. The user must fill them in before saving.
      const s = sourceUser as UserWithTeam;
      userToggledNotifications.current = false;
      userToggledSms.current = false;
      setForm({
        name: "",
        firstName: "",
        email: "",
        username: "",
        teamId: s.teamId ?? "",
        roleId: s.role?.id ?? "",
        color: s.color ?? "#FFFFFF",
        job: s.job ?? "",
        phone: "",
        mobile: "",
        address: "",
        comment: "",
        active: true,
        notifications: s.notifications ?? false,
        pushNotifications: s.pushNotifications ?? false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        smsNotifications: (s as any).smsNotifications ?? false,
        visibleOnPlanning: s.visibleOnPlanning ?? true,
        defaultHourlyRate: s.defaultHourlyRate ?? "",
        password: "",
        qualificationIds: s.qualifications?.map((q) => q.id) ?? [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        businessUnitId: (s as any).businessUnit?.id ?? "",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        laborTypeId: (s as any).laborType?.id ?? "",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contractType: (s as any).contractType ?? "",
      });
      setPasswordLocked(false);
      setForcePasswordChange(false);
      setForceTwoFactor(s.forceTwoFactor ?? false);
      setDisable2FAState("idle");
    } else if (!id && !duplicateFromId && configData) {
      // Create mode: apply config defaults
      userToggledNotifications.current = false;
      userToggledSms.current = false;
      setForm((f) => ({
        ...f,
        notifications: false, // will be auto-enabled by the email effect if email is valid
        pushNotifications: configData.DEFAULT_PUSH_NOTIFICATIONS === "true",
        smsNotifications: false, // will be auto-enabled by the mobile effect if mobile is valid
      }));
    }
  }, [user, id, duplicateFromId, sourceUser, configData]);

  // Auto-disable email notifications if email becomes invalid
  // Auto-enable in create mode if email becomes valid and config default is true
  useEffect(() => {
    const validEmail = !!form.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
    if (!validEmail && form.notifications) {
      setForm((f) => ({ ...f, notifications: false }));
    } else if (validEmail && !id && !userToggledNotifications.current && configData?.DEFAULT_NOTIFICATIONS === "true" && !form.notifications) {
      setForm((f) => ({ ...f, notifications: true }));
    }
  }, [form.email, form.notifications, id, configData]);

  // Auto-disable SMS notifications if mobile becomes invalid
  // Auto-enable in create mode if mobile becomes valid and config default is true
  useEffect(() => {
    const validMobile = !!form.mobile && isValidPhoneNumber(form.mobile);
    if (!validMobile && form.smsNotifications) {
      setForm((f) => ({ ...f, smsNotifications: false }));
    } else if (validMobile && !id && !userToggledSms.current && configData?.DEFAULT_SMS_NOTIFICATIONS === "true" && !form.smsNotifications) {
      setForm((f) => ({ ...f, smsNotifications: true }));
    }
  }, [form.mobile, form.smsNotifications, id, configData]);

  const isEdit = !!id;

  const [activeTab, setActiveTab] = useState("general");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitFlash, setSubmitFlash] = useState(false);

  // Map field names to the tab they belong to
  const FIELD_TAB_MAP: Record<string, string> = {
    name: "general", firstName: "general", email: "general", username: "general",
    businessUnitId: "general", teamId: "general", roleId: "general",
    laborTypeId: "general", contractType: "general", color: "general",
    password: "security", currentPassword: "security",
  };

  function switchToTabWithError(errors: Record<string, string>) {
    // Switch to the first tab that contains an errored field
    for (const field of Object.keys(errors)) {
      const tab = FIELD_TAB_MAP[field];
      if (tab) {
        setActiveTab(tab);
        return;
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validate required fields — build field error map for all missing fields at once
    const requiredErrors: Record<string, string> = {};
    if (!form.name) requiredErrors.name = t("form.lastNameRequired");
    if (!form.username) requiredErrors.username = t("shared.validation.usernameRequired");
    if (!form.businessUnitId) requiredErrors.businessUnitId = t("shared.validation.businessUnitRequired");
    if (!form.roleId) requiredErrors.roleId = t("shared.validation.roleRequired");

    if (Object.keys(requiredErrors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...requiredErrors }));
      switchToTabWithError(requiredErrors);
      setSubmitFlash(true);
      setTimeout(() => setSubmitFlash(false), 3000);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      name: form.name,
      firstName: form.firstName || null,
      email: form.email || null,
      username: form.username,
      teamId: form.teamId || null,
      roleId: form.roleId,
      color: form.color,
      job: form.job || null,
      phone: form.phone || null,
      mobile: form.mobile || null,
      address: form.address || null,
      comment: form.comment || null,
      active: form.active,
      notifications: form.notifications,
      pushNotifications: form.pushNotifications,
      smsNotifications: false, // Feature disabled — force false on save
      visibleOnPlanning: form.visibleOnPlanning,
      defaultHourlyRate: form.defaultHourlyRate || null,
      qualificationIds: form.qualificationIds,
      businessUnitId: form.businessUnitId,
      laborTypeId: form.laborTypeId || null,
      contractType: form.contractType || null,
    };

    if (generateRandomPwd) {
      data.generateRandomPassword = true;
    } else if (!passwordLocked && form.password) {
      const strength = evaluatePassword(form.password, passwordPolicy);
      if (!strength.valid) return;
      data.password = form.password;
    }

    if (isEdit) {
      data.forcePasswordChange = forcePasswordChange;
      data.forceTwoFactor = forceTwoFactor;
    }

    const clearPwd = () => setForm((f) => ({ ...f, password: "" }));
    const mutateOpts = {
      onSuccess: onClose,
      onError: (err: Error & { status?: number; details?: unknown; fields?: Record<string, string> }) => {
        clearPwd();
        // Zod issues returned by the API on a 422 come first (invalid field
        // format) — otherwise per-field errors (`fields`, language-
        // independent), then fall back to the message parser.
        const fromZod = err.status === 422 ? zodIssuesToFieldErrors(err.details, zodMessage) : {};
        const fromMsg = parseFieldErrors(err);
        const parsed = { ...fromMsg, ...fromZod };
        setFieldErrors(parsed);
        switchToTabWithError(parsed);
        setSubmitFlash(true);
        setTimeout(() => setSubmitFlash(false), 3000);
        // If the error was mapped to specific fields, reset the mutation error
        // so the global error block doesn't reappear when the user starts typing
        if (Object.keys(parsed).length > 0) {
          createUser.reset();
          updateUser.reset();
        }
      },
    };
    if (isEdit) {
      updateUser.mutate({ id, data }, mutateOpts);
    } else {
      createUser.mutate(data, mutateOpts);
    }
  }

  if (id && isLoading) {
    return <p className="py-4 text-center text-muted-foreground">{tc("states.loading")}</p>;
  }

  const isPending = createUser.isPending || updateUser.isPending;
  const passwordInvalid = !generateRandomPwd && !passwordLocked && form.password.length > 0 && !evaluatePassword(form.password, passwordPolicy).valid;

  const filteredQualifications = qualifications?.filter((q) =>
    q.name.toLowerCase().includes(qualSearchTerm.toLowerCase())
  );

  const selectedQualifications = qualifications?.filter((q) =>
    form.qualificationIds.includes(q.id)
  );

  function toggleQualification(qualId: string) {
    setForm((prev) => ({
      ...prev,
      qualificationIds: prev.qualificationIds.includes(qualId)
        ? prev.qualificationIds.filter((id) => id !== qualId)
        : [...prev.qualificationIds, qualId],
    }));
  }

  const emailNotifEnabled = configData?.NOTIFICATION_EMAIL_COCHE === "true";
  const isValidEmail = !!form.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const hasEmail = isValidEmail;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="general">{t("form.tabs.general")}</TabsTrigger>
          <TabsTrigger value="security">{t("form.tabs.security")}</TabsTrigger>
          <TabsTrigger value="details">{t("form.tabs.details")}</TabsTrigger>
        </TabsList>

        {/* ═══ General tab ═══ */}
        <TabsContent value="general" className="space-y-6 mt-4 min-h-[600px]">
          {/* ── Identity ── */}
          <div className="space-y-3">
            <SectionTitle>{t("form.sections.identity")}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={cn("space-y-1.5", fieldErrors.name && "field-error")}>
            <Label htmlFor="name">{t("form.fields.lastNameRequired")}</Label>
            <Input
              id="name"
              name="name"
              autoComplete="off"
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                clearFieldError(setFieldErrors, "name");
              }}
              className={cn(fieldErrors.name && "border-destructive ring-1 ring-destructive")}
            />
            {fieldErrors.name && <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="firstName">{t("form.fields.firstName")}</Label>
            <Input
              id="firstName"
              name="firstName"
              autoComplete="off"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </div>
          <div className={cn("space-y-1.5", fieldErrors.email && "field-error")}>
            <Label htmlFor="email">{t("form.fields.email")}</Label>
            <Input
              id="email"
              name="email"
              autoComplete="off"
              type="email"
              value={form.email}
              onChange={(e) => {
                const email = e.target.value;
                setForm({ ...form, email });
                clearFieldError(setFieldErrors, "email");
                if (!email && generateRandomPwd) setGenerateRandomPwd(false);
              }}
              className={cn(fieldErrors.email && "border-destructive ring-1 ring-destructive")}
            />
            {fieldErrors.email && <p className="text-xs text-destructive mt-1">{fieldErrors.email}</p>}
            <EmailBlockedWarning email={form.email} />
          </div>
          <div className={cn("space-y-1.5", fieldErrors.username && "field-error")}>
            <Label htmlFor="username">{t("form.fields.username")}</Label>
            <Input
              id="username"
              name="username"
              autoComplete="off"
              value={form.username}
              onChange={(e) => {
                setForm({ ...form, username: e.target.value });
                clearFieldError(setFieldErrors, "username");
              }}
              aria-invalid={!!fieldErrors.username ? "true" : undefined}
              className={cn(fieldErrors.username && "border-destructive ring-1 ring-destructive")}
            />
            {fieldErrors.username && <p className="text-xs text-destructive mt-1">{fieldErrors.username}</p>}
          </div>
        </div>
      </div>

      {/* ── Organization ── */}
      <div className="space-y-3">
        <SectionTitle>{t("form.sections.organisation")}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="user-team-trigger">{t("form.fields.team")}</Label>
            <Popover open={teamPopoverOpen} onOpenChange={setTeamPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="user-team-trigger"
                  type="button"
                  variant="outline"
                  role="combobox"
                  className={cn("w-full justify-between min-w-0 font-normal", !form.teamId && "text-muted-foreground")}
                >
                  <span className="flex items-center min-w-0">
                    {form.teamId ? (
                      <>
                        <span className="mr-2 inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: teams?.find((t) => t.id === form.teamId)?.color || "#ccc" }} />
                        <span className="truncate">{teams?.find((t) => t.id === form.teamId)?.name ?? "—"}</span>
                      </>
                    ) : <span className="truncate">{t("form.pickers.noTeam")}</span>}
                  </span>
                  <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
                <Command defaultValue={form.teamId || undefined}>
                  <CommandInput placeholder={tc("actions.searchPlaceholder")} />
                  <CommandList onWheel={handleWheel}>
                    <CommandEmpty>{t("form.pickers.noTeam")}</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="__none__" onSelect={() => { setForm({ ...form, teamId: "" }); setTeamPopoverOpen(false); }}>
                        <span className="text-muted-foreground">{t("form.pickers.noTeam")}</span>
                        {!form.teamId && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                      {(teams ?? [])
                        .filter((t) => {
                          if (selectedBuIds.length === 0) return true;
                          const buId = (t as { businessUnitId?: string | null }).businessUnitId ?? null;
                          return buId ? selectedBuIds.includes(buId) : false;
                        })
                        .map((t) => (
                          <CommandItem
                            key={t.id}
                            value={t.id}
                            keywords={[t.name]}
                            onSelect={() => {
                              if (!isEdit && t.id) {
                                setForm({ ...form, teamId: t.id, color: t.color ?? form.color });
                              } else {
                                setForm({ ...form, teamId: t.id });
                              }
                              setTeamPopoverOpen(false);
                            }}
                          >
                            <span className="mr-2 inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.color || "#ccc" }} />
                            {t.name}
                            {form.teamId === t.id && <Check className="ml-auto h-4 w-4" />}
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className={cn("space-y-1.5", fieldErrors.businessUnitId && "field-error")}>
            <Label htmlFor="user-bu-trigger">{t("shared.fields.businessUnitRequired")}</Label>
            <Popover open={buPopoverOpen} onOpenChange={setBuPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="user-bu-trigger"
                  type="button"
                  variant="outline"
                  role="combobox"
                  className={cn(
                    "w-full justify-between min-w-0 font-normal",
                    !form.businessUnitId && "text-muted-foreground",
                    fieldErrors.businessUnitId && "border-destructive ring-1 ring-destructive"
                  )}
                >
                  <span className="flex items-center min-w-0">
                    {form.businessUnitId ? (
                      <>
                        <Building2 className="mr-2 h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{businessUnitsList?.find((bu) => bu.id === form.businessUnitId)?.name ?? "—"}</span>
                      </>
                    ) : <span className="truncate">{t("shared.selectBu")}</span>}
                  </span>
                  <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
                <Command defaultValue={form.businessUnitId || undefined}>
                  <CommandInput placeholder={tc("actions.searchPlaceholder")} />
                  <CommandList onWheel={handleWheel}>
                    <CommandEmpty>{t("shared.noBu")}</CommandEmpty>
                    <CommandGroup>
                      {businessUnitsList?.map((bu) => (
                        <CommandItem
                          key={bu.id}
                          value={bu.id}
                          keywords={[bu.name, bu.number]}
                          onSelect={() => { setForm({ ...form, businessUnitId: bu.id }); setBuPopoverOpen(false); clearFieldError(setFieldErrors, "businessUnitId"); }}
                        >
                          <Building2 className="mr-2 h-3.5 w-3.5 shrink-0" />
                          {bu.name}
                          {form.businessUnitId === bu.id && <Check className="ml-auto h-4 w-4" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {fieldErrors.businessUnitId && <p className="text-xs text-destructive mt-1">{fieldErrors.businessUnitId}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-labor-trigger">{t("form.fields.laborType")}</Label>
            <Popover open={laborTypePopoverOpen} onOpenChange={setLaborTypePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="user-labor-trigger"
                  type="button"
                  variant="outline"
                  role="combobox"
                  className={cn("w-full justify-between min-w-0 font-normal", !form.laborTypeId && "text-muted-foreground")}
                >
                  <span className="flex items-center min-w-0">
                    {form.laborTypeId ? (
                      <>
                        <HardHat className="mr-2 h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{laborTypesList?.find((lt) => lt.id === form.laborTypeId)?.name ?? "—"}</span>
                      </>
                    ) : <span className="truncate">{t("form.pickers.noType")}</span>}
                  </span>
                  <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
                <Command defaultValue={form.laborTypeId || undefined}>
                  <CommandInput placeholder={tc("actions.searchPlaceholder")} />
                  <CommandList onWheel={handleWheel}>
                    <CommandEmpty>{t("form.pickers.noType")}</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="__none__" onSelect={() => { setForm({ ...form, laborTypeId: "" }); setLaborTypePopoverOpen(false); }}>
                        <span className="text-muted-foreground">{t("form.pickers.noType")}</span>
                        {!form.laborTypeId && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                      {laborTypesList?.map((lt) => (
                        <CommandItem
                          key={lt.id}
                          value={lt.id}
                          keywords={[lt.name, lt.initials]}
                          onSelect={() => { setForm({ ...form, laborTypeId: lt.id }); setLaborTypePopoverOpen(false); }}
                        >
                          <HardHat className="mr-2 h-3.5 w-3.5 shrink-0" />
                          {lt.name}
                          <span className="ml-1 text-muted-foreground uppercase">({lt.initials})</span>
                          {form.laborTypeId === lt.id && <Check className="ml-auto h-4 w-4" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className={cn("space-y-1.5", fieldErrors.roleId && "field-error")}>
            <Label htmlFor="user-role-trigger">{t("form.fields.role")}</Label>
            <Popover open={rolePopoverOpen} onOpenChange={setRolePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="user-role-trigger"
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-invalid={fieldErrors.roleId ? "true" : undefined}
                  className={cn(
                    "w-full justify-between min-w-0 font-normal",
                    !form.roleId && "text-muted-foreground",
                    fieldErrors.roleId && "border-destructive ring-1 ring-destructive"
                  )}
                >
                  <span className="flex items-center min-w-0">
                    {form.roleId ? (
                      <>
                        <Shield className="mr-2 h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{roleName(roles?.find((r) => r.id === form.roleId)) || "—"}</span>
                      </>
                    ) : <span className="truncate">{t("form.pickers.selectRole")}</span>}
                  </span>
                  <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
                <Command defaultValue={form.roleId || undefined}>
                  <CommandInput placeholder={tc("actions.searchPlaceholder")} />
                  <CommandList onWheel={handleWheel}>
                    <CommandEmpty>{t("form.pickers.noRole")}</CommandEmpty>
                    <CommandGroup>
                      {roles?.map((r) => (
                        <CommandItem
                          key={r.id}
                          value={r.id}
                          keywords={[roleName(r)]}
                          onSelect={() => { setForm({ ...form, roleId: r.id }); setRolePopoverOpen(false); clearFieldError(setFieldErrors, "roleId"); }}
                        >
                          <Shield className="mr-2 h-3.5 w-3.5 shrink-0" />
                          {roleName(r)}{r.isAdmin ? ` ${t("form.pickers.adminSuffix")}` : ""}
                          {form.roleId === r.id && <Check className="ml-auto h-4 w-4" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {form.roleId && (() => {
              const selectedRole = roles?.find((r) => r.id === form.roleId);
              return selectedRole?.isAdmin ? (
                <Badge variant="destructive" className="text-[10px] px-1 py-0 w-fit">{t("form.pickers.fullAccess")}</Badge>
              ) : null;
            })()}
            {fieldErrors.roleId && <p className="text-xs text-destructive mt-1">{fieldErrors.roleId}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="job">{t("form.fields.job")}</Label>
            <Input
              id="job"
              autoComplete="off"
              value={form.job}
              onChange={(e) => setForm({ ...form, job: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-contract-trigger">{t("form.fields.contract")}</Label>
            <Popover open={contractTypePopoverOpen} onOpenChange={setContractTypePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="user-contract-trigger"
                  type="button"
                  variant="outline"
                  role="combobox"
                  className={cn("w-full justify-between min-w-0 font-normal", !form.contractType && "text-muted-foreground")}
                >
                  <span className="flex items-center min-w-0">
                    {form.contractType ? (
                      <>
                        <FileSignature className="mr-2 h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{getContractLabel(form.contractType, contractLabel) ?? "—"}</span>
                      </>
                    ) : <span className="truncate">{t("form.pickers.noContract")}</span>}
                  </span>
                  <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start" onWheel={handleWheel}>
                <Command defaultValue={form.contractType || undefined}>
                  <CommandList onWheel={handleWheel}>
                    <CommandEmpty>{t("form.pickers.noType")}</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="__none__" onSelect={() => { setForm({ ...form, contractType: "" }); setContractTypePopoverOpen(false); }}>
                        <span className="text-muted-foreground">{t("form.pickers.noContract")}</span>
                        {!form.contractType && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                      {CONTRACT_TYPES.map((c) => (
                        <CommandItem
                          key={c.value}
                          value={c.value}
                          keywords={[contractLabel(c.key)]}
                          onSelect={() => { setForm({ ...form, contractType: c.value }); setContractTypePopoverOpen(false); }}
                        >
                          <FileSignature className="mr-2 h-3.5 w-3.5 shrink-0" />
                          {contractLabel(c.key)}
                          {form.contractType === c.value && <Check className="ml-auto h-4 w-4" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          {(isEdit || form.teamId) && (
            <div className="space-y-1.5">
              <Label htmlFor="user-color">{t("shared.fields.color")}</Label>
              <ColorPicker
                id="user-color"
                value={form.color}
                onChange={(color) => setForm({ ...form, color })}
              />
              {form.teamId && (() => {
                const team = teams?.find((t) => t.id === form.teamId);
                return team?.color && team.color !== form.color ? (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setForm({ ...form, color: team.color! })}
                  >
                    <div className="h-3 w-3 rounded-full border border-input" style={{ backgroundColor: team.color ?? undefined }} />
                    {t("form.pickers.applyTeamColor")}
                  </button>
                ) : null;
              })()}
            </div>
          )}
        </div>
      </div>

        </TabsContent>

        {/* ═══ Security tab ═══ */}
        <TabsContent value="security" className="space-y-6 mt-4 min-h-[600px]">
          {/* ── Security ── */}
          <div className="space-y-3">
            <SectionTitle>{t("form.sections.password")}</SectionTitle>

        {/* Password */}
        <div className={cn("space-y-2", fieldErrors.password && "field-error")}>
          <Label htmlFor="password">{t("form.fields.password")}</Label>
          {generateRandomPwd ? (
            <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
              <Lock className="mr-2 h-3.5 w-3.5" />
              <span>{t("form.password.random")}</span>
            </div>
          ) : passwordLocked ? (
            <div className="flex items-center gap-2">
              <div className="flex h-9 flex-1 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                <Lock className="mr-2 h-3.5 w-3.5" />
                <span className="tracking-widest">••••••••</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { setPasswordLocked(false); setForm({ ...form, password: "" }); }}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {tc("actions.edit")}
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Input
                    id="password"
                    name="new-password"
                    // autoComplete="off": an admin creating/editing someone
                    // else's account must not see their password manager offer
                    // to save these credentials in their own vault.
                    autoComplete="off"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => {
                      setForm({ ...form, password: e.target.value });
                      clearFieldError(setFieldErrors, "password");
                    }}
                    placeholder={isEdit ? t("form.password.newPlaceholder") : t("form.password.optionalPlaceholder")}
                    className={cn("pr-10", fieldErrors.password && "border-destructive ring-1 ring-destructive")}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  title={t("form.password.generate")}
                  onClick={() => {
                    const pwd = generatePasswordFromConfig(configData ?? {});
                    setForm({ ...form, password: pwd });
                    setShowPassword(true);
                    navigator.clipboard.writeText(pwd).then(() => {
                      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
                      setCopiedPwd(true);
                      copiedTimerRef.current = setTimeout(() => setCopiedPwd(false), 3000);
                    }).catch(() => {});
                  }}
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
              {copiedPwd && (
                <p className="text-xs text-emerald-600">{t("form.password.copied")}</p>
              )}
              {isEdit && (user as any)?.hasPassword && (
                <button
                  type="button"
                  onClick={() => { setPasswordLocked(true); setForm({ ...form, password: "" }); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("form.password.cancelEdit")}
                </button>
              )}
              {form.password && (
                <PasswordStrengthBar password={form.password} policy={passwordPolicy} />
              )}
            </div>
          )}
          {fieldErrors.password && <p className="text-xs text-destructive mt-1">{fieldErrors.password}</p>}
        </div>

        {/* Password options */}
        <div className="space-y-2.5 rounded-md border border-input/50 bg-muted/30 px-3 py-2.5">
          {/* Random password by email */}
          {(() => {
            const disabled = !hasEmail || !emailNotifEnabled;
            const tooltip = !hasEmail
              ? t("form.password.needsEmail")
              : !emailNotifEnabled
                ? t("form.password.needsEmailNotifications")
                : undefined;
            return (
              <div className="flex items-center gap-2">
                <Switch
                  id="generateRandomPwd"
                  checked={generateRandomPwd}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    setGenerateRandomPwd(!!checked);
                    if (checked) setForm({ ...form, password: "" });
                  }}
                />
                <Label
                  htmlFor="generateRandomPwd"
                  className={cn("text-sm font-normal cursor-pointer", disabled && "text-muted-foreground cursor-not-allowed")}
                  title={tooltip}
                >
                  {t("form.password.assignRandom")}
                  {disabled && tooltip && (
                    <span className="block text-xs text-muted-foreground">{tooltip}</span>
                  )}
                </Label>
              </div>
            );
          })()}

          {/* Force password change */}
          {isEdit && (user as any)?.hasPassword && !generateRandomPwd && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Switch
                  id="forcePasswordChange"
                  checked={forcePasswordChange}
                  onCheckedChange={(checked) => setForcePasswordChange(!!checked)}
                />
                <Label htmlFor="forcePasswordChange" className="text-sm font-normal cursor-pointer">
                  {t("form.password.forceChange")}
                </Label>
              </div>
              {!forcePasswordChange && (user as any)?.forcePasswordChange && (
                <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 dark:border-amber-800 dark:bg-amber-950/50">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs text-amber-700 dark:text-amber-300">
                    {t("form.password.changePending")}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Reset link by email */}
          {isEdit && (() => {
            const disabled = !hasEmail || !emailNotifEnabled || resetEmailState !== "idle";
            return (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                className="h-7 text-xs"
                onClick={async () => {
                  setResetEmailState("sending");
                  try {
                    const res = await fetch("/api/auth/send-reset", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ userId: id }),
                    });
                    setResetEmailState(res.ok ? "sent" : "idle");
                  } catch {
                    setResetEmailState("idle");
                  }
                }}
              >
                {resetEmailState === "sending" ? (
                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{tc("states.sending")}</>
                ) : resetEmailState === "sent" ? (
                  <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />{t("form.password.resetSent")}</>
                ) : (
                  <><Mail className="mr-1.5 h-3.5 w-3.5" />{t("form.password.sendReset")}</>
                )}
              </Button>
            );
          })()}
        </div>

        {/* 2FA */}
        {isEdit && (
          <div className="space-y-2.5 rounded-md border border-input/50 bg-muted/30 px-3 py-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t("form.twoFactor.title")}</span>
              {(user as any)?.twoFactorEnabled ? (
                <Badge variant="outline" className="border-emerald-600 text-emerald-600 text-[10px]">
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  {tc("states.enabled")}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground text-[10px]">
                  <ShieldOff className="mr-1 h-3 w-3" />
                  {t("form.twoFactor.notEnabled")}
                </Badge>
              )}
              {(user as any)?.twoFactorEnabled && disable2FAState === "idle" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-destructive hover:text-destructive"
                  onClick={() => setDisable2FAState("confirm")}
                >
                  <ShieldOff className="mr-1 h-3 w-3" />
                  {tc("actions.disable")}
                </Button>
              )}
            </div>
            {disable2FAState === "confirm" && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 space-y-2">
                <p className="text-xs text-destructive font-medium">
                  {t("form.twoFactor.confirmDisable")}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={disable2FAState !== "confirm"}
                    onClick={async () => {
                      setDisable2FAState("loading");
                      try {
                        const res = await fetch(`/api/users/${id}/2fa`, { method: "DELETE" });
                        if (res.ok) {
                          setDisable2FAState("idle");
                          queryClient.invalidateQueries({ queryKey: ["users", id] });
                        } else {
                          setDisable2FAState("idle");
                        }
                      } catch {
                        setDisable2FAState("idle");
                      }
                    }}
                  >
                    {tc("actions.confirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDisable2FAState("idle")}
                  >
                    {tc("actions.cancel")}
                  </Button>
                </div>
              </div>
            )}
            {disable2FAState === "loading" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("form.twoFactor.disabling")}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id="forceTwoFactor"
                checked={forceTwoFactor}
                onCheckedChange={(checked) => setForceTwoFactor(!!checked)}
              />
              <Label htmlFor="forceTwoFactor" className="text-sm font-normal cursor-pointer">
                {t("form.twoFactor.force")}
              </Label>
            </div>
          </div>
        )}
      </div>

        </TabsContent>

        {/* ═══ Details tab ═══ */}
        <TabsContent value="details" className="space-y-6 mt-4 min-h-[600px]">
          {/* ── Qualifications ── */}
          {qualifications && qualifications.length > 0 && (
        <div className="space-y-3">
          <SectionTitle>{t("form.sections.qualifications")}</SectionTitle>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between font-normal"
              >
                {form.qualificationIds.length > 0
                  ? t("form.qualifications.count", { count: form.qualificationIds.length })
                  : t("form.qualifications.select")}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start" onWheel={handleWheel}>
              <Input
                autoComplete="off"
                placeholder={tc("actions.searchPlaceholder")}
                value={qualSearchTerm}
                onChange={(e) => setQualSearchTerm(e.target.value)}
                className="mb-2"
              />
              <div className="max-h-48 overflow-y-auto overscroll-contain space-y-0.5" onWheel={handleWheel}>
                {filteredQualifications?.map((q) => {
                  const selected = form.qualificationIds.includes(q.id);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => toggleQualification(q.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                        selected && "bg-accent"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded border",
                          selected ? "bg-primary border-primary text-primary-foreground" : "border-input"
                        )}
                      >
                        {selected && <Check className="h-3 w-3" />}
                      </div>
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: q.color, color: contrastColor(q.color) }}
                      >
                        <QualificationIcon name={q.emoji} className="size-3" />
                        {q.name}
                      </span>
                    </button>
                  );
                })}
                {filteredQualifications?.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-2">{tc("states.noResults")}</p>
                )}
              </div>
            </PopoverContent>
          </Popover>
          {selectedQualifications && selectedQualifications.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedQualifications.map((q) => (
                <span
                  key={q.id}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: q.color, color: contrastColor(q.color) }}
                >
                  <QualificationIcon name={q.emoji} className="size-3" />
                  {q.name}
                  <button
                    type="button"
                    onClick={() => toggleQualification(q.id)}
                    className="ml-0.5 hover:opacity-75"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Personal information ── */}
      <div className="space-y-3">
        <SectionTitle>{t("form.sections.personal")}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="phone">{t("form.fields.phone")}</Label>
            <PhoneInputCustom
              id="phone"
              defaultCountry={(configData?.SENT_DEFAULT_COUNTRY || "FR") as any}
              value={form.phone || undefined}
              onChange={(value) => setForm({ ...form, phone: value || "" })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mobile">{t("form.fields.mobile")}</Label>
            <PhoneInputCustom
              id="mobile"
              defaultCountry={(configData?.SENT_DEFAULT_COUNTRY || "FR") as any}
              value={form.mobile || undefined}
              onChange={(value) => setForm({ ...form, mobile: value || "" })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="address">{t("form.fields.address")}</Label>
            <Input
              id="address"
              name="address"
              autoComplete="off"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="comment">{t("form.fields.comment")}</Label>
            <Textarea
              id="comment"
              autoComplete="off"
              rows={3}
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              placeholder={t("form.fields.commentPlaceholder")}
            />
          </div>
        </div>
      </div>

      {/* ── Options ── */}
      <div className="space-y-3">
        <SectionTitle>{t("form.sections.options")}</SectionTitle>
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="active">{t("form.fields.active")}</Label>
            <Switch
              id="active"
              checked={form.active}
              onCheckedChange={(checked) => setForm({ ...form, active: !!checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="visibleOnPlanning">{t("form.fields.visibleOnPlanning")}</Label>
            <Switch
              id="visibleOnPlanning"
              checked={form.visibleOnPlanning}
              onCheckedChange={(checked) => setForm({ ...form, visibleOnPlanning: !!checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label
              htmlFor="notifications"
              className={!isValidEmail ? "text-muted-foreground cursor-not-allowed" : ""}
            >
              {t("form.fields.emailNotifications")}
            </Label>
            {!isValidEmail ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Switch id="notifications" checked={false} disabled />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("form.emailRequiredForNotifications")}</TooltipContent>
              </Tooltip>
            ) : (
              <Switch
                id="notifications"
                checked={form.notifications}
                onCheckedChange={(checked) => {
                  userToggledNotifications.current = true;
                  setForm({ ...form, notifications: !!checked });
                }}
              />
            )}
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pushNotifications">{t("form.fields.pushNotifications")}</Label>
            <Switch
              id="pushNotifications"
              checked={form.pushNotifications}
              onCheckedChange={(checked) => setForm({ ...form, pushNotifications: !!checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="smsNotifications" className="text-muted-foreground/60 cursor-not-allowed">
              {t("form.fields.smsNotifications")}
            </Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Switch id="smsNotifications" checked={false} disabled />
                </span>
              </TooltipTrigger>
              <TooltipContent>{tc("states.comingSoon")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

        </TabsContent>
      </Tabs>

      {/* Global error — shown ONLY for errors not linked to a specific field */}
      {(createUser.error || updateUser.error) && Object.keys(fieldErrors).length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <X className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{(createUser.error || updateUser.error)?.message}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isEdit && onDelete && (
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {tc("actions.delete")}
          </Button>
        )}
        <div className="flex-1" />
        <Button type="button" variant="outline" onClick={onClose}>
          {tc("actions.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={isPending || passwordInvalid}
          className={cn(submitFlash && "bg-destructive hover:bg-destructive text-destructive-foreground submit-error-flash")}
        >
          {isPending ? tc("actions.saving") : isEdit ? tc("actions.edit") : tc("actions.create")}
        </Button>
      </div>
    </form>
  );
}

function EmailBlockedWarning({ email }: { email: string }) {
  const t = useTranslations("users");
  const { data } = useIsEmailBlocked(email);
  if (!data?.blocked || !data?.active) return null;
  return (
    <p className="text-xs text-orange-700 dark:text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded px-2 py-1.5 mt-1">
      {t("form.emailBlocked")}
    </p>
  );
}
