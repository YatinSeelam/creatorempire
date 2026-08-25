/**
 * How a text hook is drawn. Pure, no imports, no server bits: the style editor
 * runs this in the browser to paint the preview and the render worker runs the
 * same numbers on a canvas to burn the PNG that ffmpeg overlays.
 *
 * That sharing is the whole point. Two copies of "how big is the text and
 * where does it sit" is how a preview and a render quietly stop agreeing, and
 * the only way anyone finds out is by watching the finished video.
 *
 * Positions are fractions of the frame, never pixels, so the 1080x1920 burn
 * and a 260px-wide preview place the text identically.
 */

export type TextHookStyleVariant = "classic" | "outline" | "background";

export type TextHookStyle = {
  variant: TextHookStyleVariant;
  /** the pill colour on `background`, the text fill on the other two */
  color: string;
  /** outline stroke override. absent = auto contrast against the fill */
  outlineColor?: string;
  /** font size as a fraction of the frame WIDTH */
  sizePct: number;
  /** 0-1 horizontal centre of the text block */
  xPct: number;
  /** 0-1 top of the first line */
  yPct: number;
  /** one of TEXT_HOOK_FONTS. absent = the default tiktok stack */
  fontFamily?: string;
  /** outer glow colour. absent = no glow */
  glowColor?: string;
  /** soft drop shadow, on or off */
  shadow?: boolean;
};

/** tiktok sans is what tiktok's own overlays use. montserrat is the fallback
 *  while the file loads, and the stack that catches missing glyphs. */
export const TEXT_HOOK_FONT_STACK =
  '"TikTok Sans", "Montserrat", system-ui, sans-serif';
export const TEXT_HOOK_FONT_WEIGHT = 700;

/** the pickable faces. `family` is exactly the name the worker registers on
 *  the canvas, `file` lives in /public/fonts and feeds both the browser
 *  @font-face and the server canvas. one file, so the preview cannot drift. */
export type TextHookFontChoice = { family: string; label: string; file: string };

export const TEXT_HOOK_FONTS: TextHookFontChoice[] = [
  { family: "TikTok Sans", label: "tiktok sans", file: "TikTokSans-Bold.ttf" },
  { family: "Source Sans 3", label: "capcut", file: "SourceSans3-Bold.ttf" },
  {
    family: "Source Sans 3 SemiBold",
    label: "capcut light",
    file: "SourceSans3-Semibold.ttf",
  },
  { family: "Montserrat", label: "montserrat", file: "Montserrat-ExtraBold.ttf" },
  { family: "Inter", label: "iphone", file: "Inter-Bold.ttf" },
  { family: "Poppins", label: "poppins", file: "Poppins-Bold.ttf" },
  { family: "Anton", label: "bold", file: "Anton-Regular.ttf" },
  { family: "Courier Prime", label: "typewriter", file: "CourierPrime-Bold.ttf" },
  {
    family: "Permanent Marker",
    label: "marker",
    file: "PermanentMarker-Regular.ttf",
  },
  { family: "DM Serif Display", label: "serif", file: "DMSerifDisplay-Regular.ttf" },
  { family: "Luckiest Guy", label: "comic", file: "LuckiestGuy-Regular.ttf" },
];

export function isTextHookFontFamily(family: unknown): family is string {
  return (
    typeof family === "string" && TEXT_HOOK_FONTS.some((f) => f.family === family)
  );
}

/** css/canvas stack for a picked family. the pick leads, the default stack
 *  trails, so a missing glyph degrades instead of drawing a box. */
export function textHookFontStack(family?: string | null): string {
  if (!family || family === "TikTok Sans" || !isTextHookFontFamily(family)) {
    return TEXT_HOOK_FONT_STACK;
  }
  return `"${family}", ${TEXT_HOOK_FONT_STACK}`;
}

