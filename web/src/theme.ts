/**
 * 外观偏好：浅色 / 深色 / 跟随系统。
 *
 * 真源在主进程的 ui.json。各窗口不同源（设置页 file://、主窗口 http://），
 * localStorage 互不相通，只有同一个磁盘文件才能共享。
 * 本地那份只作首帧镜像，之后以主进程为准校正。
 */

import { useSyncExternalStore } from "react";
import { bridge } from "./bridge";

export type ThemePreference = "light" | "dark" | "system";

export type Theme = "light" | "dark";

const STORAGE_KEY = "aisv.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** 读取已保存的偏好，缺省或脏值都当跟随系统 */
export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(raw)) return raw;
  } catch {
    // 隐私模式下可能不可读
  }
  return "system";
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference === "light" || preference === "dark") return preference;
  return systemPrefersDark() ? "dark" : "light";
}

/** 写进 DOM 并通知主进程：标题栏按钮由原生绘制，渲染层改不到 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // 系统自绘控件（滚动条、<select> 弹层、日期选择器）按这个走
  root.style.colorScheme = theme;
  bridge()?.setWindowTheme?.(theme);
}

export function saveThemePreference(preference: ThemePreference): Theme {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // 存不下不影响本次生效
  }
  const theme = resolveTheme(preference);
  applyTheme(theme);
  notify();
  // 广播偏好而非解析结果，否则别的窗口选「跟随系统」时会错位到具体项
  bridge()?.announceTheme?.(preference);
  return theme;
}

/** 启动时以 ui.json 校正镜像 —— 镜像可能已被设置页改过 */
export async function syncThemeFromHost(): Promise<void> {
  const getTheme = bridge()?.getTheme;
  if (!getTheme) return;
  try {
    const stored = await getTheme();
    if (!isThemePreference(stored)) return;
    const changed = stored !== readThemePreference();
    if (changed) {
      try {
        localStorage.setItem(STORAGE_KEY, stored);
      } catch {
        // 镜像存不下也能用
      }
    }
    const next = resolveTheme(stored);
    if (document.documentElement.dataset.theme !== next) applyTheme(next);
    if (changed) notify();
  } catch {
    // 取不到就沿用镜像
  }
}

/** 监听系统深浅与跨窗口变更，返回取消订阅函数 */
export function watchSystemTheme(onChange: (theme: Theme) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia(DARK_QUERY);

  /** 值没变就不动 —— 这个回调在窗口重新聚焦时也会走到 */
  function set(theme: Theme) {
    if (document.documentElement.dataset.theme === theme) return;
    applyTheme(theme);
    notify();
    onChange(theme);
  }

  function onSystemChange() {
    if (readThemePreference() !== "system") return;
    set(systemPrefersDark() ? "dark" : "light");
  }

  function onStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY) return;
    set(resolveTheme(readThemePreference()));
  }

  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);

  // 别的窗口改完经主进程广播过来，收到的是偏好而不是解析结果
  const offBridge = bridge()?.onThemeChanged?.((preference) => {
    if (!isThemePreference(preference)) return;
    try {
      // 同步镜像，下次启动的首帧才不会按旧值画
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // 镜像存不下不影响本次生效
    }
    set(resolveTheme(preference));
  });

  return () => {
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
    offBridge?.();
  };
}

/** 首屏同步：在 React 挂载前定好主题，避免先白后黑 */
export function initTheme(): void {
  applyTheme(resolveTheme(readThemePreference()));
}

function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 组件里订阅外观偏好：一变就重渲染 */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, readThemePreference, () => "system" as ThemePreference);
}
