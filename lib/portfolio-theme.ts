import type { PortfolioTheme, SurfaceKey } from "./portfolio-schema";

/**
 * One template, three surfaces, any accent.
 *
 * The public page and the editor's preview render the exact same component, so
 * neither of them may hardcode a colour — every one they use comes out of here
 * as a CSS variable on a wrapper element. That is also why this returns a plain
 * style object rather than Tailwind classes: an accent is a hex a creator
 * picked, and Tailwind cannot compile a class it has never seen.
 */

type Surface = {
  /** the page behind everything */
  bg: string;
  /** cards and panels sitting on it */
  panel: string;
  /** a shade of panel, for thumbnails and empty slots */
  well: string;
  text: string;
  muted: string;
  line: string;
};

const SURFACE: Record<SurfaceKey, Surface> = {
  paper: {
    bg: "#ffffff",
    panel: "#faf9f7",
    well: "#f2efea",
    text: "#101010",
    muted: "#6b6862",
    line: "#e4e0d9",
  },
  sand: {
    bg: "#f6f4f1",
    panel: "#ffffff",
    well: "#efeae2",
    text: "#16130f",
    muted: "#6b6862",
    line: "#e3ded5",
  },
  ink: {
    bg: "#0e0e0e",
    panel: "#181818",
    well: "#232323",
    text: "#f5f3f0",
    muted: "#a09d97",
    line: "#2b2a28",
  },
};

/** Black or white, whichever stays readable on the accent. Relative luminance
 *  rather than a naive average — a saturated green and a saturated blue at the
 *  same average brightness need opposite answers. */
export function onAccent(hex: string) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#101010" : "#ffffff";
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

/** The accent at an opacity, as an rgb() string. For the tint behind pills and
 *  the glow under the button, which have to sit on any surface. */
export function accentTint(hex: string, alpha: number) {
  const [r, g, b] = rgb(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/**
 * The CSS variables the template draws itself with. Spread onto the wrapper's
 * `style`, and every child reads `var(--pf-*)`.
 */
export function themeVars(theme: PortfolioTheme): React.CSSProperties {
  const s = SURFACE[theme.surface] ?? SURFACE.paper;
  const dark = theme.surface === "ink";

  return {
    "--pf-bg": s.bg,
    "--pf-panel": s.panel,
    "--pf-well": s.well,
    "--pf-text": s.text,
    "--pf-muted": s.muted,
    "--pf-line": s.line,
    "--pf-accent": theme.accent,
    "--pf-on-accent": onAccent(theme.accent),
    // a wash of the accent, strong enough to read as a tint on white and not
    // to disappear on black
    "--pf-accent-soft": accentTint(theme.accent, dark ? 0.18 : 0.1),
    "--pf-accent-line": accentTint(theme.accent, dark ? 0.4 : 0.28),
    "--pf-shadow": dark ? "rgb(0 0 0 / 0.5)" : "rgb(16 16 16 / 0.12)",
    "--pf-font": `var(--pf-font-${theme.font})`,
    fontFamily: "var(--pf-font)",
    background: "var(--pf-bg)",
    color: "var(--pf-text)",
  } as React.CSSProperties;
}
