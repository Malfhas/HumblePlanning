"use client";

import React, { useState } from "react";
import {
  BellOff,
  Check,
  ChevronDown,
  CircleArrowUp,
  CircleCheck,
  Copy,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/hooks/use-date-format";
import { tDyn } from "@/i18n/dynamic";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useForceUpdateCheck,
  useUpdateCheck,
  type ReleaseInfo,
  type UpdateCheckError,
  type UpdateStatus,
  type VersionStatusResponse,
} from "@/hooks/use-update-check";

// i18n-dynamic: version.panel.status.*
// i18n-dynamic: version.panel.errors.*

/** Missing value (typographic dash, the same in every language). */
const NONE = "—";

const STATUS_STYLE: Record<UpdateStatus, { icon: LucideIcon; className: string }> = {
  up_to_date: {
    icon: CircleCheck,
    className: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800",
  },
  update_available: {
    icon: CircleArrowUp,
    className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
  },
  security_update: {
    icon: ShieldAlert,
    className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800",
  },
  disabled: { icon: BellOff, className: "bg-muted text-muted-foreground border-border" },
  no_release: { icon: Package, className: "bg-muted text-muted-foreground border-border" },
  error: {
    icon: TriangleAlert,
    className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  },
};

type PanelT = ReturnType<typeof useTranslations<"version.panel">>;

function errorText(t: PanelT, error: UpdateCheckError, repo: string): string {
  return tDyn(t, `errors.${error}`, { repo });
}

/** « 31 décembre 2026 »: release day, month names in the interface language. */
function useFormatDay(): (iso: string | null) => string | null {
  const { formatDate } = useDateFormat();
  return (iso) => {
    if (!iso) return null;
    try {
      return formatDate(iso, "d MMMM yyyy");
    } catch {
      return null;
    }
  };
}

// ════════════════════════════════════════════════════════════════════════
// Panel
// ════════════════════════════════════════════════════════════════════════

export function VersionPanel() {
  const t = useTranslations("version.panel");
  const { can } = usePermissions();
  const canEdit = can("settings:edit");
  const { data, isLoading, isError } = useUpdateCheck();
  const forceCheck = useForceUpdateCheck();

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }
  if (isError || !data) {
    return <div className="rounded-lg border bg-card p-4 text-sm text-destructive">{t("loadError")}</div>;
  }

  return (
    <div className="space-y-4">
      <StatusCard
        data={data}
        canEdit={canEdit}
        pending={forceCheck.isPending}
        checkError={forceCheck.error?.message ?? null}
        onCheck={() => forceCheck.mutate()}
      />
      {data.latest && <ReleaseCard release={data.latest} current={data.currentVersion} />}
      {data.history.length > 0 && <ReleaseHistory releases={data.history} current={data.currentVersion} />}
    </div>
  );
}