/** the swatch row. tiktok's own seven first, then vivids, pastels, neutrals. */
export const TEXT_HOOK_COLORS = [
  "#FFFFFF",
  "#0A0A0A",
  "#FE2C55",
  "#25F4EE",
  "#FACC15",
  "#F472B6",
  "#4ADE80",
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#FDE047",
  "#A3E635",
  "#22C55E",
  "#10B981",
  "#14B8A6",
  "#06B6D4",
  "#0EA5E9",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#A855F7",
  "#D946EF",
  "#EC4899",
  "#FB7185",
  "#FECACA",
  "#FDBA74",
  "#FEF3C7",
  "#D9F99D",
  "#A7F3D0",
  "#BAE6FD",
  "#C7D2FE",
  "#E9D5FF",
  "#FBCFE8",
  "#E5E7EB",
  "#94A3B8",
  "#475569",
] as const;

export const TEXT_STYLE_DEFAULTS: TextHookStyle = {
  variant: "outline",
  color: "#FFFFFF",
  sizePct: 0.045,
  xPct: 0.5,
  yPct: 0.12,
};

export const TEXT_STYLE_SIZE_MIN = 0.03;
export const TEXT_STYLE_SIZE_MAX = 0.12;

const VARIANTS: TextHookStyleVariant[] = ["classic", "outline", "background"];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Read a raw text_style (jsonb off the row, or whatever the client posted) and
 * clamp it into something drawable. Anything unparseable comes back as the
 * defaults rather than null, because every caller here needs a style to draw
 * with and "null means legacy" is a rule this product never had to inherit.
 */
export function normalizeTextStyle(raw: unknown): TextHookStyle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...TEXT_STYLE_DEFAULTS };
  }
  const obj = raw as Record<string, unknown>;
  const variant = VARIANTS.includes(obj.variant as TextHookStyleVariant)
    ? (obj.variant as TextHookStyleVariant)
    : TEXT_STYLE_DEFAULTS.variant;
  const color =
    typeof obj.color === "string" && HEX_COLOR.test(obj.color)
      ? obj.color.toUpperCase()
      : TEXT_STYLE_DEFAULTS.color;

  return {
    variant,
    color,
    ...(typeof obj.outlineColor === "string" && HEX_COLOR.test(obj.outlineColor)
      ? { outlineColor: obj.outlineColor.toUpperCase() }
      : {}),
    sizePct: clampNumber(
      obj.sizePct,
      TEXT_STYLE_SIZE_MIN,
      TEXT_STYLE_SIZE_MAX,
      TEXT_STYLE_DEFAULTS.sizePct
    ),
    xPct: clampNumber(obj.xPct, 0, 1, TEXT_STYLE_DEFAULTS.xPct),
    yPct: clampNumber(obj.yPct, 0, 1, TEXT_STYLE_DEFAULTS.yPct),
    ...(isTextHookFontFamily(obj.fontFamily) ? { fontFamily: obj.fontFamily } : {}),
    ...(typeof obj.glowColor === "string" && HEX_COLOR.test(obj.glowColor)
      ? { glowColor: obj.glowColor.toUpperCase() }
      : {}),
    ...(obj.shadow === true ? { shadow: true } : {}),
  };
}

/* ── effects ───────────────────────────────────────────────────────────────
 * fractions of the font size, so the preview's css drop-shadow and the burn's
 * canvas shadow passes describe the same shape at two different scales. */

export const TEXT_HOOK_GLOW_BLUR = 0.18;
export const TEXT_HOOK_GLOW_PASSES = 2;
export const TEXT_HOOK_SHADOW_BLUR = 0.1;
export const TEXT_HOOK_SHADOW_OFFSET = 0.06;
export const TEXT_HOOK_SHADOW_COLOR = "rgba(10,10,10,0.65)";

