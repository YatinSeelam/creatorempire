"use client";

import { useMemo, useRef, useState } from "react";
import { BrandMark } from "@/components/dash/brand-mark";
import {
  CURATED_BRANDS,
  brandSlug,
  resolveBrandIdentity,
  searchBrands,
  type CuratedBrand,
} from "@/lib/brand-catalog";
import { uploadBrandLogo } from "@/lib/brand-logo-upload";

/**
 * The brand, picked rather than typed.
 *
 * Three sources, one box. Brands the creator already has come first, because
 * attaching a second deal to the Candle on file is the common case and forking
 * it in two is the mistake worth designing out. Under those sits the curated
 * catalogue, so typing "candle" turns up Candle with its real logo without
 * anyone hunting for a png. Under that, whatever was typed, as a new brand,
 * because a brand the list has never heard of has to be a slower path and never
 * a blocked one.
 *
 * **The results are the page, not a dropdown.** This used to be a combobox: the
 * brands lived in an overlay that opened on focus and closed on blur, so the
 * step below the search box was empty until you touched it, the logos were 36px
 * rows in a scroller, and the thing you picked left the list to become a
 * separate summary strip. Now the same three sources are one grid of cards that
 * is always on screen — typing filters it in place rather than dropping a panel
 * over it, and picking sets a card rather than replacing the view. Nothing
 * opens, nothing closes, and the brand you chose stays where you chose it.
 *
 * It posts one of two shapes and never both: `brand_id` for something that
 * exists, or `brand_name` plus `brand_logo_key` for something that does not.
 * The server treats those as the same question and answers it once, in
 * `resolveBrand()`, so a stale hidden field cannot produce two answers.
 */

export type PickerBrand = {
  id: string;
  name: string;
  /** already resolved server side, so the client never re-derives a logo path. */
  logo: string;
};

type Choice = {
  /** null means "create this brand on save". */
  id: string | null;
  name: string;
  logo: string;
  logoKey: string | null;
  /** a favicon, for a new brand the catalogue has never heard of. */
  logoUrl: string | null;
  website: string | null;
};

const fromCurated = (b: CuratedBrand): Choice => ({
  id: null,
  name: b.name,
  logo: b.logo,
  logoKey: b.key,
  logoUrl: null,
  website: b.website ?? null,
});

const fromExisting = (b: PickerBrand): Choice => ({
  id: b.id,
  name: b.name,
  logo: b.logo,
  logoKey: null,
  logoUrl: null,
  website: null,
});

/**
 * How many tiles each group shows before "show all" takes over.
 *
 * The catalogue is 49 brands. Rendering all of them turns the shortest step in
 * the wizard into the tallest thing in the product, and nobody reaches a brand
 * by scrolling past forty logos anyway: they know the name, or it is already
 * one of theirs. Both groups are capped, searching narrows, and browsing the
 * whole list is one tap away for the person who only half-remembers the name.
 */
const MINE_CAP = 6;
const LIST_CAP = 6;

