"use client";

/**
 * The dashboard's error boundary.
 *
 * It exists for one specific failure. `requireViewer()` used to send every
 * unreadable entitlement to /account?denied=1, which told a creator who holds a
 * grant that their account was never on a plan, and then left them no way back:
 * that page has no link to the dashboard for anyone who is not staff. It throws
 * now instead, and this is where that lands.
 *
 * The copy does not branch on which error it was. Next strips server error
 * messages before they reach the browser in production, so the branch would be
 * dead in the only place it matters. One sentence that is true of both a failed
 * access read and any other server throw is worth more than a lie about which.
 */
export default function DashError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-[440px] rounded-card border border-line bg-paper p-6 text-center">
        <h1 className="text-[19px] font-extrabold tracking-[-0.02em]">
          That did not load
        </h1>
        <p className="mt-2 text-[14px] leading-[1.55] text-ink-50">
          This is on us, not on your account. Nothing about your plan or your
          work has changed. Try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 w-full rounded-pill bg-flame px-5 py-3 text-[15px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
        >
          Try again
        </button>
        {error.digest && (
          <p className="mt-3 text-[11.5px] text-ink-50">{error.digest}</p>
        )}
      </div>
    </div>
  );
}
