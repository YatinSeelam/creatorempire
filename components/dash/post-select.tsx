"use client";

import {
  createContext,
  useActionState,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { setPostPayment } from "@/app/(dash)/deals/actions";

/**
 * Selecting rows in the posts table, and doing one thing to all of them.
 *
 * The write behind this is `setPostPayment`, unchanged. It already took a list
 * of `video_id`s and ended in `.in("id", ids)` — because a cut that went out on
 * three platforms has always had to move all three at once — so selecting
 * twenty rows is the same call with a longer list. There is no bulk path to
 * keep in step with the single one; there is one path, and the checkboxes only
 * change how much goes into it.
 *
 * The provider renders a fragment, not a wrapper. The table's rows rely on
 * `first:border-t-0` against their siblings and on a `sticky` header inside
 * Panel's scroller, and a div around them would break both. The bar is
 * `position: fixed` for the same reason the payment dialog is: Panel clips to
 * its own corners, so anything that has to sit over the table cannot live
 * inside it.
 */

type CutRef = { key: string; videoIds: string[] };

type Selection = {
  selected: Set<string>;
  toggle: (key: string, index: number, shift: boolean) => void;
  toggleAll: () => void;
  count: number;
  total: number;
};

const SelectionContext = createContext<Selection | null>(null);

function useSelection(): Selection {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("Post checkboxes have to sit inside <PostSelection>.");
  return value;
}

export function PostSelection({
  cuts,
  dealId,
  children,
}: {
  /** every cut currently on the page, in the order they are drawn. */
  cuts: CutRef[];
  dealId: string;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const lastClicked = useRef<number | null>(null);

  // paging and searching redraw `cuts`, and a key selected on page one is not
  // on page two. reading the selection back through the current page rather
  // than clearing it on navigation means the count can never describe rows that
  // are not there, without needing an effect to notice.
  const onPage = useMemo(() => cuts.filter((c) => selected.has(c.key)), [cuts, selected]);

  const value: Selection = {
    selected,
    count: onPage.length,
    total: cuts.length,
    toggle: (key, index, shift) => {
      setSelected((prev) => {
        const next = new Set(prev);

        // shift extends from the last row touched. a posts table is read down
        // the dates, so "these fifteen from july" is the selection somebody
        // actually wants and clicking it fifteen times is the reason they
        // would not bother.
        if (shift && lastClicked.current !== null) {
          const [from, to] = [lastClicked.current, index].sort((a, b) => a - b);
          const turningOn = !prev.has(key);
          for (let i = from; i <= to; i += 1) {
            const row = cuts[i];
            if (!row) continue;
            if (turningOn) next.add(row.key);
            else next.delete(row.key);
          }
        } else if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }

        return next;
      });
      lastClicked.current = index;
    },
    toggleAll: () => {
      setSelected((prev) => {
        const everyone = cuts.every((c) => prev.has(c.key));
        const next = new Set(prev);
        cuts.forEach((c) => (everyone ? next.delete(c.key) : next.add(c.key)));
        return next;
      });
      lastClicked.current = null;
    },
  };

  return (
    <SelectionContext.Provider value={value}>
      {children}
      <BulkBar
        dealId={dealId}
        // every post of every selected cut. the action writes the same amount
        // to all of them, which is what keeps a cut's own total agreeing with
        // the deal's.
        videoIds={onPage.flatMap((c) => c.videoIds)}
        cuts={onPage.length}
        onClear={() => setSelected(new Set())}
      />
    </SelectionContext.Provider>
  );
}

/* ------------------------------------------------------------- the boxes */

/**
 * A native checkbox tinted with `accent-color`, not a re-drawn one.
 *
 * A hand-built box means owning the tick, the focus ring, the indeterminate
 * dash and the keyboard behaviour, and getting the third state wrong is the
 * usual result. The browser already has all four; accent-color is the whole
 * customisation this needs.
 */
const box = "size-[15px] shrink-0 cursor-pointer accent-flame";

export function SelectAllCheck() {
  const { count, total, toggleAll } = useSelection();

  // some-but-not-all is a third state, and it is the one that says "there is a
  // selection you cannot see from here" once the list is scrolled.
  //
  // `indeterminate` is a dom property with no attribute behind it, so react
  // cannot set it from jsx. A ref callback is the way to reach it: it runs
  // after commit, unlike touching ref.current during render, which react will
  // rightly refuse.
  const some = count > 0 && count < total;

  return (
    <span className="flex w-6 shrink-0 items-center">
      <input
        ref={(el) => {
          if (el) el.indeterminate = some;
        }}
        type="checkbox"
        checked={total > 0 && count === total}
        onChange={toggleAll}
        aria-label={count === total ? "Clear selection" : "Select every post here"}
        className={box}
      />
    </span>
  );
}

export function RowCheck({ cutKey, index }: { cutKey: string; index: number }) {
  const { selected, toggle } = useSelection();

  return (
    <span className="flex w-6 shrink-0 items-center">
      <input
        type="checkbox"
        checked={selected.has(cutKey)}
        // onClick carries the modifier; onChange does not, and react needs the
        // change handler present for a controlled box.
        onClick={(e) => toggle(cutKey, index, e.shiftKey)}
        onChange={() => undefined}
        aria-label="Select this post"
        className={box}
      />
    </span>
  );
}

/* --------------------------------------------------------------- the bar */

function BulkBar({
  dealId,
  videoIds,
  cuts,
  onClear,
}: {
  dealId: string;
  videoIds: string[];
  cuts: number;
  onClear: () => void;
}) {
  const [state, action, pending] = useActionState(setPostPayment, {});

  // drop the selection once the write lands, so the bar does not sit over rows
  // whose amounts it has already changed.
  //
  // Compared during render rather than in an effect, which is the pattern
  // post-payment.tsx uses for the same problem: an effect would paint the bar
  // for a frame after the save. The comparison is on the object, not on
  // `state.ok` — two identical saves in a row return the same string in a fresh
  // object, so identity is the only thing that reliably says "new answer".
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok) onClear();
  }

  if (cuts === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <form
        action={action}
        className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-card border border-line bg-ink px-3 py-2.5 text-white shadow-[0_10px_40px_rgba(0,0,0,0.28)]"
      >
        <input type="hidden" name="deal_id" value={dealId} />
        {videoIds.map((id) => (
          <input key={id} type="hidden" name="video_id" value={id} />
        ))}

        <span className="px-1.5 text-[13px] font-semibold tabular-nums">
          {cuts} selected
          {/* a cut is a row; the posts under it are what actually get written,
              and the two differ the moment a crosspost is in the selection. */}
          {videoIds.length !== cuts ? (
            <span className="font-normal text-white/60"> · {videoIds.length} posts</span>
          ) : null}
        </span>

        <span className="flex items-center gap-1.5 rounded-pill bg-white/10 px-2 py-1">
          <span className="text-[13px] text-white/60">$</span>
          <input
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Payment for the selected posts"
            className="w-[72px] bg-transparent text-[13px] tabular-nums outline-none placeholder:text-white/35"
          />
        </span>

        <button
          type="submit"
          disabled={pending}
          className="rounded-pill bg-flame px-3 py-1.5 text-[12.5px] font-bold disabled:opacity-50"
        >
          {pending ? "Saving…" : "Set payment"}
        </button>

        {/* the same action. an empty amount plus ignore clears the override and
            stops the posts counting; reset puts both back. */}
        <button
          type="submit"
          name="ignore"
          value="on"
          disabled={pending}
          className="rounded-pill px-2.5 py-1.5 text-[12.5px] font-semibold text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          Ignore
        </button>
        <button
          type="submit"
          name="reset"
          value="on"
          disabled={pending}
          className="rounded-pill px-2.5 py-1.5 text-[12.5px] font-semibold text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          Reset
        </button>

        <button
          type="button"
          onClick={onClear}
          className="rounded-pill px-2 py-1.5 text-[12.5px] font-semibold text-white/50 hover:text-white"
        >
          Clear
        </button>

        {state.error ? (
          <span className="w-full px-1.5 text-[12px] text-flame">{state.error}</span>
        ) : null}
      </form>
    </div>
  );
}
