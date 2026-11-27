/**
 * 界面语言：中文 / English / 跟随系统。
 *
 * 偏好的真源是主进程的 ui.json —— 各窗口不同源，localStorage 互不相通，
 * 只有落到同一个文件才能共享。
 * localStorage 保留一份镜像，只为首帧不闪：先用它渲染，再向主进程校正一次。
 */

import { useSyncExternalStore } from "react";
import { FALLBACK_LANGUAGE, MESSAGES, type Language, type MessageKey } from "../../locales/index";
import { bridge } from "./bridge";

export type { Language, MessageKey };
export type LanguagePreference = "zh" | "en" | "system";

const STORAGE_KEY = "aisv.lang";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function systemLanguage(): Language {
  if (typeof navigator === "undefined") return "zh";
  // zh-CN / zh-TW / zh-Hans 都算中文，其余一律走英文
  const tag = navigator.language?.toLowerCase() ?? "";
  return tag.startsWith("zh") ? "zh" : "en";
}

/** 读取已保存的偏好，缺省或脏值都当跟随系统 */
export function readLanguagePreference(): LanguagePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "zh" || raw === "en" || raw === "system") return raw;
  } catch {
    // 隐私模式下可能不可读
  }
  return "system";
}

/** 偏好解析成实际生效的语言 */
export function resolveLanguage(preference: LanguagePreference): Language {
  if (preference === "zh" || preference === "en") return preference;
  return systemLanguage();
}

export function currentLanguage(): Language {
  return resolveLanguage(readLanguagePreference());
}

/** 把语言写进 DOM，让 :lang()、拼写检查和读屏都跟着走 */
function applyLanguage(language: Language): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.documentElement.dataset.lang = language;
}

/** 保存偏好并立即生效 */
export function saveLanguagePreference(preference: LanguagePreference): Language {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // 存不下不影响本次生效
  }
  const language = resolveLanguage(preference);
  applyLanguage(language);
  notify();
  /*
   * 交给主进程落盘并广播。
   * 传的是偏好而不是解析结果：选「跟随系统」时别的窗口也要看到 system，
   * 传 zh/en 会让它们的下拉框位到具体语言上。
   */
  bridge()?.announceLanguage?.(preference);
  return language;
}

/**
 * 从主进程同步真实偏好。
 *
 * 启动时镜像可能已过期（比如设置页改过），以 ui.json 为准校正一次。
 */
export async function syncLanguageFromHost(): Promise<void> {
  const getLanguage = bridge()?.getLanguage;
  if (!getLanguage) return;
  try {
    const stored = await getLanguage();
    if (stored !== "zh" && stored !== "en" && stored !== "system") return;
    if (stored === readLanguagePreference()) return;
    try {
      localStorage.setItem(STORAGE_KEY, stored);
    } catch {
      // 镜像存不下也能用
    }
    applyLanguage(resolveLanguage(stored));
    notify();
  } catch {
    // 取不到就沿用镜像
  }
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 监听系统语言切换（仅「跟随系统」时生效）。
 * navigator.language 变化在 Chromium 里不会触发事件，
 * 用 matchMedia 的 change 兜住 —— 换系统语言时界面语言通常一起变。
 */
export function watchSystemLanguage(): () => void {
  if (typeof window === "undefined") return () => undefined;

  function handle() {
    if (readLanguagePreference() !== "system") return;
    const language = systemLanguage();
    /*
     * 值没变就别动。
     * 这个函数挂在 focus 上，关掉设置/提示词窗口、从别的程序切回来都会触发；
     * 每次都重写 <html lang> 并通知所有订阅者，主界面就会闪一下。
     */
    if (language === currentLanguage()) return;
    applyLanguage(language);
    notify();
  }

  function onStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY) return;
    // 镜像被写成同一个值时不必重画
    const next = currentLanguage();
    if (document.documentElement.dataset.lang === next) return;
    applyLanguage(next);
    notify();
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  // 系统语言没有对应的 media query，只在窗口重新聚焦时校验一次
  function onFocus() {
    handle();
  }

  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onFocus);
  media.addEventListener("change", handle);

  // 别的窗口改完语言会经主进程广播过来，收到的是偏好，要重新解析成生效语言
  const offBridge = bridge()?.onLanguageChanged?.((preference) => {
    if (preference !== "zh" && preference !== "en" && preference !== "system") return;
    try {
      // 同步镜像，下次启动的首帧才不会按旧值画
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // 镜像存不下不影响本次生效
    }
    applyLanguage(resolveLanguage(preference));
    notify();
  });

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onFocus);
    media.removeEventListener("change", handle);
    offBridge?.();
  };
}

/** 首屏同步：在 React 挂载前定好语言，避免闪一下中文再变英文 */
export function initLanguage(): void {
  applyLanguage(currentLanguage());
}

/**
 * 让窗口标题跟着语言走。
 *
 * 无边框窗口没有标题栏，标题只会出现在任务栏和 Alt+Tab 里；
 * 浏览器里则是标签页。两种场景都该是当前语言。
 * 返回取消订阅函数。
 */
export function bindDocumentTitle(key: MessageKey): () => void {
  if (typeof document === "undefined") return () => undefined;
  const sync = () => {
    document.title = t(key);
  };
  sync();
  return subscribeLanguage(sync);
}

/** 语言变化时触发重渲染；文案由 t() 现取，不必把词典塞进 state */
export function useLanguage(): Language {
  return useSyncExternalStore(
    subscribeLanguage,
    () => currentLanguage(),
    // 服务端渲染不存在，退回中文
    () => "zh" as Language,
  );
}

/** 插值参数：{name} 会被替换成对应的值 */
export type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

/**
 * 取文案。
 *
 * 直接读当前语言，不依赖 React —— api 层、事件回调里也能用。
 * 组件里想跟着语言变化重渲染，调一次 useLanguage() 即可。
 */
export function t(key: MessageKey, vars?: Vars): string {
  const language = currentLanguage();
  // 缺词时落到兜底语言，再不行显示键名，便于一眼发现漏翻
  const template = MESSAGES[language][key] ?? MESSAGES[FALLBACK_LANGUAGE][key] ?? key;
  return interpolate(template, vars);
}

/** 组件里用的取词函数：语言一变就重渲染 */
export function useT(): (key: MessageKey, vars?: Vars) => string {
  const language = useLanguage();
  // language 只是触发重渲染的信号，实际文案由 t() 现取
  void language;
  return t;
}
