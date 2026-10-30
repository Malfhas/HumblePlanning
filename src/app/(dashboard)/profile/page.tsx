"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileTab } from "@/components/profile/profile-tab";
import { SecurityTab } from "@/components/profile/security-tab";
import { PreferencesTab } from "@/components/profile/preferences-tab";
import { McpKeysTab } from "@/components/profile/mcp-keys-tab";
import { useConfig } from "@/hooks/use-config";
import { usePermissions } from "@/hooks/use-permissions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DEMO_USER_ID } from "@/lib/demo";
import { User, Shield, Settings, Bot, Lock } from "lucide-react";

export default function ProfilePage() {
  const t = useTranslations("profile");
  const { data: config } = useConfig();
  const { can, userId } = usePermissions();
  const showMcp = config?.MCP_ENABLED === "true" && can("mcp:use");
  // Demo account: shared by every visitor, only the preferences can change
  const locked = userId === DEMO_USER_ID;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("page.title")}</h1>
      {locked && (
        <Alert>
          <Lock />
          <AlertDescription>{t("page.demoLocked")}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile" className="gap-1.5">
            <User className="size-4" />
            {t("page.tabs.profile")}
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5">
            <Shield className="size-4" />
            {t("page.tabs.security")}
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-1.5">
            <Settings className="size-4" />
            {t("page.tabs.preferences")}
          </TabsTrigger>
          {showMcp && (
            <TabsTrigger value="mcp" className="gap-1.5">
              <Bot className="size-4" />
              {t("page.tabs.ai")}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <fieldset disabled={locked} className="min-w-0">
            <ProfileTab />
          </fieldset>
        </TabsContent>
        <TabsContent value="security" className="mt-4">
          <fieldset disabled={locked} className="min-w-0">
            <SecurityTab />
          </fieldset>
        </TabsContent>
        <TabsContent value="preferences" className="mt-4">
          <PreferencesTab />
        </TabsContent>
        {showMcp && (
          <TabsContent value="mcp" className="mt-4">
            <McpKeysTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
