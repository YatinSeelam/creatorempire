/**
 * A creator's picture, or their initial. Same fallback as the rail's avatar.
 *
 * Shared by the roster and the seats list rather than defined next to one of
 * them, because the two screens sit one click apart and a person whose face
 * changed size between them would read as two different people.
 */
export function Face({
  name,
  src,
  className = "size-9",
}: {
  name: string;
  src: string | null;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        className={`${className} shrink-0 rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-shell text-[13px] font-extrabold text-ink-50`}
    >
      {(name.trim() || "?").charAt(0).toUpperCase()}
    </span>
  );
}