/** the css `filter` mirror of the burn's shadow passes. "" = no effects. */
export function textHookEffectFilter(
  style: TextHookStyle | null,
  fontPx: number
): string {
  if (!style) return "";
  const parts: string[] = [];
  if (style.glowColor) {
    const r = Math.max(1, fontPx * TEXT_HOOK_GLOW_BLUR);
    for (let i = 0; i < TEXT_HOOK_GLOW_PASSES; i += 1) {
      parts.push(`drop-shadow(0 0 ${r.toFixed(1)}px ${style.glowColor})`);
    }
  }
  if (style.shadow) {
    const o = Math.max(1, fontPx * TEXT_HOOK_SHADOW_OFFSET);
    const b = Math.max(1, fontPx * TEXT_HOOK_SHADOW_BLUR);
    parts.push(
      `drop-shadow(${o.toFixed(1)}px ${o.toFixed(1)}px ${b.toFixed(1)}px ${TEXT_HOOK_SHADOW_COLOR})`
    );
  }
  return parts.join(" ");
}

/* ── colour ─────────────────────────────────────────────────────────────── */

export function textHookFillColor(style: TextHookStyle | null): string {
  const c = style?.color;
  return typeof c === "string" && HEX_COLOR.test(c) ? c.toUpperCase() : "#FFFFFF";
}

/** black or white against a background, by luminance. what decides the text
 *  colour inside a coloured pill and the auto outline. */
export function textOnColor(bg: string): "#0A0A0A" | "#FFFFFF" {
  const n = parseInt(bg.slice(1), 16);
  const lum =
    0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#0A0A0A" : "#FFFFFF";
}

/** the outline variant's stroke: the picked override, else contrast the fill,
 *  so white text keeps its black edge and dark text gets a white one. */
export function textHookOutlineColor(style: TextHookStyle | null): string {
  const c = style?.outlineColor;
  if (typeof c === "string" && HEX_COLOR.test(c)) return c.toUpperCase();
  return textOnColor(textHookFillColor(style));
}

/* ── metrics ────────────────────────────────────────────────────────────────
 * measured against real tiktok overlays. the preview and the burn both read
 * these, which is what makes the two surfaces identical. */

/** bubble side padding, as a fraction of font size */
export const TEXT_HOOK_PAD_X = 0.45;
/** bubble corner radius, as a fraction of font size */
export const TEXT_HOOK_RADIUS = 0.4;
/** outline stroke width as a fraction of font size. the stroke is centred on
 *  the glyph edge and the fill paints over its inner half, so the visible
 *  outline is half this. */
export const TEXT_HOOK_STROKE_W = 0.15;

export function textHookLineHeight(variant: TextHookStyleVariant): number {
  return variant === "background" ? 1.3 : 1.2;
}

/** vertical step between lines, rounded so the dom and the canvas stack the
 *  same way. */
export function textHookLineStep(
  fontSize: number,
  variant: TextHookStyleVariant = "classic"
): number {
  return Math.round(textHookLineHeight(variant) * fontSize);
}

/**
 * Where to break. Deliberately size independent: dragging the size slider must
 * never re-paragraph the text, because line breaks belong to whoever typed it.
 * Everything wraps as if at the default size and bigger text just scales those
 * same lines, with the preview showing any overflow honestly.
 */
export function textHookWrapChars(): number {
  const usableFrameFraction = 0.94; // 1 minus two 24px margins at 1080 wide
  const avgGlyphEm = 0.48;
  return Math.max(
    6,
    Math.min(
      60,
      Math.floor(usableFrameFraction / (avgGlyphEm * TEXT_STYLE_DEFAULTS.sizePct))
    )
  );
}

/**
 * Split a hook into lines. Manual newlines are hard breaks so the author owns
 * the paragraphing; inside a segment it is greedy word wrap, and a word longer
 * than a whole line gets cut so nothing can overflow the frame.
 */
export function wrapTextHook(text: string, maxChars = textHookWrapChars()): string[] {
  return text.split("\n").flatMap((segment) => wrapSegment(segment, maxChars));
}

