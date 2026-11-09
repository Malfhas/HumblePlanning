"use client";

import { useTranslations } from "next-intl";
import { ChevronRight, Loader2, Wrench } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ReplyMarkdown } from "@/components/ai-chat/reply-markdown";
import { useAiConversation, type AiHistoryMessage, type AiHistoryToolCall } from "@/hooks/use-ai-history";
import { useDateFormat } from "@/hooks/use-date-format";
import { tDyn } from "@/i18n/dynamic";
import { cn } from "@/lib/utils";

// i18n-dynamic: admin.aiHistory.detail.roles.*
// i18n-dynamic: admin.aiHistory.detail.messageStatus.*
// i18n-dynamic: admin.aiHistory.detail.toolStatus.*

const TOOL_STATUS_CLASS: Record<string, string> = {
  EXECUTED: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  APPROVED: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  FAILED: "border-destructive/50 text-destructive",
  REJECTED: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  PROPOSED: "text-muted-foreground",
};

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded bg-muted px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ToolCall({ call }: { call: AiHistoryToolCall }) {
  const t = useTranslations("admin.aiHistory.detail");
  return (
    <details className="group rounded-md border bg-background">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-xs">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono">{call.tool}</span>
        <Badge variant="outline" className={cn("ml-auto text-[10px]", TOOL_STATUS_CLASS[call.status])}>
          {tDyn(t, `toolStatus.${call.status}`)}
        </Badge>
      </summary>
      <div className="space-y-2 border-t px-2 py-2 text-xs">
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">{t("arguments")}</p>
          <Json value={call.arguments} />
        </div>
        {call.result !== null && call.result !== undefined && (
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground">{t("result")}</p>
            <Json value={call.result} />
          </div>
        )}
        {call.error && <p className="text-destructive whitespace-pre-wrap">{call.error}</p>}
      </div>
    </details>
  );
}

function Message({ message }: { message: AiHistoryMessage }) {
  const t = useTranslations("admin.aiHistory.detail");
  const { formatDateTime, formatNumber } = useDateFormat();
  const isUser = message.role === "USER";
  const tokens = (message.promptTokens ?? 0) + (message.completionTokens ?? 0);
  return (
    <div className={cn("space-y-2 rounded-lg border p-3", isUser ? "bg-muted/50" : "bg-card")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Badge variant={isUser ? "secondary" : "outline"} className={cn("text-[10px]", message.error && "border-destructive/50 text-destructive")}>
          {tDyn(t, `roles.${message.role}`)}
        </Badge>
        <span>{formatDateTime(message.createdAt)}</span>
        {message.model && <span className="font-mono text-[11px]">{message.model}</span>}
        {message.costUsd !== null && (
          <span className="tabular-nums">{formatNumber(Number(message.costUsd), { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
        )}
        {tokens > 0 && (
          <span className="tabular-nums">
            {t("tokens", { prompt: formatNumber(message.promptTokens ?? 0), completion: formatNumber(message.completionTokens ?? 0) })}
          </span>
        )}
        {message.durationMs !== null && <span className="tabular-nums">{t("duration", { seconds: formatNumber(message.durationMs / 1000, { maximumFractionDigits: 1 }) })}</span>}
        {message.status !== "DONE" && (
          <Badge variant="outline" className="text-[10px]">{tDyn(t, `messageStatus.${message.status}`)}</Badge>
        )}
      </div>
      {message.content &&
        (message.role === "ASSISTANT" ? (
          <ReplyMarkdown text={message.content} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
        ))}
      {message.error && <p className="whitespace-pre-wrap break-words text-xs text-destructive">{message.error}</p>}
      {message.toolCalls.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t("toolCalls", { count: message.toolCalls.length })}</p>
          {message.toolCalls.map((call) => (
            <ToolCall key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only transcript of a conversation (administration). */
export function ConversationDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations("admin.aiHistory");
  const tc = useTranslations("common");
  const { formatDateTime } = useDateFormat();
  const { data, isLoading } = useAiConversation(id);

  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 pr-6">
            <span className="min-w-0 break-words">{data?.title ?? t("detail.title")}</span>
            {data?.deletedAt && <Badge variant="secondary" className="text-[10px]">{t("deletedBadge")}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {data
              ? t("detail.subtitle", { user: data.userName || t("unknownUser"), date: formatDateTime(data.createdAt) })
              : tc("states.loading")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : data && data.messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("detail.empty")}</p>
          ) : (
            data?.messages.map((message) => <Message key={message.id} message={message} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
