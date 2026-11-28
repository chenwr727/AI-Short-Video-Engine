import type { AboutKey } from "./about.zh";

/** about 命名空间的英文字典，键由 zh 侧约束。 */
export const about = {
  "app.name": "ShortDeck",
  "app.tagline": "Link → script → voice → footage → final cut",
  "app.title": "About",
  "btn.close": "Close",
  "btn.ok": "Got it",
  "version.backend": "Backend",
  "version.chromium": "Chromium",
  "version.desktop": "Desktop",
  "version.electron": "Electron",
  "version.error": "Unavailable",
  "version.node": "Node",
} satisfies Record<AboutKey, string>;
