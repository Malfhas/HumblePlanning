"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useProfile, useUpdateProfile, useUploadAvatar, useDeleteAvatar } from "@/hooks/use-profile";
import { UserAvatar } from "@/components/shared/user-avatar";
import { ColorPicker } from "@/components/shared/color-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Upload, Trash2, Shield, Calendar, Mail } from "lucide-react";
import { useDateFormat } from "@/hooks/use-date-format";
import { useRoleDisplayName } from "@/hooks/use-roles";
import { contrastColor } from "@/lib/utils";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1">
      {children}
    </h3>
  );
}

export function ProfileTab() {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const { formatDateTime } = useDateFormat();
  const roleName = useRoleDisplayName();
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const deleteAvatar = useDeleteAvatar();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [successVisible, setSuccessVisible] = useState(false);
  const [successFading, setSuccessFading] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const showSuccess = useCallback(() => {
    setSuccessVisible(true);
    setSuccessFading(false);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => {
      setSuccessFading(true);
      setTimeout(() => setSuccessVisible(false), 300);
    }, 3000);
  }, []);

  const [form, setForm] = useState({
    name: "",
    firstName: "",
    phone: "",
    mobile: "",
    address: "",
    job: "",
    color: "#FFFFFF",
  });

  const [initialForm, setInitialForm] = useState(form);

  useEffect(() => {
    if (profile) {
      const loaded = {
        name: profile.name ?? "",
        firstName: profile.firstName ?? "",
        phone: profile.phone ?? "",
        mobile: profile.mobile ?? "",
        address: profile.address ?? "",
        job: profile.job ?? "",
        color: profile.color ?? "#FFFFFF",
      };
      setForm(loaded);
      setInitialForm(loaded);
    }
  }, [profile]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateProfile.mutate(
      {
        name: form.name,
        firstName: form.firstName || null,
        phone: form.phone || null,
        mobile: form.mobile || null,
        address: form.address || null,
        job: form.job || null,
        color: form.color,
      },
      { onSuccess: showSuccess }
    );
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadAvatar.mutate(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const lastLogin = profile?.lastLoginAt
    ? formatDateTime(profile.lastLoginAt)
    : tc("time.never");

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Read-only info */}
      <div className="space-y-3">
        <SectionTitle>{t("profileTab.sections.info")}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-0.5">
            <span className="text-muted-foreground">{t("profileTab.fields.login")}</span>
            <p className="font-medium">{profile?.username ?? "-"}</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-muted-foreground">{t("profileTab.fields.email")}</span>
            <p className="font-medium flex items-center gap-1">
              <Mail className="size-3.5" />
              {profile?.email ?? "-"}
            </p>
          </div>
          <div className="space-y-0.5">
            <span className="text-muted-foreground">{t("profileTab.fields.role")}</span>
            <div>
              {profile?.role ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: profile.role.color, color: contrastColor(profile.role.color) }}
                >
                  <Shield className="size-2.5" />
                  {roleName(profile.role)}
                </span>
              ) : (
                <span>-</span>
              )}
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-muted-foreground">{t("profileTab.fields.team")}</span>
            <p className="font-medium">{profile?.team?.name ?? "-"}</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-muted-foreground">{t("profileTab.fields.lastLogin")}</span>
            <p className="font-medium flex items-center gap-1">
              <Calendar className="size-3.5" />
              {lastLogin}
            </p>
          </div>
        </div>
      </div>

      {/* Avatar */}
      <div className="space-y-3">
        <SectionTitle>{t("profileTab.sections.avatar")}</SectionTitle>
        <div className="flex items-center gap-4">
          <div
            className="relative group cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <UserAvatar
              user={{ name: profile?.name ?? "", image: profile?.image, color: profile?.color }}
              className="size-24 text-2xl"
              fallbackClassName="text-2xl"
            />
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
              <Upload className="size-6 text-white" />
            </div>
          </div>
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadAvatar.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadAvatar.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1 h-4 w-4" />
              )}
              {uploadAvatar.isPending ? t("profileTab.avatar.uploading") : t("profileTab.avatar.change")}
            </Button>
            {profile?.image && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={deleteAvatar.isPending}
                onClick={() => deleteAvatar.mutate()}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {tc("actions.delete")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Editable form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-3">
          <SectionTitle>{t("profileTab.sections.edit")}</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">{t("profileTab.fields.name")}</Label>
              <Input
                id="profile-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-firstName">{t("profileTab.fields.firstName")}</Label>
              <Input
                id="profile-firstName"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-phone">{t("profileTab.fields.phone")}</Label>
              <Input
                id="profile-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-mobile">{t("profileTab.fields.mobile")}</Label>
              <Input
                id="profile-mobile"
                type="tel"
                value={form.mobile}
                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="profile-address">{t("profileTab.fields.address")}</Label>
              <Input
                id="profile-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-job">{t("profileTab.fields.job")}</Label>
              <Input
                id="profile-job"
                value={form.job}
                onChange={(e) => setForm({ ...form, job: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-color">{t("profileTab.fields.color")}</Label>
              <ColorPicker
                id="profile-color"
                value={form.color}
                onChange={(color) => setForm({ ...form, color })}
              />
            </div>
          </div>
        </div>

        {updateProfile.error && (
          <p className="text-sm text-destructive">{updateProfile.error.message}</p>
        )}
        {successVisible && (
          <p className={`text-sm text-emerald-600 transition-opacity duration-300 ${successFading ? "opacity-0" : "opacity-100"}`}>
            {t("profileTab.saved")}
          </p>
        )}

        <Button type="submit" disabled={!dirty || updateProfile.isPending}>
          {updateProfile.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1 h-4 w-4" />
          )}
          {updateProfile.isPending ? tc("actions.saving") : tc("actions.save")}
        </Button>
      </form>
    </div>
  );
}
