/**
 * Available themes. Each name maps to a `[data-theme="<name>"]` block in
 * `app/theme.css`. Pick the active one with `brand.theme` in `config/brand.ts`.
 *
 * To add a theme: copy a block in `app/theme.css`, rename it, and add the
 * name to this list.
 */
export const themes = ["station", "aqua", "midnight", "lagoon"] as const;

export type ThemeName = (typeof themes)[number];
