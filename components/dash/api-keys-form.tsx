"use client";

import { useActionState, useState } from "react";
import { clearApiKey, saveApiKey, type SettingsState } from "@/app/(dash)/settings/actions";
import { Note, Submit } from "@/components/dash/form";
import { KEY_LABEL, KEY_PROVIDERS, type KeyProvider } from "@/lib/api-keys";

const empty: SettingsState = {};

export type KeyRow = { provider: KeyProvider; hint: string | null };

/**
 * The programme's own api keys.
 *
 * Write only, and that is not a limitation to work around: `read_api_credential`
 * is granted to `service_role` and to nothing a browser can reach, so this form
 * genuinely cannot show a key back. What it can show is the last four
 * characters, which is enough to answer the only question anybody asks of a
 * saved key — "is that the one I think it is" — without a screen that leaks
 * every credential to whoever walks past it.
 */
export function ApiKeysForm({ rows }: { rows: KeyRow[] }) {
  const saved = new Map(rows.map((r) => [r.provider, r.hint]));

  return (
    <div className="divide-y divide-line">
      {KEY_PROVIDERS.map((provider) => (
        <Row key={provider} provider={provider} hint={saved.get(provider) ?? null} />
      ))}
    </div>
  );
}

function Row({ provider, hint }: { provider: KeyProvider; hint: string | null }) {
  const meta = KEY_LABEL[provider];
  const [saveState, save] = useActionState(saveApiKey, empty);
  const [clearState, clear] = useActionState(clearApiKey, empty);
  const [value, setValue] = useState("");

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[14px] font-bold tracking-[-0.01em]">{meta.name}</p>
        <p className="text-[12px] text-ink-50">{meta.where}</p>
      </div>
      <p className="mt-0.5 text-[12.5px] text-ink-50">{meta.what}</p>

      <form
        action={save}
        className="mt-2.5 flex flex-wrap items-center gap-2"
        onSubmit={() => setValue("")}
      >
        <input type="hidden" name="provider" value={provider} />
        <input
          type="password"
          name="secret"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={hint ? `saved, ending ${hint}` : "using the deploy's own"}
          aria-label={`${meta.name} api key`}
          className="h-10 min-w-0 flex-1 rounded-md border border-line bg-shell px-3.5 font-mono text-[13px] placeholder:font-sans placeholder:text-ink-50/70 focus:border-ink focus:outline-none"
        />
        <Submit size="sm" pendingLabel="saving">
          {hint ? "Replace" : "Save"}
        </Submit>
      </form>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Note state={saveState} />
        <Note state={clearState} />
        {hint && !clearState.ok && (
          <form action={clear}>
            <input type="hidden" name="provider" value={provider} />
            <Submit tone="ghost" size="xs" pendingLabel="removing">
              remove
            </Submit>
          </form>
        )}
      </div>
    </div>
  );
}
