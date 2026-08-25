/**
 * Draws a text hook to a transparent PNG for ffmpeg to overlay.
 *
 * The same drawing the style editor previews in the browser: same font, same
 * three variants, same merged bubble, same metrics out of ./style. Handing
 * ffmpeg a finished PNG instead of using drawtext is what keeps the edges
 * clean, because drawtext's own borders get chewed by h264 quantisation and
 * come out grainy.
 *
 * Only ever imported from the render worker, which runs on the node runtime.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import {
  TEXT_HOOK_FONTS,
  TEXT_HOOK_FONT_WEIGHT,
  TEXT_HOOK_GLOW_BLUR,
  TEXT_HOOK_GLOW_PASSES,
  TEXT_HOOK_PAD_X,
  TEXT_HOOK_RADIUS,
  TEXT_HOOK_SHADOW_BLUR,
  TEXT_HOOK_SHADOW_COLOR,
  TEXT_HOOK_SHADOW_OFFSET,
  TEXT_HOOK_STROKE_W,
  bubblePathD,
  isTextHookFontFamily,
  overlayBlockX,
  overlayBlockY,
  textHookFillColor,
  textHookLineStep,
  textHookOutlineColor,
  textOnColor,
  wrapTextHook,
  type TextHookStyle,
} from "./style";

/** draw big, downscale once. the thick round stroke still stair-stepped at 2x
 *  once h264 had been at it. */
const SCALE = 4;

const FONT_DIR = path.join(process.cwd(), "public", "fonts");
const TIKTOK_FONT = path.join(FONT_DIR, "TikTokSans-Bold.ttf");
// the serverless canvas has no system fonts at all, so without a bundled emoji
// face every emoji in a hook draws as nothing.
const EMOJI_FONT = path.join(FONT_DIR, "NotoColorEmoji.ttf");
const FONT_FAMILY = '"TikTok Sans", "Montserrat", "Noto Color Emoji", sans-serif';

export type TextHookOverlay = {
  /** png bytes, transparent background */
  buffer: Buffer;
  /** png size at 1x, already downscaled */
  width: number;
  height: number;
  /** where the png's top left corner goes on the frame, in pixels */
  x: number;
  y: number;
};

type CanvasModule = typeof import("@napi-rs/canvas");

let fontsRegistered = false;

function registerFonts(mod: CanvasModule): void {
  if (fontsRegistered) return;
  if (!existsSync(TIKTOK_FONT)) {
    throw new Error(`caption font missing at ${TIKTOK_FONT}`);
  }
  if (!mod.GlobalFonts.registerFromPath(TIKTOK_FONT, "TikTok Sans")) {
    throw new Error("could not register TikTok Sans");
  }
  // every pickable family ships its ttf, so adding a font is one entry in
  // TEXT_HOOK_FONTS plus a file. best effort: a missing file falls down the
  // stack instead of failing renders.
  for (const f of TEXT_HOOK_FONTS) {
    if (f.family === "TikTok Sans") continue;
    const p = path.join(FONT_DIR, f.file);
    if (existsSync(p)) mod.GlobalFonts.registerFromPath(p, f.family);
  }
  if (existsSync(EMOJI_FONT)) {
    mod.GlobalFonts.registerFromPath(EMOJI_FONT, "Noto Color Emoji");
  }
  fontsRegistered = true;
}

/**
 * Render a hook to a PNG and say where it sits.
 *
 * Layout mirrors the preview exactly: the text wraps at the same character
 * budget, x centres the block on xPct with 24px minimum margins, and yPct is
 * the TOP of the block. Throws on anything it cannot draw, and the caller
 * fails that one render rather than the run.
 */
