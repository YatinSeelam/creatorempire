/**
 * Flow's face.
 *
 * Drawn from `public/flow.png`, the solid glowing render, rather than used as
 * that file. Three reasons the raster does not go on the button: it is a white
 * mark on an opaque black plate, so it cannot sit on an orange circle at all; it
 * is a megabyte for something rendered at 20 pixels; and the rail's other icons
 * are 1.7px outlines, so a solid raster head would be the one item in the column
 * that came from somewhere else. Redrawn, it inherits `currentColor` and turns
 * white on the accent, ink on the rail, flame on an empty state, for free.
 *
 * The proportions are measured off that render rather than eyeballed: head 16
 * wide by 12 tall, eyes at 54% of the head's height and 39% of its width apart,
 * the antenna leaving the top just left of centre and hooking right into a
 * filled ball. What is missing on purpose is the visor. In the render it is a
 * 12x7 panel inside a 16x12 head, which as a second outline leaves two units of
 * gap — a pixel and a half at 16px, where it stops being a visor and becomes a
 * smudge. The eyes and the smile sit where it was and carry the same face.
 *
 * Not a client component and holding no state, so both the rail (a server
 * render) and the flow panel (a client one) can use the same drawing.
 */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * The paths alone, for a parent that already sets the stroke — the side rail
 * wraps every one of its glyphs in one shared `<g>`, and an icon that brought
 * its own would be the row that did not match on a hover.
 *
 * The three filled circles say `stroke="none"` for that reason: they are the
 * only marks here that are solid, and inheriting the parent's stroke would grow
 * each of them by a whole stroke width.
 */
export const FLOW_GLYPH = (
  <>
    {/* the head. rx 3.8 rather than a full squircle so the sides keep a
        straight run for the ears to meet. */}
    <rect x="4" y="8" width="16" height="12" rx="3.8" />
    {/* ear cups, one per side */}
    <path d="M4 12.1a1.9 1.9 0 0 0 0 3.8M20 12.1a1.9 1.9 0 0 1 0 3.8" />
    {/* the antenna. leaves the head vertically and hooks right, which is the
        one asymmetric thing about the mark and the reason it reads as a
        character rather than a box. */}
    <path d="M11.8 8c0-2.4.6-3.8 3.3-4.1" />
    <circle cx="17" cy="3.9" r="1.9" fill="currentColor" stroke="none" />
    {/* eyes and a small smile */}
    <circle cx="9" cy="14.4" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="15" cy="14.4" r="1.05" fill="currentColor" stroke="none" />
    <path d="M10.7 16.4c.45 1.15 2.15 1.15 2.6 0" />
  </>
);

/** The same drawing as a standalone icon, for anywhere outside the rail. */
export function FlowMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true">
      <g {...stroke}>{FLOW_GLYPH}</g>
    </svg>
  );
}

/**
 * The real render, big, for the one place it is the hero: an empty chat.
 *
 * At 100px the redrawn 24px glyph above starts to show that it is a redrawing —
 * the visor it leaves out is missing at a size where it would have been the
 * whole face. So this uses the render itself, `public/flow/flow-face.png`, which
 * is `flow-dark.png` cropped to the mark and scaled down (900kb of 1536x1024 for
 * something drawn at 104px was never going to ship). It is cut from the dark
 * render rather than either orange one because that file's alpha is a clean
 * edge: the orange pair carry a soft glow, and a glow in a mask masks a glow.
 *
 * It goes on as a **mask**, not an `<img>`. The file is a near-black mark on
 * transparency, which on this warm paper would be a black robot; masked, the
 * background paints through it, so it inherits `currentColor` exactly like the
 * glyph does and turns flame here without a second orange asset to keep in step
 * with the accent. A white-label org changing the brand colour changes this too.
 *
 * The aspect ratio is the crop's, so `contain` fills the box and the caller only
 * ever sets a width.
 */
/**
 * The render itself, in colour, for the two places flow introduces itself.
 *
 * `FlowFace` above is a mask and therefore one flat colour: it is the right
 * thing at 20px in the rail, and at 90px on an empty chat it throws away the
 * part of the render that makes it a character — the glow, and the visor being
 * a shade off the head. So the hero and the panel greeting draw the real file.
 *
 * Two tones, both cropped off the 1536x1024 originals in `public/flow` and
 * scaled to 560px wide: `dark` is the saturated render (#f4521f) for the page,
 * `light` the pale one (#fed3b7) for the panel. The originals stay in the folder
 * as the source; they are a megabyte each and never ship to a browser.
 *
 * The alpha carries the glow, so these go on as an `<img>` and not as a mask. A
 * mask would flatten the glow into the fill and give back exactly the thing
 * `FlowFace` already is.
 */
export function FlowRender({
  tone = "dark",
  className = "w-24",
}: {
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tone === "light" ? "/flow/flow-mark-light.png" : "/flow/flow-mark-dark.png"}
      alt="Flow"
      width={560}
      height={tone === "light" ? 444 : 436}
      className={`block h-auto shrink-0 ${className}`}
    />
  );
}

export function FlowFace({ className = "w-24" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Flow"
      className={`block shrink-0 aspect-[996/911] bg-current ${className}`}
      style={{
        WebkitMaskImage: "url(/flow/flow-face.png)",
        maskImage: "url(/flow/flow-face.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
