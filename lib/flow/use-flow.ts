"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FlowFrame, Proposal } from "./types";

/**
 * One turn of flow, streamed. Both surfaces run through here.
 *
 * There are two places a creator can talk to flow — the panel that opens over
 * whatever page they are on, and the full chat at /flow — and they are the same
 * conversation with the same thread ids. Forking the streaming into two copies
 * is how they end up disagreeing about what a turn is, so it lives here once
 * and both mount it.
 */

export type Turn = {
  id?: string;
  role: "user" | "assistant";
  text: string;
  images: number;
  /**
   * What to draw for those images. Data urls while the turn is still in this
   * browser, `/api/flow/image/...` urls once it has been read back from the
   * database. Same field either way, so the transcript renders one thing.
   */
  previews?: string[];
};

export type Attachment = { media_type: string; data: string; name: string };

/**
 * One thing flow did on its way to the answer.
 *
 * They live for the length of a turn and are never stored: what a creator wants
 * back next week is the answer, not the four reads under it. While the turn is
 * running they are the whole difference between a slow answer and a dead
 * screen, which is why they are state rather than a spinner.
 */
export type Step = {
  id: number;
  name: string;
  state: "run" | "done" | "fail";
  detail?: string | null;
};

type Options = {
  /** null starts a new thread on the first send. */
  threadId: string | null;
  initialTurns?: Turn[];
  initialCards?: Proposal[];
  /**
   * Where the creator is, so "this deal" resolves without naming a brand. The
   * chat page passes null: /flow is not a page that is about anything.
   */
  pageRef: string | null;
  /** Fires once, when a brand new thread gets its id. */
  onThreadCreated?: (id: string) => void;
  /** Fires when a turn finishes, for anything that needs to re-read the server. */
  onSettled?: () => void;
};

export function useFlow({
  threadId,
  initialTurns = [],
  initialCards = [],
  pageRef,
  onThreadCreated,
  onSettled,
}: Options) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [live, setLive] = useState("");
  const [tool, setTool] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [cards, setCards] = useState<Proposal[]>(initialCards);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const thread = useRef<string | null>(threadId);
  /** step keys. a turn can call the same tool twice and react needs them apart. */
  const stepId = useRef(0);

  /**
   * The in-flight turn's abort handle. Without it, unmounting mid-stream (the
   * panel closing, a navigation) leaves the reader loop running against a
   * component that is gone.
   */
  const aborter = useRef<AbortController | null>(null);
  useEffect(() => () => aborter.current?.abort(), []);

  const attach = useCallback(async (list: FileList | File[]) => {
    const picked = Array.from(list)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, 4);

    const read = await Promise.all(
      picked.map(
        (file) =>
          new Promise<Attachment>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                media_type: file.type,
                // the api wants raw base64, so the data: prefix comes off here
                data: String(reader.result).split(",")[1] ?? "",
                name: file.name,
              });
            reader.readAsDataURL(file);
          })
      )
    );

    setFiles((prev) => [...prev, ...read].slice(0, 4));
  }, []);

  const drop = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const reset = useCallback(() => {
    thread.current = null;
    setTurns([]);
    setCards([]);
    setLive("");
    setTool(null);
    setSteps([]);
    setError(null);
    setFiles([]);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if ((!body && files.length === 0) || busy) return;

      setBusy(true);
      setError(null);
      setLive("");
      setSteps([]);
      // the attachments are already base64 in memory, so the optimistic turn can
      // show the real screenshots immediately rather than the word "1 image".
      // a refresh later swaps these for the stored urls, and neither the
      // transcript nor the eye can tell.
      const previews = files.map((f) => `data:${f.media_type};base64,${f.data}`);
      setTurns((prev) => [
        ...prev,
        { role: "user", text: body, images: files.length, previews },
      ]);

      const payload = {
        thread_id: thread.current,
        page_ref: pageRef,
        text: body,
        images: files.map(({ media_type, data }) => ({ media_type, data })),
      };
      setFiles([]);

      const ctrl = new AbortController();
      aborter.current = ctrl;

      try {
        const res = await fetch("/api/flow/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          const failed = await res.json().catch(() => ({ error: "Flow is not answering." }));
          throw new Error(failed.error ?? "Flow is not answering.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // frames are `data: <json>\n\n`, so a partial tail stays in the
          // buffer until the rest of it arrives.
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;

            const frame = JSON.parse(line.slice(6)) as FlowFrame;

            if (frame.type === "thread") {
              const fresh = !thread.current;
              thread.current = frame.id;
              if (fresh) onThreadCreated?.(frame.id);
            } else if (frame.type === "text") {
              answer += frame.delta;
              setLive(answer);
              setTool(null);
            } else if (frame.type === "tool") {
              setTool(frame.name);
              stepId.current += 1;
              const id = stepId.current;
              setSteps((prev) => [...prev, { id, name: frame.name, state: "run" }]);
            } else if (frame.type === "tool_done") {
              // the last still-running row for that tool, because a turn is
              // allowed to call the same read twice with different arguments.
              setSteps((prev) => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i -= 1) {
                  if (next[i].name === frame.name && next[i].state === "run") {
                    next[i] = {
                      ...next[i],
                      state: frame.ok ? "done" : "fail",
                      detail: frame.detail ?? null,
                    };
                    break;
                  }
                }
                return next;
              });
            } else if (frame.type === "proposal" || frame.type === "applied") {
              setCards((prev) =>
                prev.some((p) => p.id === frame.proposal.id) ? prev : [...prev, frame.proposal]
              );
            } else if (frame.type === "error") {
              setError(frame.message);
            }
          }
        }

        setTurns((prev) => [...prev, { role: "assistant", text: answer, images: 0 }]);
      } catch (err) {
        // an abort is the component leaving, not the turn failing.
        if (!ctrl.signal.aborted) {
          setError(err instanceof Error ? err.message : "Flow is not answering.");
        }
      } finally {
        setLive("");
        setTool(null);
        // the steps go with the live text: the finished turn is a message in
        // the transcript, and a transcript of a conversation does not keep the
        // working out.
        setSteps([]);
        setBusy(false);
        onSettled?.();
      }
    },
    [busy, files, onSettled, onThreadCreated, pageRef]
  );

  return { turns, live, tool, steps, cards, files, busy, error, send, attach, drop, reset };
}
