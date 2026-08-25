import { startViewAs, stopViewAs } from "@/app/(dash)/founder/actions";

/**
 * The two faces of "view as". Both are plain server-component forms posting to
 * the actions in app/(dash)/founder/actions.ts, so neither ships any client js.
 */

/** Small secondary button for the admin person page: swap into their session. */
export function ViewAsButton({ userId, name }: { userId: string; name: string }) {
  const first = name.trim().split(/\s+/)[0] || name;

  return (
    <form action={startViewAs}>
      <input type="hidden" name="user_id" value={userId} />
      <button
        type="submit"
        className="h-9 shrink-0 rounded-pill border border-line px-4 text-[13px] font-semibold text-ink-50 transition-colors hover:text-ink"
      >
        view as {first}
      </button>
    </form>
  );
}

/**
 * The bar that makes an impersonated session impossible to mistake for a real
 * one. Fixed over everything, flame all the way across, one exit. It renders
 * from the (dash) layout whenever the ugcf_viewas cookie is present.
 */
export function ViewAsBanner({ name }: { name: string }) {
  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-flame px-4 py-1.5 text-white shadow-card">
      <p className="min-w-0 truncate text-[13px] font-semibold">
        you are viewing as {name}
      </p>
      <form action={stopViewAs} className="shrink-0">
        <button
          type="submit"
          className="rounded-pill bg-white/20 px-3 py-1 text-[12px] font-bold transition-colors hover:bg-white/30"
        >
          exit
        </button>
      </form>
    </div>
  );
}
