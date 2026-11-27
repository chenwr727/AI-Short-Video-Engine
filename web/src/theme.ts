/**
 * 外观偏好：浅色 / 深色 / 跟随系统。
 *
 * 偏好存 localStorage，跟着这台机器走；没存过就跟随系统。
 * 实际生效的主题写在 <html data-theme>，CSS 只认这个属性。
 */

import { bridge } from "./bridge";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "aisv.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

/** 读取已保存的偏好，缺省或脏值都当跟随系统 */
export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // 隐私模式下可能不可读
  }
  return "system";
}

/** 偏好解析成实际生效的主题 */
export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  return systemPrefersDark() ? "dark" : "light";
}

/**
 * 把主题写进 DOM，并通知主进程。
 * 右上角的窗口按钮由原生绘制，只有主进程改得动。
 */
export function applyTheme(theme: "light" | "dark"): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // 系统自绘控件（滚动条、<select> 弹层、日期选择器）按这个走
  root.style.colorScheme = theme;
  bridge()?.setWindowTheme?.(theme);
}

/** 保存偏好并立即生效，返回实际生效的主题 */
export function saveThemePreference(preference: ThemePreference): "light" | "dark" {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // 存不下不影响本次生效
  }
  const theme = resolveTheme(preference);
  applyTheme(theme);
  return theme;
}

/**
 * 监听系统深浅切换，只在偏好是「跟随系统」时才改。
 * 返回取消订阅函数。
 */
export function watchSystemTheme(onChange: (theme: "light" | "dark") => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia(DARK_QUERY);

  function handle(event: MediaQueryListEvent) {
    // 用户已经明确选过，不跟随系统
    if (readThemePreference() !== "system") return;
    const theme = event.matches ? "dark" : "light";
    applyTheme(theme);
    onChange(theme);
  }

  media.addEventListener("change", handle);
  return () => media.removeEventListener("change", handle);
}

/** 首屏同步：在 React 挂载前定好主题，避免先白后黑的闪屏 */
export function initTheme(): void {
  applyTheme(resolveTheme(readThemePreference()));
}
