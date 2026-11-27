import type { CommonKey } from "./common.zh";

/** common 命名空间的英文字典，键由 zh 侧约束。 */
export const common = {
  back: "Back",
  chinese: "中文",
  choose: "Choose…",
  choosing: "Choosing…",
  close: "Close",
  collapse: "Collapse",
  continue: "Continue",
  currentDark: "Dark now",
  currentLight: "Light now",
  customized: "Customized",
  desktopOnly: "This feature is only available in the desktop app.",
  english: "English",
  expand: "Expand",
  failed: "Failed to load",
  generating: "Generating…",
  loading: "Loading…",
  notConfigured: "Not set",
  notGenerated: "Not generated",
  operationFailed: "Operation failed",
  processing: "Working…",
  ready: "Ready",
  regenerate: "Regenerate",
  retry: "Retry from failed step",
  searching: "Searching…",
  settingsDesktopOnly:
    "Preferences are only available in the desktop app. In the browser, edit the config file directly.",
  stop: "Stop",
  unsaved: "Unsaved changes",
} satisfies Record<CommonKey, string>;
