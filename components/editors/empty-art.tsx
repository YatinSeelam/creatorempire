import Image from "next/image";

/**
 * The drawings an editor sees when a list has nothing in it yet.
 *
 * A real asset in /public rather than inline svg: this one is a soft-shaded
 * render with gradients and blurred shapes, which is not something the flat
 * two-tint stroke language in art.tsx can draw. It sits on a white card and the
 * png carries its own transparency, so nothing behind it needs a matching fill.
 *
 * Not `priority`: they only ever appear in an empty state, which is the one
 * screen where nothing is waiting on them.
 */
function Art({
  src,
  alt,
  className,
  width = 1448,
  height = 1086,
  size = "h-[clamp(120px,19vh,190px)] w-auto",
  sizes = "(min-width: 640px) 320px, 240px",
}: {
  src: string;
  alt: string;
  className: string;
  /** the file's own pixels. a wrong ratio here is a layout shift on load. */
  width?: number;
  height?: number;
  /**
   * Capped by HEIGHT, not width. These panes fill the viewport and must never
   * scroll inside themselves, and a width-sized drawing grows tall enough to
   * shove its own heading and button off the bottom. A slice of the viewport
   * leaves room for the words no matter how short the window is, and the width
   * just follows the file's own ratio.
   */
  size?: string;
  /** a rough drawn width for source picking. the height class is the real cap. */
  sizes?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      className={`max-w-full object-contain ${size} ${className}`}
    />
  );
}

/** An editor's own desk with no work on it. */
export function EmptyJobsArt({ className = "" }: { className?: string }) {
  return <Art src="/editorsjob.png" alt="" className={className} />;
}

/**
 * The board with nothing posted on it. A different drawing from the desk's on
 * purpose: those two empty states mean different things (nobody has posted vs
 * you have not claimed) and one picture for both reads as the same dead end
 * twice.
 */
export function EmptyBoardArt({ className = "" }: { className?: string }) {
  return <Art src="/jobposts.png" alt="" className={className} />;
}

/** A ledger with nothing in it yet. */
export function EmptyMoneyArt({ className = "" }: { className?: string }) {
  return (
    <Art
      src="/payout.png"
      alt=""
      width={1536}
      height={1024}
      /* a wider file than the other two, so a touch shorter: at the same height
         it would eat more of the row and crowd the caption beside it. */
      size="h-[clamp(110px,17vh,175px)] w-auto"
      sizes="(min-width: 640px) 320px, 240px"
      className={className}
    />
  );
}
