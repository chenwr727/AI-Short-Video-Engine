import { useT } from "../i18n";
import type { MessageKey } from "../i18n";
import { saveThemePreference, useThemePreference, type ThemePreference } from "../theme";

/** 三项顺序与设置页的外观下拉一致 */
const OPTIONS: { preference: ThemePreference; label: string; title: MessageKey }[] = [
  { preference: "light", label: "☀", title: "theme.light" },
  { preference: "dark", label: "☾", title: "theme.dark" },
  { preference: "system", label: "⌾", title: "theme.system" },
];

/**
 * 外观切换，只在浏览器里出现。
 * 桌面端这个位置留给环境状态，外观在设置页里改。
 */
export function ThemeToggle() {
  const t = useT();
  // 订阅偏好，设置页改过之后这里跟着走
  const preference = useThemePreference();

  return (
    <div className="theme-toggle" role="group" aria-label={t("theme.appearance")}>
      {OPTIONS.map((option) => (
        <button
          key={option.preference}
          type="button"
          className={`theme-btn${preference === option.preference ? " on" : ""}`}
          title={t(option.title)}
          aria-label={t(option.title)}
          aria-pressed={preference === option.preference}
          onClick={() => saveThemePreference(option.preference)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