export async function renderTextHookPng(
  text: string,
  style: TextHookStyle,
  videoW = 1080,
  videoH = 1920
): Promise<TextHookOverlay> {
  // dynamic import so a broken native binding is a per-render error instead of
  // a module that refuses to load.
  const mod: CanvasModule = await import("@napi-rs/canvas");
  registerFonts(mod);

  const fontSize = Math.round(style.sizePct * videoW);
  const lh = textHookLineStep(fontSize, style.variant);
  const family = isTextHookFontFamily(style.fontFamily)
    ? `"${style.fontFamily}", ${FONT_FAMILY}`
    : FONT_FAMILY;
  const font = `${TEXT_HOOK_FONT_WEIGHT} ${fontSize}px ${family}`;

  const lines = wrapTextHook(text);
  if (lines.length === 0) throw new Error("text hook is empty");

  // measure at 1x. the big draw uses ctx.scale, so the numbers carry over.
  const measure = mod.createCanvas(8, 8).getContext("2d");
  measure.font = font;
  const textWidths = lines.map((l) => measure.measureText(l).width);
  const paddedWidths = textWidths.map((w) => w + 2 * TEXT_HOOK_PAD_X * fontSize);

  const isBubble = style.variant === "background";
  const contentW = Math.ceil(Math.max(...(isBubble ? paddedWidths : textWidths)));
  const contentH = lines.length * lh;

  // bleed so strokes and glows never clip. the overlay position subtracts it
  // back out, so the TEXT still lands exactly on xPct/yPct.
  const strokePad =
    style.variant === "outline" ? (TEXT_HOOK_STROKE_W * fontSize) / 2 + 2 : 2;
  const effectPad = Math.max(
    style.glowColor ? fontSize * TEXT_HOOK_GLOW_BLUR * 2 : 0,
    style.shadow
      ? fontSize * (TEXT_HOOK_SHADOW_OFFSET + TEXT_HOOK_SHADOW_BLUR * 2)
      : 0
  );
  const pad = Math.ceil(strokePad + effectPad);
  const width = contentW + 2 * pad;
  const height = contentH + 2 * pad;

  const big = mod.createCanvas(width * SCALE, height * SCALE);
  const ctx = big.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = pad + contentW / 2;

  // canvas shadow params ignore ctx.scale, so the device pixels carry the
  // multiply by hand. the geometry mirrors textHookEffectFilter, which is what
  // keeps the preview and the burn the same shape.
  const withEffects = (paint: () => void) => {
    if (style.shadow) {
      ctx.save();
      ctx.shadowColor = TEXT_HOOK_SHADOW_COLOR;
      ctx.shadowBlur = fontSize * TEXT_HOOK_SHADOW_BLUR * SCALE;
      ctx.shadowOffsetX = fontSize * TEXT_HOOK_SHADOW_OFFSET * SCALE;
      ctx.shadowOffsetY = fontSize * TEXT_HOOK_SHADOW_OFFSET * SCALE;
      paint();
      ctx.restore();
    }
    if (style.glowColor) {
      ctx.save();
      ctx.shadowColor = style.glowColor;
      ctx.shadowBlur = fontSize * TEXT_HOOK_GLOW_BLUR * SCALE;
      for (let i = 0; i < TEXT_HOOK_GLOW_PASSES; i += 1) paint();
      ctx.restore();
    }
  };

  if (isBubble) {
    const bubble = new mod.Path2D(
      bubblePathD(paddedWidths, lh, TEXT_HOOK_RADIUS * fontSize)
    );
    ctx.save();
    ctx.translate(cx - Math.max(...paddedWidths) / 2, pad);
    ctx.fillStyle = style.color;
    withEffects(() => ctx.fill(bubble));
    ctx.fill(bubble);
    ctx.restore();
    ctx.fillStyle = textOnColor(style.color);
    lines.forEach((line, i) => ctx.fillText(line, cx, pad + (i + 0.5) * lh));
  } else if (style.variant === "outline") {
    const fill = textHookFillColor(style);
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = fontSize * TEXT_HOOK_STROKE_W;
    ctx.strokeStyle = textHookOutlineColor(style);
    withEffects(() => {
      lines.forEach((line, i) => ctx.strokeText(line, cx, pad + (i + 0.5) * lh));
    });
    // stroke first, fill over it: the fill covers the inner half of the
    // centred stroke, so the visible outline is half the line width.
    lines.forEach((line, i) => {
      const cy = pad + (i + 0.5) * lh;
      ctx.strokeText(line, cx, cy);
      ctx.fillStyle = fill;
      ctx.fillText(line, cx, cy);
    });
  } else {
    const fill = textHookFillColor(style);
    ctx.fillStyle = fill;
    withEffects(() => {
      lines.forEach((line, i) => ctx.fillText(line, cx, pad + (i + 0.5) * lh));
    });
    lines.forEach((line, i) => ctx.fillText(line, cx, pad + (i + 0.5) * lh));
  }

  // the one high quality downscale. this is the anti-grain step.
  const out = mod.createCanvas(width, height);
  const octx = out.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(big, 0, 0, width * SCALE, height * SCALE, 0, 0, width, height);

  return {
    buffer: await out.encode("png"),
    width,
    height,
    x: overlayBlockX(contentW, videoW, style.xPct) - pad,
    y: overlayBlockY(contentH, videoH, style.yPct) - pad,
  };
}
