"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Platform } from "@/lib/deals";
import { PlatformGlyph } from "./platform-glyph";

/**
 * Flow's answers, rendered.
 *
 * Everything a model writes back is markdown, and printing it raw is how a
 * table of view counts arrives as `**totals:**` and a wall of hyphens. This is
 * the renderer, styled against the app's own type scale rather than a
 * typography plugin, because a chat answer sits next to the deal pages and
 * should read like they do.
 *
 * `react-markdown` renders to React elements and never to raw html, so a
 * model-authored `<script>` is text, not a script. That matters more here than
 * anywhere else in the product: some of what flow renders came out of a brand's
 * email or a screenshot, which is to say out of somebody else's hands.
 *
 * GFM is on for tables. Tables are the whole reason this exists — "views per
 * platform" is a table, and a bullet list pretending to be one is the thing
 * that looked bad.
 */

const cell = "border-b border-rail-line px-3 py-1.5 text-left align-top";

/**
 * Which platform a link points at, read off the host.
 *
 * The model is told to link accounts using the `url` the tool handed it, so by
 * the time a link reaches here it is a real profile url and the host is enough
 * to know whose it is. Doing it this way means flow never has to say "on
 * instagram" in words: the mark says it, the way it does everywhere else in the
 * app.
 */
function platformOf(href: string | undefined): Platform | null {
  if (!href) return null;
  try {
    const host = new URL(href).hostname.replace(/^www\./, "");
    if (host === "tiktok.com") return "tiktok";
    if (host === "instagram.com") return "instagram";
    if (host === "youtube.com" || host === "youtu.be") return "youtube";
  } catch {
    // a relative or malformed href is just a link.
  }
  return null;
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[14.5px] leading-relaxed text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // paragraphs carry the rhythm. first one loses its top margin so a
          // bubble does not open with a gap.
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,

          h1: ({ children }) => (
            <h3 className="mb-2 mt-4 text-[17px] font-extrabold tracking-[-0.02em] first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-4 text-[16px] font-extrabold tracking-[-0.02em] first:mt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1.5 mt-4 text-[15px] font-bold tracking-[-0.015em] first:mt-0">
              {children}
            </h4>
          ),

          strong: ({ children }) => <strong className="font-bold text-ink">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,

          ul: ({ children }) => (
            <ul className="mb-3 space-y-1 last:mb-0 [&_ul]:mb-0 [&_ul]:mt-1 [&_ul]:pl-4">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => (
            // the marker is drawn rather than listed, so a long wrapped line
            // hangs under its text instead of under the bullet.
            <li className="relative pl-4 marker:text-ink-50 [ol>&]:pl-0">
              <span className="absolute left-0 top-[0.62em] size-1 rounded-full bg-ink-50 [ol>&]:hidden" />
              {children}
            </li>
          ),

          // a table can be wider than the column, and the page must not scroll
          // sideways because of it.
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto last:mb-0">
              <table className="w-full min-w-[320px] border-collapse text-[13.5px]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="text-ink-50">{children}</thead>,
          th: ({ children }) => (
            <th className={`${cell} border-b-2 font-semibold`}>{children}</th>
          ),
          td: ({ children }) => <td className={cell}>{children}</td>,
          tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,

          code: ({ children, className }) =>
            // a fenced block arrives with a language class, an inline span
            // does not. that is the only thing separating the two here.
            className ? (
              <code className="block overflow-x-auto rounded-xl bg-paper p-3 font-mono text-[12.5px] leading-relaxed">
                {children}
              </code>
            ) : (
              <code className="rounded-md bg-paper px-1.5 py-0.5 font-mono text-[12.5px]">
                {children}
              </code>
            ),
          pre: ({ children }) => <pre className="mb-3 last:mb-0">{children}</pre>,

          a: ({ children, href }) => {
            const platform = platformOf(href);

            // noreferrer noopener on every one of these: some of what flow
            // renders came out of a brand's email, so the destination is not
            // always something the creator chose.
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className={
                  platform
                    ? "inline-flex items-baseline gap-1 font-semibold text-ink underline decoration-ink-50 underline-offset-2 hover:decoration-flame"
                    : "text-flame underline underline-offset-2"
                }
              >
                {platform ? (
                  <PlatformGlyph
                    platform={platform}
                    tone="brand"
                    className="size-[15px] translate-y-[2px]"
                  />
                ) : null}
                {children}
              </a>
            );
          },

          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-rail-line pl-3 text-ink-70 last:mb-0">
              {children}
            </blockquote>
          ),

          hr: () => <hr className="my-4 border-rail-line" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
