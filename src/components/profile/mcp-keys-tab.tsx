"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useConfig } from "@/hooks/use-config";
import { useDateFormat } from "@/hooks/use-date-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Bot, Plus, X, Loader2, Check, Copy, AlertTriangle } from "lucide-react";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1">
      {children}
    </h3>
  );
}

export function McpKeysTab() {
  const t = useTranslations("mcp");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { formatDate, formatDateTime } = useDateFormat();
  const { data: config } = useConfig();
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");

  const baseUrl = config?.APP_BASE_URL || "http://localhost:3000";
  const maxKeys = parseInt(config?.MCP_MAX_KEYS_PER_USER || "5", 10);
  // Only static keys count toward the limit (OAuth connections are separate)
  const limitReached = keys.filter((k) => k.type !== "oauth").length >= maxKeys;

  const loadKeys = async () => {
    try {
      const res = await fetch("/api/profile/mcp-keys");
      if (res.ok) setKeys(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { loadKeys(); }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/profile/mcp-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreatedKey(data.fullKey);
        setNewKeyName("");
        loadKeys();
      } else {
        setCreateError(data.error || t("errors.createFailed"));
      }
    } catch {
      setCreateError(tErrors("network"));
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/profile/mcp-keys/${id}`, { method: "DELETE" });
    setConfirmDeleteId(null);
    loadKeys();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Explanation */}
      <div className="space-y-3">
        <SectionTitle>{t("keys.connect.title")}</SectionTitle>
        <p className="text-sm text-muted-foreground">
          {t.rich("keys.connect.description", {
            url: `${baseUrl}/api/mcp`,
            code: (chunks) => <code className="bg-muted px-1 rounded">{chunks}</code>,
          })}
        </p>
      </div>

      {/* Created key alert */}
      {createdKey && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{t("keys.created.title")}</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{t("keys.created.description")}</p>
            </div>
          </div>

          <div>
            <Label className="text-xs text-amber-700 dark:text-amber-300">{t("keys.created.secretLabel")}</Label>
            <div className="flex gap-2 mt-1">
              <code className="flex-1 rounded-md border bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono select-all break-all">
                {createdKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                aria-label={t("keys.created.copyAriaLabel")}
                onClick={() => copyToClipboard(createdKey)}
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div>
            <Label className="text-xs text-amber-700 dark:text-amber-300">{t("keys.created.configLabel")}</Label>
            <pre className="mt-1 rounded-md border bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-mono select-all overflow-x-auto">
{JSON.stringify({
  mcpServers: {
    humbleplanning: {
      type: "http",
      url: `${baseUrl}/api/mcp`,
      headers: { Authorization: `Bearer ${createdKey}` }
    }
  }
}, null, 2)}
            </pre>
          </div>

          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setCreatedKey(null)}>
            {t("keys.created.dismiss")}
          </Button>
        </div>
      )}

      {/* Create new key */}
      <div className="space-y-3">
        <SectionTitle>{t("keys.create.title")}</SectionTitle>
        {limitReached ? (
          <p className="text-sm text-amber-600">{t("keys.create.limitReached", { max: maxKeys })}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder={t("keys.create.namePlaceholder")}
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <Button size="sm" onClick={handleCreate} disabled={creating || !newKeyName.trim()}>
                {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                {tCommon("actions.create")}
              </Button>
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
        )}
      </div>

      {/* Keys list */}
      <div className="space-y-3">
        <SectionTitle>{t("keys.list.title")}</SectionTitle>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("keys.list.empty")}</p>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Bot className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium break-words">{k.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {k.type === "oauth" ? t("keys.list.typeOauth") : t("keys.list.typeKey")}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {k.type === "oauth" ? t("keys.list.oauthAuthorized") : <code className="bg-muted px-1 rounded">{k.keyPrefix}</code>}
                      {" · "}{t("keys.list.createdOn", { date: formatDate(k.createdAt) })}
                      {" · "}{k.lastUsedAt ? t("lastUsed", { date: formatDateTime(k.lastUsedAt) }) : t("keys.list.neverUsed")}
                    </div>
                  </div>
                </div>
                {confirmDeleteId === k.id ? (
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(k.id)}>
                      {tCommon("actions.confirm")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setConfirmDeleteId(null)}>
                      {tCommon("actions.cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive hover:text-destructive"
                    onClick={() => setConfirmDeleteId(k.id)}
                  >
                    <X className="mr-1 h-4 w-4" />
                    {t("revoke")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
