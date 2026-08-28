/**
 * Light, dark, or whatever the machine is set to.
 *
 * A COOKIE, not a column on `profiles`. Two reasons, and the first is the one
 * that matters: the shell has to render in the right colours on the very first
 * paint, and the only thing a server component can read before it renders is
 * the request. A row in the database would mean either a second query in the
 * layout on every single page load, or the flash-of-white that every
 * localStorage theme switcher ships with. The second reason is that this is a
 * per-device preference more than a per-account one: the laptop in a dark room
 * and the phone in daylight are the same person with two different answers.
 *
 * Scoped to the signed-in app on purpose. `.dash-shell` wraps both the creator
 * dashboard and the editor side, and the dark tokens in globals.css hang off
 * it, so the marketing pages stay the one design they were drawn as. A landing
 * page is a thing somebody sees once, in whatever mood the page sets; a tool is
 * a thing they sit in for an hour at 1am.
 */

export const THEME_COOKIE = "ugcf_theme";

/** a year. the preference is not a session thing. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type Theme = "system" | "light" | "dark";

export const THEMES: { value: Theme; label: string; blurb: string }[] = [
  { value: "system", label: "system", blurb: "follow the device" },
  { value: "light", label: "light", blurb: "the default" },
  { value: "dark", label: "dark", blurb: "easier at night" },
];

/**
 * A cookie value is a string somebody can type, so this is the only place that
 * decides what counts.
 *
 * **A browser that has never been here gets `light`**, which is what the picker
 * below has always claimed and what the product is drawn as. It used to get
 * `system`, so anybody whose machine was set to dark met the app in the dark
 * theme without ever choosing it — a first paint the design was not made for,
 * on the screen where first impressions are formed.
 *
 * `system` is still a real choice, it just has to be made. That is why it is
 * matched EXPLICITLY here rather than left to the fallback: `setTheme` in the
 * settings action validates the submitted value through this same function, so
 * a fallback that swallowed "system" would write "light" into the cookie and
 * the option would be impossible to select. The three values in, the three
 * values out, and everything else is the default.
 */
export function readTheme(raw: string | undefined | null): Theme {
  if (raw === "dark" || raw === "light" || raw === "system") return raw;
  return "light";
}