function StatusCard({
  data,
  canEdit,
  pending,
  checkError,
  onCheck,
}: {
  data: VersionStatusResponse;
  canEdit: boolean;
  pending: boolean;
  checkError: string | null;
  onCheck: () => void;
}) {
  const t = useTranslations("version.panel");
  const tc = useTranslations("common");
  const { formatDateTime } = useDateFormat();
  const formatDay = useFormatDay();
  const style = STATUS_STYLE[data.status];
  const StatusIcon = style.icon;
  const latest = data.latest;
  const latestDay = latest ? formatDay(latest.publishedAt) : null;
  const checkDisabled = !data.enabled || !canEdit || pending;

  const hints: string[] = [];
  if (data.status === "error" && data.error) {
    hints.push(errorText(t, data.error, data.repo));
    if (data.lastSuccessAt && latest) hints.push(t("hint.knownData", { date: formatDateTime(data.lastSuccessAt) }));
  } else if (data.status === "up_to_date") hints.push(t("hint.upToDate"));
  else if (data.status === "update_available" && latest)
    hints.push(t("hint.updateAvailable", { version: latest.version, count: data.newerCount }));
  else if (data.status === "security_update") hints.push(t("hint.securityUpdate"));
  else if (data.status === "disabled") hints.push(t("hint.disabled"));
  else if (data.status === "no_release") hints.push(t("hint.noRelease", { repo: data.repo }));

  const checkButton = (
    <Button type="button" variant="outline" size="sm" onClick={onCheck} disabled={checkDisabled}>
      <RefreshCw className={cn("size-4", pending && "animate-spin")} />
      {pending ? t("checking") : t("checkNow")}
    </Button>
  );

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold text-foreground border-b pb-2">{t("title")}</h3>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
            style.className,
          )}
          data-testid="update-status"
          data-status={data.status}
        >
          <StatusIcon className="size-3.5" />
          {tDyn(t, `status.${data.status}`)}
        </span>
        {checkDisabled && !pending ? (
          <span tabIndex={0} title={!data.enabled ? t("checkNowDisabled") : t("checkNowForbidden")}>
            {checkButton}
          </span>
        ) : (
          checkButton
        )}
      </div>

      {(hints.length > 0 || checkError) && (
        <div className="space-y-1">
          {hints.map((h, i) => (
            <p key={i} className="text-sm text-muted-foreground">
              {h}
            </p>
          ))}
          {checkError && <p className="text-sm text-destructive">{t("checkFailed", { message: checkError })}</p>}
        </div>
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <InfoItem label={t("installed")} value={`v${data.currentVersion}`} mono />
        <InfoItem
          label={t("latest")}
          value={latest ? `v${latest.version}` : NONE}
          sub={latestDay ? t("publishedOn", { date: latestDay }) : null}
          mono={!!latest}
        />
        <InfoItem
          label={t("lastCheck")}
          value={data.checkedAt ? formatDateTime(data.checkedAt) : data.enabled ? tc("time.never") : NONE}
        />
      </dl>

      <UpdateCommand
        command={data.updateCommand}
        label={data.updateAvailable && latest ? t("commandUpdate", { version: latest.version }) : t("commandIdle")}
        highlight={data.updateAvailable}
      />

      {data.enabled && data.sourceUrl && (
        <p className="text-xs text-muted-foreground break-all">
          {t("source")}{" "}
          <a href={data.repoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {data.repo}
          </a>{" "}
          (<code className="rounded bg-muted px-1 py-0.5 text-[11px]">{data.sourceUrl}</code>)
        </p>
      )}
    </div>
  );
}

function InfoItem({ label, value, sub, mono }: { label: string; value: string; sub?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm font-medium truncate", mono && "font-mono")}>{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground truncate">{sub}</dd>}
    </div>
  );
}

