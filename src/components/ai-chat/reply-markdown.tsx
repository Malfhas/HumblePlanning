"use client";

import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Assistant reply. Models answer in Markdown: without rendering, number
 * tables arrive as vertical bars and amounts as
 * asterisks - unreadable for job tracking.
 *
 * Memoized: during streaming, each chunk re-renders the whole thread; only
 * the message whose text changes must re-parse its Markdown.
 */
export const ReplyMarkdown = memo(function ReplyMarkdown({ text }: { text: string }) {
  return (
    // A wide table or code block scrolls within its frame and never widens
    // the page, wherever the reply is rendered: the thread, the floating panel, or the
    // conversation detail in the administration.
    <div className="min-w-0 max-w-full space-y-2 text-ai-sm leading-relaxed text-ai-primary max-md:break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-ai-primary">{children}</strong>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-0.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-0.5 pl-5">{children}</ol>,
          h1: ({ children }) => <h3 className="text-ai-sm font-semibold text-ai-primary">{children}</h3>,
          h2: ({ children }) => <h3 className="text-ai-sm font-semibold text-ai-primary">{children}</h3>,
          h3: ({ children }) => <h4 className="text-ai-sm font-medium text-ai-primary">{children}</h4>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-ai-link hover:underline">
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded-ai-sm bg-ai-sunken px-1 py-0.5 font-ai-mono text-[12px]">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="max-w-full overflow-x-auto rounded-ai-md bg-ai-sunken p-2 font-ai-mono text-[11px]">
              {children}
            </pre>
          ),
          // A table of amounts must read like in the rest of the tool
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto rounded-ai-md border border-ai-border-subtle">
              <table className="w-full text-ai-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-ai-sunken text-ai-muted">{children}</thead>,
          // Phone: cells do not shrink, the table scrolls within its frame
          th: ({ children }) => (
            <th className="px-2 py-1 text-left font-medium max-md:whitespace-nowrap">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-t border-ai-border-subtle px-2 py-1 max-md:whitespace-nowrap">
              {children}
            </td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-ai-border-strong pl-3 text-ai-secondary">
              {children}
            </blockquote>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});
