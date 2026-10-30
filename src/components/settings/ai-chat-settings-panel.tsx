"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { AlertTriangle, CircleCheck, Loader2, RotateCcw, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { modelLabel } from "@/components/ai-chat/models";
import { apiFetch } from "@/lib/api-client";
import { tDyn } from "@/i18n/dynamic";

// i18n-dynamic: aiChat.settings.reasons.*
// i18n-dynamic: aiChat.settings.generation.reasoning.options.*

/**
 * Settings > AI > AI chat: the built-in assistant, backed by the MCP server
 * tools. Content and labels taken from the original project, in the style of
 * the Settings page. The OpenRouter key is never sent back by the server.
 */

type ReasoningLevel = "none" | "low" | "medium" | "high";
type InactiveReason = "disabled" | "missing_api_key" | "no_model";

interface ChatSettings {
  enabled: boolean;
  models: string[];
  defaultModel: string;
  systemPrompt: string;
  dataCollection: "deny" | "allow";
  zdr: boolean;
  nitro: boolean;
  maxTokens: number;
  temperature: number;
  reasoning: ReasoningLevel;
  maxDurationMinutes: number;
  maxConcurrentPerUser: number;
  widgetEnabled: boolean;
  widgetClosable: boolean;
  dictationEnabled: boolean;
}

interface AdminView {
  config: ChatSettings;
  apiKey: { configured: boolean; envManaged: boolean };
  defaultPrompt: string;
  status: { active: boolean; reasons: InactiveReason[] };
}

/** Reasons for being inactive (`aiChat.settings.reasons.<cause>`), in the order the administrator resolves them. */
const REASON_ORDER: InactiveReason[] = ["missing_api_key", "no_model", "disabled"];

/** Default reasoning levels (`aiChat.settings.generation.reasoning.options.<level>`). */
const REASONING_LEVELS: ReasoningLevel[] = ["none", "low", "medium", "high"];

const QUERY_KEY = ["ai-chat-admin-config"];

/** JSON call: the thrown error carries the message already translated by the server. */
const callApi = apiFetch;

function HelpText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}

function SwitchRow({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="text-sm font-normal leading-snug">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function AiChatSettingsPanel() {
  const t = useTranslations("aiChat.settings");
  const { data, isLoading, error } = useQuery({ queryKey: QUERY_KEY, queryFn: () => callApi<AdminView>("/api/ai-chat/admin/config") });
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{t("loadError")}</AlertTitle>
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
      </div>
    );
  }
  return <SettingsForm view={data} />;
}

