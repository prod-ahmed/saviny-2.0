/** Appearance: follow the device, or force light or dark. Stored on this device only. */
export type Theme = "system" | "light" | "dark";

export const THEME_KEY = "saviny.theme";
export const THEMES: { value: Theme; label: string; text: string }[] = [
  { value: "system", label: "System", text: "Follow the device setting" },
  { value: "light", label: "Light", text: "Always use the light palette" },
  { value: "dark", label: "Dark", text: "Always use the dark palette" },
];

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** Sets the attribute the stylesheet reads. "system" removes it so the media query decides. */
export function applyTheme(theme: Theme): void {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: the choice still applies for this visit */
  }
  applyTheme(theme);
}

/** Run before the first paint (see app/layout.tsx), so a dark choice never flashes light. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
