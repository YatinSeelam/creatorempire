"use client";

import { useState, type ReactNode } from "react";
import { Panel } from "@/components/dash/ui";

/**
 * The two conversations a batch has, as two tabs instead of two panels a
 * screen apart.
 *
 * There are exactly two people on the other end of a job and they are not the
 * same person: the EDITOR, who cuts it and can be told to change it, and the
 * CAMPAIGN MANAGER, who signs it off through a link and has no login here.
 * Those used to render as a "Client review" panel in the middle of the page and
 * a "messages" panel at the bottom, with nothing saying they were different
 * people or that one was waiting on the other. That is the thing that read as
 * confusing, and it was a layout problem, not a missing feature.
 *
 * Both panes are server-rendered and passed in, so the forms inside them stay
 * plain server actions. The inactive one is hidden rather than unmounted: these
 * hold half-typed messages and a scrolled thread, and swapping tabs is not a
 * reason to throw either away.
 */

type Tab = "editor" | "manager";

export function JobConversation({
  editor,
  manager,
  editorLabel,
  editorCount,
  managerCount,
  initial = "editor",
}: {
  editor: ReactNode;
  manager: ReactNode;
  /** the editor's name, or a stand-in while nobody has claimed it. */
  editorLabel: string;
  /** messages in the editor thread. */
  editorCount: number;
  /** notes from the manager still waiting on a decision. */
  managerCount: number;
  initial?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initial);

  return (
    <Panel
      title="Conversation"
      padded={false}
      toolbar={
        <div className="flex gap-1.5">
          <TabButton
            on={tab === "editor"}
            onClick={() => setTab("editor")}
            label={editorLabel}
            count={editorCount}
          />
          <TabButton
            on={tab === "manager"}
            onClick={() => setTab("manager")}
            label="Campaign manager"
            count={managerCount}
            // a note nobody has dealt with is the one badge on this page that
            // is asking for something, so it is the one that gets the accent.
            urgent
          />
        </div>
      }
    >
      <div className={tab === "editor" ? "px-5 py-5 sm:px-6" : "hidden"}>{editor}</div>
      <div className={tab === "manager" ? "px-5 py-5 sm:px-6" : "hidden"}>{manager}</div>
    </Panel>
  );
}

function TabButton({
  on,
  onClick,
  label,
  count,
  urgent = false,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  count: number;
  urgent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex min-w-0 items-center gap-2 rounded-pill px-3.5 py-1.5 text-[13.5px] font-semibold transition-colors ${
        on ? "bg-ink text-white" : "text-ink-50 hover:text-ink"
      }`}
    >
      <span className="truncate">{label}</span>
      {count > 0 && (
        <span
          className={`shrink-0 rounded-pill px-1.5 py-[1px] text-[11px] font-bold tabular-nums ${
            on
              ? "bg-white/20 text-white"
              : urgent
                ? "bg-ember text-flame"
                : "bg-shell text-ink-50"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
