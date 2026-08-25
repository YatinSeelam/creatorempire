"use client";

import { useState, type ReactNode } from "react";
import { saveEditorProfile } from "@/app/editors/actions";
import { AvatarPicker } from "@/components/editors/avatar-picker";
import { Panel, VerifiedBadge } from "@/components/editors/ui";
import {
  normalizeHandle,
  EDITING_ENABLED,
  SETTINGS_TABS,
  type Editor,
  type LinkItem,
  type ReelClip,
  type SettingsTab,
} from "@/lib/editing";

/**
 * The editors row as one document, portfolio-style: the whole thing lives in
 * state, one save posts all of it, and the server's normaliser is the only
 * validator that counts. Controlled inputs on purpose — the handle preview and
 * the publish rules read the same state the fields write.
 */

const shell =
  "mt-1.5 flex items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame";
const control =
  "w-full bg-transparent py-2.5 text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
      {children}
    </span>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder = "",
  prefix,
  suffix,
  hint,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className={shell}>
        {prefix && <span className="pr-1 text-[14.5px] text-ink-50">{prefix}</span>}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={control}
        />
        {suffix && <span className="pl-1 text-[13.5px] text-ink-50">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-[12.5px] text-ink-50">{hint}</p>}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  labelOn,
  labelOff,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`rounded-pill px-4 py-2 text-[13.5px] font-semibold transition-colors ${
        on ? "bg-flame text-on-accent" : "border border-line text-ink-70 hover:text-ink"
      }`}
    >
      {on ? labelOn : labelOff}
    </button>
  );
}

const removeButton =
  "shrink-0 rounded-pill border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink-50 transition-colors hover:text-flame-dark";
const addButton =
  "rounded-pill border border-line px-4 py-2 text-[13.5px] font-semibold text-ink-70 transition-colors hover:text-ink";

/**
 * Tabbed because settings was one long column: somebody who came to change
 * their rate scrolled past four sections they did not come for. Still one save
 * button in the header, because all of this is one database row and four
 * actions writing the same row is how you get a half-saved profile. The
 * payments tab is the exception, it owns its own save, so the header one hides
 * there rather than pretending to cover it.
 *
 * title/account/contact/capacity/payments exist so /editors/settings can host
 * this whole form under its own heading instead of stacking a second one on top
 * of it.
 */