function SettingsForm({ view }: { view: AdminView }) {
  const t = useTranslations("aiChat.settings");
  const tActions = useTranslations("common.actions");
  const tStates = useTranslations("common.states");
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<ChatSettings>(view.config);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [newModel, setNewModel] = useState("");
  const [catalog, setCatalog] = useState<{ id: string; name: string }[]>([]);
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const set = <K extends keyof ChatSettings>(field: K, value: ChatSettings[K]) => setConfig((prev) => ({ ...prev, [field]: value }));

  const applyResult = (result: AdminView, body: Record<string, unknown>) => {
    queryClient.setQueryData(QUERY_KEY, result);
    // The administrator's orb and menu entry follow right away
    void queryClient.invalidateQueries({ queryKey: ["ai-chat-availability"] });
    void queryClient.invalidateQueries({ queryKey: ["ai-chat-access"] });
    // The server turns the chat on once its configuration is complete: the switch follows
    if (result.config.enabled !== body.enabled) set("enabled", result.config.enabled);
  };

  const saveConfig = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      callApi<AdminView>("/api/ai-chat/admin/config", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: (result, body) => {
      applyResult(result, body);
      setApiKeyDraft("");
      setMessage({ tone: "ok", text: t("saved") });
    },
    onError: (err) => setMessage({ tone: "error", text: (err as Error).message }),
  });

  const save = (extra: Record<string, unknown> = {}) => {
    setMessage(null);
    saveConfig.mutate({ ...config, ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}), ...extra });
  };

  /**
   * Models are saved as soon as they change: picking one is enough to
   * make the chat available. Only the models are sent, on top of the
   * already saved settings; the other inputs wait for "Save".
   */
  const saveModels = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      callApi<AdminView>("/api/ai-chat/admin/config", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: applyResult,
    onError: (err) => setMessage({ tone: "error", text: (err as Error).message }),
  });

  const changeModels = (models: string[], defaultModel: string) => {
    setConfig((prev) => ({ ...prev, models, defaultModel }));
    setMessage(null);
    saveModels.mutate({ ...view.config, models, defaultModel });
  };

  /** The list comes from OpenRouter, relayed by the server: the administrators choose what they enable. */
  const loadModels = async () => {
    setMessage(null);
    try {
      const { models } = await callApi<{ models: { id: string; name: string }[] }>("/api/ai-chat/admin/models");
      setCatalog(models);
      setModelLabels(Object.fromEntries(models.map((m) => [m.id, m.name])));
      setMessage({ tone: "ok", text: t("models.loaded", { count: models.length }) });
    } catch {
      setMessage({ tone: "error", text: t("models.loadFailed") });
    }
  };

  const addModel = () => {
    const value = newModel.trim();
    if (!value) return;
    if (!config.models.includes(value)) {
      changeModels([...config.models, value], config.defaultModel || value);
    }
    setNewModel("");
  };

  const removeModel = (model: string) => {
    const remaining = config.models.filter((m) => m !== model);
    changeModels(remaining, config.defaultModel === model ? (remaining[0] ?? "") : config.defaultModel);
  };

  const isPromptCustomized = Boolean(config.systemPrompt?.trim());
  const reasons = REASON_ORDER.filter((r) => view.status.reasons.includes(r));
  const saveButton = (
    <Button size="sm" onClick={() => save()} disabled={saveConfig.isPending}>
      {saveConfig.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
      {tActions("save")}
    </Button>
  );

  return (
    <div className="space-y-4">
      {view.status.active ? (
        <Alert className="border-emerald-500/30 bg-emerald-500/10">
          <CircleCheck className="h-4 w-4 text-emerald-600" />
          <AlertTitle>{t("status.active")}</AlertTitle>
        </Alert>
      ) : (
        <Alert className="border-amber-500/30 bg-amber-500/10" data-ai-chat-status="inactive">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="line-clamp-none">
            {t("status.inactive", { reasons: reasons.map((r) => tDyn(t, `reasons.${r}`)).join(" · ") })}
          </AlertTitle>
          <AlertDescription>{t("status.inactiveHidden")}</AlertDescription>
        </Alert>
      )}

      {message ? (
        <p className={message.tone === "ok" ? "text-sm text-emerald-600" : "text-sm text-destructive"} role="status">
          {message.text}
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>{t("chat.title")}</CardTitle>
            <CardDescription>{t("chat.description")}</CardDescription>
          </div>
          {saveButton}
        </CardHeader>
        <CardContent className="space-y-4">
          <SwitchRow id="ai-enabled" label={t("chat.enable")} checked={config.enabled} onChange={(v) => set("enabled", v)} />
          <Note>{t("chat.note")}</Note>
          <div className="space-y-1.5">
            <Label htmlFor="ai-key">{t("chat.apiKey.label")}</Label>
            {view.apiKey.envManaged ? (
              <Input id="ai-key" value={t("chat.apiKey.envManaged")} readOnly disabled className="bg-muted" />
            ) : (
              <div className="flex gap-2">
                <Input
                  id="ai-key"
                  type="password"
                  autoComplete="off"
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  // i18n-ignore key format example (sk-or-…)
                  placeholder={view.apiKey.configured ? t("chat.apiKey.placeholderConfigured") : "sk-or-…"}
                />
                {view.apiKey.configured ? (
                  <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => save({ clearApiKey: true })}>
                    {tActions("remove")}
                  </Button>
                ) : null}
              </div>
            )}
            <HelpText>{t("chat.apiKey.help")}</HelpText>
          </div>
          <SwitchRow
            id="ai-dictation"
            label={t("chat.dictation")}
            checked={config.dictationEnabled}
            onChange={(v) => set("dictationEnabled", v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>{t("widget.title")}</CardTitle>
            <CardDescription>{t("widget.description")}</CardDescription>
          </div>
          {saveButton}
        </CardHeader>
        <CardContent className="space-y-4">
          <SwitchRow id="ai-widget" label={t("widget.enable")} checked={config.widgetEnabled} onChange={(v) => set("widgetEnabled", v)} />
          <SwitchRow
            id="ai-widget-closable"
            label={t("widget.closable")}
            checked={config.widgetClosable}
            onChange={(v) => set("widgetClosable", v)}
          />
          <Note>{t("widget.note")}</Note>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 max-md:flex-col">
          <div className="space-y-1.5">
            <CardTitle>{t("models.title")}</CardTitle>
            <CardDescription>{t("models.description")}</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {saveModels.isPending ? (
              <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {tStates("saving")}
              </span>
            ) : saveModels.isSuccess ? (
              <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-emerald-600" role="status">
                <CircleCheck className="h-3.5 w-3.5" /> {t("models.saved")}
              </span>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void loadModels()} title={t("models.load.tooltip")}>
              {t("models.load.label")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("models.default.label")}</Label>
            <Select value={config.defaultModel || undefined} onValueChange={(v) => changeModels(config.models, v)} disabled={!config.models.length}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={config.models.length ? t("models.default.placeholder") : t("models.default.placeholderEmpty")} />
              </SelectTrigger>
              <SelectContent>
                {config.models.map((model) => (
                  <SelectItem key={model} value={model}>
                    {modelLabel(model, modelLabels)} <span className="text-muted-foreground">({model})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("models.allowed", { count: config.models.length })}</Label>
            <div className="flex flex-wrap gap-1.5 rounded-md border p-2" data-ai-chat-models>
              {config.models.map((model) => (
                <Badge key={model} variant="outline" className="gap-1 pr-1 font-normal">
                  {model}
                  <button
                    type="button"
                    aria-label={t("models.remove.ariaLabel", { model })}
                    title={t("models.remove.tooltip")}
                    onClick={() => removeModel(model)}
                    className="rounded p-0.5 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {!config.models.length ? <span className="text-xs text-muted-foreground">{t("models.none")}</span> : null}
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ai-model">{t("models.add")}</Label>
              <Input
                id="ai-model"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addModel();
                  }
                }}
                placeholder="deepseek/deepseek-v4-flash"
                list="ai-chat-models"
              />
              <datalist id="ai-chat-models">
                {catalog.slice(0, 500).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </datalist>
            </div>
            <Button variant="outline" disabled={!newModel.trim()} onClick={addModel}>
              {tActions("add")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("privacy.title")}</CardTitle>
          <CardDescription>{t("privacy.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("privacy.dataCollection.label")}</Label>
            <Select value={config.dataCollection} onValueChange={(v) => set("dataCollection", v as ChatSettings["dataCollection"])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deny">{t("privacy.dataCollection.deny")}</SelectItem>
                <SelectItem value="allow">{t("privacy.dataCollection.allow")}</SelectItem>
              </SelectContent>
            </Select>
            <HelpText>{t("privacy.dataCollection.help")}</HelpText>
          </div>
          <div className="space-y-1.5 rounded-md border p-3">
            <SwitchRow id="ai-zdr" label={t("privacy.zdr.label")} checked={config.zdr} onChange={(v) => set("zdr", v)} />
            <HelpText>{t("privacy.zdr.help")}</HelpText>
          </div>
          <SwitchRow
            id="ai-nitro"
            label={t("privacy.nitro")}
            checked={config.nitro}
            onChange={(v) => set("nitro", v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("generation.title")}</CardTitle>
          <CardDescription>{t("generation.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("generation.reasoning.label")}</Label>
            <Select value={config.reasoning} onValueChange={(v) => set("reasoning", v as ReasoningLevel)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONING_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {tDyn(t, `generation.reasoning.options.${level}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HelpText>{t("generation.reasoning.help")}</HelpText>
          </div>
          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            <div className="space-y-1.5">
              <Label htmlFor="ai-tokens">{t("generation.maxTokens.label")}</Label>
              <Input id="ai-tokens" type="number" step={256} min={256} max={200000} value={String(config.maxTokens)} onChange={(e) => set("maxTokens", Number(e.target.value || 8192))} />
              <HelpText>{t("generation.maxTokens.help")}</HelpText>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-temp">{t("generation.temperature.label")}</Label>
              <Input id="ai-temp" type="number" step={0.1} min={0} max={2} value={String(config.temperature)} onChange={(e) => set("temperature", Number(e.target.value || 0))} />
              <HelpText>{t("generation.temperature.help")}</HelpText>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-duration">{t("generation.maxDuration.label")}</Label>
              <Input id="ai-duration" type="number" step={1} min={1} max={30} value={String(config.maxDurationMinutes)} onChange={(e) => set("maxDurationMinutes", Number(e.target.value || 5))} />
              <HelpText>{t("generation.maxDuration.help")}</HelpText>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-concurrent">{t("generation.concurrent.label")}</Label>
              <Input id="ai-concurrent" type="number" step={1} min={1} max={20} value={String(config.maxConcurrentPerUser)} onChange={(e) => set("maxConcurrentPerUser", Number(e.target.value || 3))} />
              <HelpText>{t("generation.concurrent.help")}</HelpText>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 max-md:flex-col">
          <div className="space-y-1.5">
            <CardTitle>{t("prompt.title")}</CardTitle>
            <CardDescription>{t("prompt.description")}</CardDescription>
          </div>
          {isPromptCustomized ? (
            <Button size="sm" variant="outline" onClick={() => set("systemPrompt", "")} title={t("prompt.resetTooltip")}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t("prompt.original")}
            </Button>
          ) : (
            <Badge variant="secondary">{t("prompt.original")}</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={config.systemPrompt || view.defaultPrompt}
            onChange={(e) => set("systemPrompt", e.target.value === view.defaultPrompt ? "" : e.target.value)}
            rows={18}
            className="font-mono text-xs"
          />
          {/* The {{appName}} placeholder stays in the code: literal braces outside ICU */}
          <HelpText>
            {"{{appName}}"} {t("prompt.help")}
          </HelpText>
          <div className="flex justify-end">{saveButton}</div>
        </CardContent>
      </Card>
    </div>
  );
}
