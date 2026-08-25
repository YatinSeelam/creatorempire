"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { deleteDeal } from "@/app/(dash)/deals/actions";

/**
 * The three dots at the end of a deal's row.
 *
 * The row itself is a link to the deal, so everything here is the work you would
 * otherwise open the deal to do: change it, take the table away as a file, get
 * rid of it. Three things that each cost a page load and a hunt, against one
 * press.
 *
 * Pulling fresh numbers is deliberately not among them. It is rationed to a
 * handful a month now, and a rationed action hidden one press deep in a row menu
 * is one somebody spends by accident. It lives in the page header instead, next
 * to the count of what is left.
 *
 * It is a client component for the popover alone. Every write inside it is still
 * a server action posted from a plain form, which is what keeps this consistent
 * with the rest of the product and keeps it working with javascript half loaded.
 *
 * The row it sits in is covered by an absolutely positioned link, so this has to
 * out-stack that link to be clickable at all — see the z-index on the wrapper.
 */
export function DealMenu({
  dealId,
  brand,
  /**
   * Open upward. The last rows of a long table would otherwise drop a menu off
   * the bottom of the card, and the panel around it cannot clip its way out of
   * that. Decided by position in the list rather than measured, because a
   * measurement needs a layout pass the server render does not have.
   */
  up = false,
}: {
  dealId: string;
  brand: string;
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // pointerdown rather than click: a click listener fires after the trigger's own
  // handler has already toggled, so pressing it while open would close and
  // reopen in the same frame.
  useEffect(() => {
    if (!open) return;

    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setArmed(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setArmed(false);
      }
    };

    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  // delete disarms itself. an armed button left sitting in a closed menu is a
  // deal one stray press from gone the next time somebody opens it.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  // every path that closes the menu also disarms delete, so an armed button
  // never survives into the next open.
  const close = () => {
    setOpen(false);
    setArmed(false);
  };

  return (
    /* the open row has to out-stack the rows BELOW it, not just the link over
       its own row. every menu wrapper used to sit at a flat z-20, and equal
       z-indexes paint in dom order — so row two's and row three's three-dots
       punched straight through row one's open menu. */
    <div ref={box} className={`relative shrink-0 ${open ? "z-50" : "z-20"}`}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${brand}`}
        className={`flex size-8 items-center justify-center rounded-lg text-ink-50 transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/45 ${
          open ? "bg-paper text-ink" : ""
        }`}
      >
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
          <g fill="currentColor">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </g>
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute right-0 z-50 w-[208px] rounded-[14px] bg-paper p-1.5 text-left ring-1 ring-line shadow-[0_12px_32px_rgb(64_48_38/0.14),0_2px_6px_rgb(64_48_38/0.07)] ${
            up ? "bottom-[38px]" : "top-[38px]"
          }`}
        >
          <MenuLink href={`/deals/${dealId}`} onDone={close} icon={<OpenIcon />}>
            Open deal
          </MenuLink>
          <MenuLink href={`/deals/${dealId}/edit`} onDone={close} icon={<EditIcon />}>
            Edit deal
          </MenuLink>

          {/* a real navigation, not a fetch: the browser's own download is what
              turns a text/csv response into a file, and it survives the menu
              closing under it. */}
          <a
            href={`/deals/${dealId}/export`}
            role="menuitem"
            onClick={close}
            className={item}
            download
          >
            <ExportIcon />
            Export CSV
          </a>

          {/* two presses, because this cascades through every account, rule,
              video and snapshot the deal owns and there is no undo behind it. */}
          <form action={deleteDeal} className="mt-1.5 border-t border-line pt-1.5">
            <input type="hidden" name="deal_id" value={dealId} />
            <button
              type={armed ? "submit" : "button"}
              role="menuitem"
              onClick={() => setArmed(true)}
              className={`${item} w-full text-flame hover:bg-ember hover:text-flame-dark`}
            >
              <TrashIcon />
              {armed ? "Press again to delete" : "Delete deal"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/* the hover is a rounded pill inset from the menu's own edge rather than a
   full-bleed band. a band that touches a 14px corner radius has to square its
   own corners off against it, which is what made this read as a list of table
   rows somebody had floated. */
const item =
  "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-semibold text-ink-70 transition-colors hover:bg-shell hover:text-ink";

function MenuLink({
  href,
  icon,
  onDone,
  children,
}: {
  href: string;
  icon: ReactNode;
  onDone: () => void;
  children: ReactNode;
}) {
  return (
    <Link href={href} role="menuitem" onClick={onDone} className={item}>
      {icon}
      {children}
    </Link>
  );
}

const glyph = {
  viewBox: "0 0 24 24",
  className: "size-4 shrink-0",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function OpenIcon() {
  return (
    <svg {...glyph} aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg {...glyph} aria-hidden="true">
      <path d="M4 20h4l10-10a2.4 2.4 0 0 0-3.4-3.4L4.6 16.6V20ZM13.5 7.5l3 3" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg {...glyph} aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...glyph} aria-hidden="true">
      <path d="M4.5 7h15M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1l.8-12" />
    </svg>
  );
}