export function ProfileEditor({
  initial,
  title = "my profile",
  initialTab = "profile",
  account,
  contact,
  capacity,
  payments,
}: {
  initial: Editor;
  title?: string;
  /**
   * Which tab to open on, resolved on the server from `?tab=`.
   *
   * A query param rather than a hash: the hash never reaches the server, so
   * reading it here would render `profile` on the server and something else on
   * the client, which is a hydration mismatch. This way a link straight to the
   * payout rails actually lands on them.
   */
  initialTab?: SettingsTab;
  account?: ReactNode;
  contact?: ReactNode;
  capacity?: ReactNode;
  payments?: ReactNode;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // identity
  const [name, setName] = useState(initial.name ?? "");
  const [headline, setHeadline] = useState(initial.headline ?? "");
  const [location, setLocation] = useState(initial.location ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial.avatar_url ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");

  // skills and software stay raw text while typing; the split happens on save,
  // because splitting on every keystroke eats the comma being typed.
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [software, setSoftware] = useState(initial.software.join(", "));

  const [links, setLinks] = useState<LinkItem[]>(initial.links);
  const [reel, setReel] = useState<ReelClip[]>(initial.reel);

  const [rate, setRate] = useState(
    initial.rate_cents === null ? "" : String(initial.rate_cents / 100)
  );
  const [turnaround, setTurnaround] = useState(
    initial.turnaround_hours === null ? "" : String(initial.turnaround_hours)
  );

  const [handle, setHandle] = useState(initial.handle);
  const [published, setPublished] = useState(initial.published);
  const [active, setActive] = useState(initial.status === "active");

  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ error?: string; ok?: string }>({});

  const normalizedHandle = handle.trim() ? normalizeHandle(handle) : null;
  const splitList = (raw: string) =>
    raw.split(",").map((s) => s.trim()).filter(Boolean);

  async function save() {
    setSaving(true);
    setNote({});
    const result = await saveEditorProfile({
      handle,
      published,
      name,
      headline,
      location,
      avatar_url: avatarUrl,
      bio,
      skills: splitList(skills),
      software: splitList(software),
      links: links.filter((l) => l.url.trim()),
      reel: reel.filter((c) => c.url.trim()),
      rate,
      turnaround,
      status: active ? "active" : "paused",
    });
    setSaving(false);
    if (result.ok) {
      // adopt the server's handle so the preview shows what was stored.
      setHandle(result.handle);
      setNote({ ok: "saved." });
    } else {
      setNote({ error: result.error });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[clamp(1.5rem,3.4vw,1.95rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
            {title}
          </h1>
          {initial.verified && <VerifiedBadge />}
        </div>
        {tab !== "payments" && (
          <div className="flex items-center gap-3">
            {note.error && (
              <span className="text-[13.5px] text-flame-dark">{note.error}</span>
            )}
            {note.ok && <span className="text-[13.5px] text-ink-50">{note.ok}</span>}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="h-11 shrink-0 rounded-pill bg-flame px-6 text-[14.5px] font-semibold text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-60"
            >
              {saving ? "saving" : "save"}
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-6 overflow-x-auto border-b border-line">
        {SETTINGS_TABS.map((t) => {
          const on = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={on ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 pb-3 text-[14.5px] tracking-[-0.01em] outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-flame ${
                on
                  ? "border-flame font-extrabold text-ink"
                  : "border-transparent font-semibold text-ink-50 hover:text-ink"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>

      {tab === "profile" && (
        <div className="space-y-6">
          <Panel title="who you are">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="name"
                  value={name}
                  onChange={setName}
                  placeholder="sam the editor"
                />
                <Input
                  label="headline"
                  value={headline}
                  onChange={setHeadline}
                  placeholder="short-form editor, hooks and captions"
                />
              </div>
              {/* a picker, not a url box. asking somebody to go and host a
                  square photo somewhere and paste the link is why none of the
                  first thirteen editors had one. */}
              <AvatarPicker
                userId={initial.user_id}
                name={name}
                value={avatarUrl}
                onChange={setAvatarUrl}
              />
              <Input
                label="location"
                value={location}
                onChange={setLocation}
                placeholder="lisbon, remote"
              />
              <div>
                <Label>bio</Label>
                <div className={`${shell} items-start`}>
                  <textarea
                    rows={4}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="what you cut, who you have cut for, how you work"
                    className={`${control} resize-y`}
                  />
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="your public link">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="handle"
                value={handle}
                onChange={setHandle}
                prefix="creatorempire.app/e/"
                placeholder="sam-cuts"
                hint={
                  handle.trim() && !normalizedHandle
                    ? "3 to 30 characters: letters, numbers and dashes."
                    : normalizedHandle
                      ? `your page lives at creatorempire.app/e/${normalizedHandle}`
                      : "pick a handle to get a public page."
                }
              />
              <div>
                <Label>visibility</Label>
                <div className="mt-1.5 flex items-center gap-3">
                  <Toggle
                    on={published}
                    onChange={setPublished}
                    labelOn="published"
                    labelOff="draft"
                  />
                  <span className="text-[12.5px] text-ink-50">
                    {published
                      ? "your page is live for anyone with the link."
                      : "only you can see your page."}
                  </span>
                </div>
              </div>
            </div>
          </Panel>

          {account}
          {contact}

          <Panel
            title="reel"
            action={
              <button
                type="button"
                onClick={() =>
                  setReel([...reel, { url: "", title: "", platform: "" }])
                }
                className={addButton}
              >
                + add a clip
              </button>
            }
          >
            {reel.length === 0 ? (
              <p className="text-[13.5px] text-ink-50">
                no clips yet. your reel is the first thing a creator checks.
              </p>
            ) : (
              <div className="space-y-4">
                {reel.map((clip, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-3">
                    <Input
                      label="link"
                      value={clip.url}
                      onChange={(v) =>
                        setReel(reel.map((c, j) => (j === i ? { ...c, url: v } : c)))
                      }
                      placeholder="tiktok.com/@.../video/..."
                      className="min-w-0 flex-1 basis-56"
                    />
                    <Input
                      label="title"
                      value={clip.title}
                      onChange={(v) =>
                        setReel(reel.map((c, j) => (j === i ? { ...c, title: v } : c)))
                      }
                      placeholder="skincare hook, 2.1m views"
                      className="min-w-0 flex-1 basis-44"
                    />
                    <Input
                      label="platform"
                      value={clip.platform}
                      onChange={(v) =>
                        setReel(
                          reel.map((c, j) => (j === i ? { ...c, platform: v } : c))
                        )
                      }
                      placeholder="tiktok"
                      className="w-32"
                    />
                    <button
                      type="button"
                      onClick={() => setReel(reel.filter((_, j) => j !== i))}
                      className={`${removeButton} mb-1`}
                    >
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="links"
            action={
              <button
                type="button"
                onClick={() => setLinks([...links, { url: "", label: "" }])}
                className={addButton}
              >
                + add a link
              </button>
            }
          >
            {links.length === 0 ? (
              <p className="text-[13.5px] text-ink-50">
                socials, a site, anywhere else your work lives.
              </p>
            ) : (
              <div className="space-y-4">
                {links.map((link, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-3">
                    <Input
                      label="url"
                      value={link.url}
                      onChange={(v) =>
                        setLinks(links.map((l, j) => (j === i ? { ...l, url: v } : l)))
                      }
                      placeholder="instagram.com/samcuts"
                      className="min-w-0 flex-1 basis-64"
                    />
                    <Input
                      label="label"
                      value={link.label}
                      onChange={(v) =>
                        setLinks(
                          links.map((l, j) => (j === i ? { ...l, label: v } : l))
                        )
                      }
                      placeholder="instagram"
                      className="w-40"
                    />
                    <button
                      type="button"
                      onClick={() => setLinks(links.filter((_, j) => j !== i))}
                      className={`${removeButton} mb-1`}
                    >
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === "availability" && (
        <div className="space-y-6">
          <Panel title="availability">
            <div className="flex items-center gap-3">
              <Toggle
                on={active}
                onChange={setActive}
                labelOn="active"
                labelOff="paused"
              />
              <span className="text-[12.5px] text-ink-50">
                {EDITING_ENABLED
                  ? active
                    ? "you show up in the market and can claim jobs."
                    : "paused: you keep your jobs but cannot claim new ones."
                  : active
                    ? "you are taking work right now."
                    : "paused: we will not send you batches while this is off."}
              </span>
            </div>
          </Panel>

          {capacity}
        </div>
      )}

      {tab === "editing" && (
        <div className="space-y-6">
          <Panel title="what you do">
            <div className="space-y-4">
              <Input
                label="skills"
                value={skills}
                onChange={setSkills}
                placeholder="hooks, captions, color, sound design"
                hint="comma separated."
              />
              <Input
                label="software"
                value={software}
                onChange={setSoftware}
                placeholder="capcut, premiere, after effects"
                hint="comma separated."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="rate"
                  value={rate}
                  onChange={setRate}
                  prefix="$"
                  suffix="per video"
                  placeholder="40"
                />
                <Input
                  label="turnaround"
                  value={turnaround}
                  onChange={setTurnaround}
                  suffix="hours"
                  placeholder="48"
                />
              </div>
            </div>
          </Panel>
        </div>
      )}

      {tab === "payments" && <div className="space-y-6">{payments}</div>}
    </div>
  );
}