export function BrandPicker({
  brands,
  defaultBrandId,
}: {
  brands: PickerBrand[];
  defaultBrandId?: string;
}) {
  const [choice, setChoice] = useState<Choice | null>(() => {
    const found = brands.find((b) => b.id === defaultBrandId);
    return found ? fromExisting(found) : null;
  });
  const [query, setQuery] = useState("");
  // a logo the creator uploaded for a NEW brand. it lives beside the choice
  // rather than inside it because picking a different card must drop it: the
  // file belongs to the brand it was uploaded for, not to the step.
  const [customLogo, setCustomLogo] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { mine, catalog, typed, typedName, top } = useMemo(() => {
    const q = query.trim();
    const slug = brandSlug(q);
    // one box takes a name or a url, because some people know the brand and
    // some just have the tab open. everything below works off what that
    // resolves to rather than the raw text.
    const resolved = q ? resolveBrandIdentity(q) : null;
    const wantSlug = brandSlug(resolved?.name ?? q);

    const mine = slug
      ? brands.filter((b) => {
          const s = brandSlug(b.name);
          return s.includes(slug) || s === wantSlug;
        })
      : brands;

    // a brand on file wins over the catalogue entry of the same name, so the
    // grid never offers the same company twice.
    const taken = new Set(brands.map((b) => brandSlug(b.name)));
    let hits = (slug ? searchBrands(q) : CURATED_BRANDS).filter(
      (b) => !taken.has(brandSlug(b.name))
    );
    // a pasted url has no name in it, so the text search cannot find the brand
    // it points at. the domain match can, and it leads.
    const byUrl = resolved?.curated;
    if (byUrl && !taken.has(brandSlug(byUrl.name)) && !hits.some((h) => h.key === byUrl.key)) {
      hits = [byUrl, ...hits];
    }
    // untyped, the catalogue is not offered at all once the creator has brands
    // of their own: 49 logos nobody asked for is the whole step turned into a
    // scroll, and the answer is nearly always one of the five already there.
    // somebody with no brands yet gets a browse rail so the step is not blank.
    // the length cap is applied in the render, not here, so "show all" has the
    // full list to open onto.
    const catalog = slug ? hits : mine.length ? [] : hits;

    // only offer "add it yourself" when nothing already is it. an exact match
    // on the slug is the same brand however it was spelled.
    const exact =
      mine.some((b) => brandSlug(b.name) === wantSlug) ||
      hits.some((b) => brandSlug(b.name) === wantSlug);

    // what enter takes: the creator's own brand before the catalogue's.
    const first = mine[0];
    const fallback = catalog[0];
    const top: Choice | null = first
      ? fromExisting(first)
      : fallback
        ? fromCurated(fallback)
        : null;

    return {
      mine,
      catalog,
      typed: slug && !exact ? q : null,
      // what the add tile calls it: "krea.ai" offers to add Krea AI.
      typedName: resolved?.name ?? q,
      top,
    };
  }, [query, brands]);

  const choose = (next: Choice) => {
    setChoice(next);
    setCustomLogo("");
    setUploadError("");
    // the query is left alone on purpose. clearing it used to be how the panel
    // got out of the way; the grid has nowhere to go, and wiping what somebody
    // typed the instant they clicked repaints the whole step under their cursor.
  };

  const chooseTyped = (raw: string) => {
    // typing a name the catalogue knows still gets that logo. this is what
    // makes "candle" arrive with Candle's mark without touching the grid.
    const hit = resolveBrandIdentity(raw);
    if (hit?.curated) {
      choose(fromCurated(hit.curated));
      return;
    }
    if (hit) {
      // nobody has catalogued it, but it has a site, so it still arrives with
      // its own mark and its url instead of a letter and a blank field.
      choose({
        id: null,
        name: hit.name,
        logo: hit.logo,
        logoKey: null,
        logoUrl: hit.logo,
        website: hit.website,
      });
      return;
    }
    choose({ id: null, name: raw, logo: "", logoKey: null, logoUrl: null, website: null });
  };

  const isPicked = (c: { id: string | null; name: string }) =>
    !!choice &&
    (c.id ? choice.id === c.id : choice.id === null && brandSlug(choice.name) === brandSlug(c.name));

  // Typing is what narrows the list, so a list opened up by hand closes again
  // the moment the query changes: otherwise a search lands in a forty-tile grid
  // that was opened three keystrokes ago. Adjusted during render rather than in
  // an effect, so the narrowed results never paint at full height first.
  const [seenQuery, setSeenQuery] = useState(query);
  if (seenQuery !== query) {
    setSeenQuery(query);
    setExpanded(false);
  }

  // what the logo block is actually looking at: an upload wins, otherwise
  // whatever the pick arrived with.
  const shownLogo = customLogo || choice?.logo || "";
  /** nothing to show, so the upload is the only way this brand gets a mark. */
  const needsLogo = !shownLogo;

  const mineShown = expanded ? mine : mine.slice(0, MINE_CAP);
  const catalogShown = expanded ? catalog : catalog.slice(0, LIST_CAP);
  const hidden =
    mine.length - mineShown.length + (catalog.length - catalogShown.length);

  // a brand picked and then searched past is still the answer, so it gets a
  // card of its own above the results rather than silently vanishing.
  const strayed =
    choice &&
    !mine.some((b) => b.id === choice.id) &&
    !catalog.some((b) => choice.id === null && brandSlug(b.name) === brandSlug(choice.name));

  return (
    <div>
      {/* ------------------------------------------------------------ search */}
      <div className="flex items-center rounded-2xl border border-line bg-paper px-4 transition-colors focus-within:border-flame">
        <svg viewBox="0 0 24 24" className="size-[19px] shrink-0 text-ink-50" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              return;
            }
            if (e.key !== "Enter") return;
            // an empty box means "I am done here", so enter falls through to the
            // wizard and continues. with something typed it means "take the
            // obvious one": a match beats the raw text, so "cand" is Candle and
            // not a new brand called cand.
            if (!query.trim()) return;
            e.preventDefault();
            if (top) choose(top);
            else if (typed) chooseTyped(typed);
          }}
          placeholder="Search brands or type a new one"
          aria-label="Search brands"
          className="w-full bg-transparent py-3 pl-3 text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
            aria-label="Clear search"
            className="shrink-0 rounded-full p-1 text-ink-50 transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* ---------------------------------------------------------- results
          no scroller of its own. the wizard's step body is already one, and a
          list that scrolls inside a panel that scrolls inside a page is three
          ways to lose your place. so it does not grow either: both groups are
          capped and the rest is behind "show all". */}
      <div>
      {/* ------------------------------------------------------------- picked */}
      {choice && strayed && (
        <Section label="Picked">
          <Card
            name={choice.name}
            logo={choice.logo}
            picked
            hint={choice.id ? undefined : "new brand"}
            onPick={() => {}}
          />
        </Section>
      )}

      {/* -------------------------------------------------------------- mine */}
      {mineShown.length > 0 && (
        <Section label={query.trim() ? "Your brands" : "Recent brands"}>
          {mineShown.map((b) => (
            <Card
              key={b.id}
              name={b.name}
              logo={b.logo}
              picked={isPicked(b)}
              onPick={() => choose(fromExisting(b))}
            />
          ))}
          {/* the catalogue section carries the add tile when it is on screen.
              when it is not, it belongs here, so there is exactly one of it. */}
          {catalogShown.length === 0 &&
            (typed ? (
              <AddCard label={`Add "${typedName}"`} onPick={() => chooseTyped(typed)} />
            ) : (
              <AddCard onPick={() => searchRef.current?.focus()} />
            ))}
        </Section>
      )}

      {/* ----------------------------------------------------------- catalog */}
      {catalogShown.length > 0 && (
        <Section label={mine.length ? "From the list" : query.trim() ? "Matches" : "Popular brands"}>
          {catalogShown.map((b) => (
            <Card
              key={b.key}
              name={b.name}
              logo={b.logo}
              picked={isPicked({ id: null, name: b.name })}
              onPick={() => choose(fromCurated(b))}
            />
          ))}
          {typed ? (
            <AddCard label={`Add "${typedName}"`} onPick={() => chooseTyped(typed)} />
          ) : (
            <AddCard onPick={() => searchRef.current?.focus()} />
          )}
        </Section>
      )}

      {/* nothing matched at all: the typed name is the only card on screen, and
          it is a real one rather than a dead end with a retry hint. */}
      {mine.length === 0 && catalog.length === 0 && (
        <Section label={typed ? "Not on any list" : "No brands yet"}>
          {typed ? (
            <AddCard label={`Add "${typedName}"`} onPick={() => chooseTyped(typed)} />
          ) : (
            <AddCard onPick={() => searchRef.current?.focus()} />
          )}
        </Section>
      )}

      {(hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-3 text-[13px] font-semibold text-ink-50 transition-colors hover:text-ink"
        >
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
      </div>

      {/* ------------------------------------------------------------- logo
          only for a brand being created here. an existing brand's mark is
          edited on its deal page, where the change is visibly "everywhere".

          the upload is a prompt only when there is nothing to show. a brand
          picked off the list arrives with its real mark already attached, and
          it is drawn on the card the creator just tapped, so a second copy of
          it under a "Logo" heading with an upload beside it says "this one is
          missing" about a logo that is right there. the whole block is gone in
          that case. the only version that survives an attached mark is an
          upload the creator made themselves, which needs a way back. */}
      {choice && !choice.id && (needsLogo || customLogo) && (
        <div className="mt-5">
          <p className="text-[12.5px] font-bold tracking-[-0.01em] text-ink-70">Logo</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <BrandMark name={choice.name} logo={shownLogo} size="lg" />
            {customLogo ? (
              <span className="text-[12.5px] text-ink-50">
                Your upload.{" "}
                <button
                  type="button"
                  onClick={() => setCustomLogo("")}
                  className="font-semibold text-ink-70 underline underline-offset-2 transition-colors hover:text-flame"
                >
                  {choice.logo ? "Go back to the list one" : "Remove it"}
                </button>
                .
              </span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="rounded-pill border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-70 transition-colors hover:text-ink disabled:opacity-60"
                >
                  {uploading ? "Uploading" : "Upload a logo"}
                </button>
                <span className="text-[12.5px] text-ink-50">
                  Optional. A png, jpg, webp or svg under 1MB.
                </span>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              aria-label="Upload a logo"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploadError("");
                setUploading(true);
                try {
                  setCustomLogo(await uploadBrandLogo(file));
                } catch (err) {
                  setUploadError(
                    err instanceof Error ? err.message : "Upload failed. Try again."
                  );
                } finally {
                  setUploading(false);
                }
              }}
            />
          </div>
          {uploadError && (
            <p className="mt-2 text-[12px] font-semibold text-flame-dark">{uploadError}</p>
          )}
        </div>
      )}

      {choice?.id ? (
        <input type="hidden" name="brand_id" value={choice.id} />
      ) : choice ? (
        <>
          <input type="hidden" name="brand_name" value={choice.name} />
          {/* an upload is the creator saying "this one", so it silences the
              catalogue key rather than racing it. */}
          <input
            type="hidden"
            name="brand_logo_key"
            value={customLogo ? "" : (choice.logoKey ?? "")}
          />
          <input
            type="hidden"
            name="brand_logo_url"
            value={customLogo || choice.logoUrl || ""}
          />
          <input type="hidden" name="brand_website" value={choice.website ?? ""} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Three across, not two. The card is 680px wide, so a two-column grid spends
 * 320px on a 36px mark and a one-word name and then pays for it in height:
 * twelve brands was six rows and most of a screen. Three columns is the same
 * twelve in four rows with room to spare for the names that are actually long.
 */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-[12.5px] font-bold tracking-[-0.01em] text-ink-70">{label}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

/**
 * One brand, one card. The tick is the whole selected state on purpose: a
 * border alone is a 1px difference between "this is the deal's brand" and "this
 * is a brand", which is not enough weight for the only decision on the step.
 */
function Card({
  name,
  logo,
  hint,
  picked,
  onPick,
}: {
  name: string;
  logo: string;
  hint?: string;
  picked?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={name}
      aria-pressed={picked}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        picked
          ? "border-flame bg-flame/[0.05]"
          : "border-line bg-paper hover:border-ink-50/35 hover:bg-shell"
      }`}
    >
      <BrandMark name={name} logo={logo} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold tracking-[-0.015em]">{name}</span>
        {hint && <span className="block truncate text-[11.5px] text-ink-50">{hint}</span>}
      </span>
      {picked && (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-flame">
          <svg viewBox="0 0 24 24" className="size-3 text-on-accent" aria-hidden="true">
            <path
              d="m5 12.5 4.5 4.5L19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
    </button>
  );
}

function AddCard({ label = "Add new brand", onPick }: { label?: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex items-center gap-2.5 rounded-xl border border-dashed border-line px-3 py-2.5 text-left text-ink-50 transition-colors hover:border-flame hover:text-ink"
    >
      <span className="flex size-9 shrink-0 items-center justify-center">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
          <path
            d="M12 5v14M5 12h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="min-w-0 truncate text-[13.5px] font-semibold tracking-[-0.015em]">{label}</span>
    </button>
  );
}