/** navigator.clipboard only exists in a secure context (HTTPS or localhost). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function UpdateCommand({ command, label, highlight }: { command: string; label: string; highlight: boolean }) {
  const t = useTranslations("version.panel");
  const tCommon = useTranslations("common.actions");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (await copyText(command)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      className={cn(
        "space-y-1.5 rounded-md border p-3",
        highlight ? "border-primary/30 bg-primary/5" : "bg-muted/20",
      )}
    >
      <p className="text-xs font-medium text-foreground">{label}</p>
      <div className="flex items-stretch gap-2">
        <code
          className="flex flex-1 min-w-0 items-center overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-3 py-2 font-mono text-sm select-all"
          data-testid="update-command"
        >
          {command}
        </code>
        <Button type="button" variant="outline" className="h-auto px-3" onClick={handleCopy}>
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          {copied ? t("copied") : tCommon("copy")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("commandHelp")}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Releases
// ════════════════════════════════════════════════════════════════════════

function ReleaseBadges({ release, current }: { release: ReleaseInfo; current: string }) {
  const t = useTranslations("version.panel.badges");
  const badge = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold";
  return (
    <>
      {release.security && (
        <span className={cn(badge, "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200")}>
          <ShieldAlert className="size-3" />
          {t("security")}
        </span>
      )}
      {release.newer && (
        <span className={cn(badge, "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200")}>{t("new")}</span>
      )}
      {release.version === current && (
        <span className={cn(badge, "bg-muted text-muted-foreground")}>{t("installed")}</span>
      )}
      {release.prerelease && (
        <span className={cn(badge, "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200")}>
          {t("prerelease")}
        </span>
      )}
    </>
  );
}

function ReleaseCard({ release, current, compact }: { release: ReleaseInfo; current: string; compact?: boolean }) {
  const t = useTranslations("version.panel");
  const formatDay = useFormatDay();
  const day = formatDay(release.publishedAt);
  return (
    <div className={cn("rounded-lg border bg-card space-y-3", compact ? "p-3" : "p-4")}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b pb-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold text-foreground">
              {compact ? `v${release.version}` : t("releaseNotes", { version: release.version })}
            </h3>
            <ReleaseBadges release={release} current={current} />
          </div>
          {(release.name || day) && (
            <p className="text-xs text-muted-foreground">
              {[release.name, day && t("publishedOn", { date: day })].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <a
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
        >
          {t("viewOnGithub")}
          <ExternalLink className="size-3" />
        </a>
      </div>
      <div className={cn("overflow-y-auto pr-1", compact ? "max-h-64" : "max-h-96")}>
        <ReleaseNotes markdown={release.notes} />
      </div>
    </div>
  );
}

function ReleaseHistory({ releases, current }: { releases: ReleaseInfo[]; current: string }) {
  const t = useTranslations("version.panel");
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
        >
          <span className="flex-1 text-sm font-medium">{t("history")}</span>
          <span className="text-xs text-muted-foreground">{t("historyCount", { count: releases.length })}</span>
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {releases.map((r) => (
          <ReleaseCard key={r.tag} release={r} current={current} compact />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Mini Markdown renderer (headings, lists, links, bold, code) — React elements
// only: no raw HTML is injected, tags are stripped.
// ════════════════════════════════════════════════════════════════════════

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: { depth: number; text: string }[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "hr" };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

function cleanInline(text: string): string {
  return text
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1") // autolink <https://…>
    .replace(/<\/?[a-zA-Z][^>]*>/g, "") // HTML tags
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e]);
}

function parseMarkdown(md: string): Block[] {
  const lines = md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Extract<Block, { type: "list" }> | null = null;
  let quote: string[] = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    if (list) blocks.push(list);
    if (quote.length) blocks.push({ type: "quote", text: quote.join(" ") });
    paragraph = [];
    list = null;
    quote = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // i18n-ignore false positive: the regex backtick opens a fake template literal
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      const fence = line.trim().slice(0, 3);
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ type: "hr" });
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { type: "list", ordered, items: [] };
      }
      list.items.push({ depth: Math.min(3, Math.floor(item[1].replace(/\t/g, "  ").length / 2)), text: item[3] });
      continue;
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      if (paragraph.length || list) flush();
      quote.push(quoted[1]);
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      // Continuation of a list item on the next line.
      list.items[list.items.length - 1].text += ` ${line.trim()}`;
      continue;
    }
    if (list || quote.length) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

const INLINE_RE =
  /(`+)([^`]+?)\1|!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

function SafeLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (!/^https?:\/\//i.test(href)) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary break-all">
      {children}
    </a>
  );
}

function renderInline(text: string, depth = 0): React.ReactNode[] {
  const source = depth === 0 ? cleanInline(text) : text;
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of source.matchAll(INLINE_RE)) {
    const index = m.index ?? 0;
    if (index > last) out.push(source.slice(last, index));
    const k = `${depth}-${key++}`;
    const [, , code, imageAlt, linkText, linkHref, bold1, bold2, em, url] = m;
    if (code !== undefined) {
      out.push(
        <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
          {code}
        </code>,
      );
    } else if (imageAlt !== undefined) {
      if (imageAlt) out.push(imageAlt);
    } else if (linkText !== undefined && linkHref !== undefined) {
      out.push(
        <SafeLink key={k} href={linkHref}>
          {depth < 2 ? renderInline(linkText, depth + 1) : linkText}
        </SafeLink>,
      );
    } else if (bold1 !== undefined || bold2 !== undefined) {
      const inner = (bold1 ?? bold2)!;
      out.push(<strong key={k}>{depth < 2 ? renderInline(inner, depth + 1) : inner}</strong>);
    } else if (em !== undefined) {
      out.push(<em key={k}>{depth < 2 ? renderInline(em, depth + 1) : em}</em>);
    } else if (url !== undefined) {
      out.push(
        <SafeLink key={k} href={url}>
          {url}
        </SafeLink>,
      );
    }
    last = index + m[0].length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

function ReleaseNotes({ markdown }: { markdown: string }) {
  const t = useTranslations("version.panel");
  const blocks = parseMarkdown(markdown);
  if (blocks.length === 0) return <p className="text-sm italic text-muted-foreground">{t("noNotes")}</p>;
  return (
    <div className="space-y-2 text-sm leading-relaxed text-foreground/90 break-words">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            return (
              <p
                key={i}
                role="heading"
                aria-level={Math.min(6, block.level + 3)}
                className={cn("font-semibold text-foreground pt-1", block.level <= 2 ? "text-sm" : "text-[13px]")}
              >
                {renderInline(block.text)}
              </p>
            );
          case "paragraph":
            return <p key={i}>{renderInline(block.text)}</p>;
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <ListTag key={i} className={cn("space-y-0.5 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
                {block.items.map((it, j) => (
                  <li key={j} style={it.depth ? { marginLeft: `${it.depth}rem` } : undefined}>
                    {renderInline(it.text)}
                  </li>
                ))}
              </ListTag>
            );
          }
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 pl-3 text-muted-foreground">
                {renderInline(block.text)}
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre">
                {block.text}
              </pre>
            );
          case "hr":
            return <hr key={i} className="border-border" />;
        }
      })}
    </div>
  );
}