function wrapSegment(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      let rest = word;
      while (rest.length > maxChars) {
        lines.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
      current = rest;
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Left edge of a text block of width `blockW`, centred on xPct and clamped to
 * a margin. min() caps the right edge first, max() then enforces the left one
 * and wins when the block is wider than the frame.
 */
export function overlayBlockX(
  blockW: number,
  videoW: number,
  xPct: number,
  margin = 24
): number {
  return Math.round(
    Math.max(Math.min(videoW * xPct - blockW / 2, videoW - blockW - margin), margin)
  );
}

/** the vertical mate. yPct is the block TOP, clamped the same way, which is
 *  what makes the alignment buttons land flush instead of cropping. */
export function overlayBlockY(
  blockH: number,
  videoH: number,
  yPct: number,
  margin = 24
): number {
  return Math.round(
    Math.max(Math.min(videoH * yPct, videoH - blockH - margin), margin)
  );
}

/**
 * The path for one merged caption bubble, the native tiktok background shape.
 * `widths` are the padded line widths, centred on cx, each `lh` tall. Outer
 * corners round outward; where the width steps between lines the joint rounds
 * concavely into the wider line, and that seamless merge is the thing that
 * makes it read as tiktok rather than as stacked rectangles.
 *
 * One string feeds the preview's <svg> and the canvas Path2D, so the two
 * cannot draw different shapes.
 */
export function bubblePathD(widths: number[], lh: number, r: number): string {
  const n = widths.length;
  const maxW = Math.max(...widths);
  const cx = maxW / 2;
  const right = (i: number) => cx + widths[i] / 2;
  const left = (i: number) => cx - widths[i] / 2;
  const cr = (i: number) => Math.min(r, widths[i] / 2, lh / 2);
  const jr = (a: number, b: number) => Math.min(r, Math.abs(a - b) / 2, lh / 2);

  let d = `M ${right(0) - cr(0)} 0`;
  d += ` Q ${right(0)} 0 ${right(0)} ${cr(0)}`;

  for (let i = 0; i < n - 1; i += 1) {
    const y = (i + 1) * lh;
    const a = right(i);
    const b = right(i + 1);
    if (Math.abs(b - a) < 0.5) continue;
    const rj = jr(a, b);
    if (b > a) {
      d += ` L ${a} ${y - rj} Q ${a} ${y} ${a + rj} ${y}`;
      d += ` L ${b - rj} ${y} Q ${b} ${y} ${b} ${y + rj}`;
    } else {
      d += ` L ${a} ${y - rj} Q ${a} ${y} ${a - rj} ${y}`;
      d += ` L ${b + rj} ${y} Q ${b} ${y} ${b} ${y + rj}`;
    }
  }

  const H = n * lh;
  const rl = cr(n - 1);
  d += ` L ${right(n - 1)} ${H - rl} Q ${right(n - 1)} ${H} ${right(n - 1) - rl} ${H}`;
  d += ` L ${left(n - 1) + rl} ${H} Q ${left(n - 1)} ${H} ${left(n - 1)} ${H - rl}`;

  for (let i = n - 2; i >= 0; i -= 1) {
    const y = (i + 1) * lh;
    const a = left(i + 1);
    const b = left(i);
    if (Math.abs(b - a) < 0.5) continue;
    const rj = jr(a, b);
    if (b < a) {
      d += ` L ${a} ${y + rj} Q ${a} ${y} ${a - rj} ${y}`;
      d += ` L ${b + rj} ${y} Q ${b} ${y} ${b} ${y - rj}`;
    } else {
      d += ` L ${a} ${y + rj} Q ${a} ${y} ${a + rj} ${y}`;
      d += ` L ${b - rj} ${y} Q ${b} ${y} ${b} ${y - rj}`;
    }
  }

  const r0 = cr(0);
  d += ` L ${left(0)} ${r0} Q ${left(0)} 0 ${left(0) + r0} 0 Z`;
  return d;
}
