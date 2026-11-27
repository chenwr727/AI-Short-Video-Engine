import { useEffect, useState } from "react";
import { useT } from "../i18n";
import type { MessageKey } from "../i18n";
import { readThemePreference, resolveTheme, saveThemePreference, type ThemePreference } from "../theme";

/** 三项顺序与外观菜单一致 */
const OPTIONS: { preference: ThemePreference; label: string; title: MessageKey }[] = [
  { preference: "light", label: "☀", title: "theme.light" },
  { preference: "dark", label: "☾", title: "theme.dark" },
  { preference: "system", label: "⌾", title: "theme.system" },
];

/**
 * 外观切换。
 *
 * 桌面端走「外观」菜单，那里是完整的三项；
 * 浏览器里没有菜单栏，用这个分段控件兜住，免得在浏览器里没法切深色。
 */
export function ThemeToggle() {
  const t = useT();
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());
  const [theme, setTheme] = useState(() => resolveTheme(readThemePreference()));

  // 跟随系统时，系统变了要把显示同步过来
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function handle() {
      setTheme(resolveTheme(preference));
    }
    media.addEventListener("change", handle);
    return () => media.removeEventListener("change", handle);
  }, [preference]);

  function choose(next: ThemePreference) {
    setTheme(saveThemePreference(next));
    setPreference(next);
  }

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
          onClick={() => choose(option.preference)}
        >
          {option.label}
        </button>
      ))}
      {/* 供读屏与调试确认当前实际主题 */}
      <span className="sr-only">{t(theme === "dark" ? "common.currentDark" : "common.currentLight")}</span>
    </div>
  );
}
