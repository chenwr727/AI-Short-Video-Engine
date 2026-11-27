/**
 * 中文词典（键的真源）。
 *
 * 按命名空间拆文件，这里汇总成一张扁平表：键是 `命名空间.短键`，
 * 和 en.ts 一一对应。加新文案时先在这里的某个命名空间文件里定义。
 */
import { about } from "./about.zh";
import { app } from "./app.zh";
import { common } from "./common.zh";
import { env } from "./env.zh";
import { error } from "./error.zh";
import { input } from "./input.zh";
import { material } from "./material.zh";
import { menu } from "./menu.zh";
import { prompts } from "./prompts.zh";
import { render } from "./render.zh";
import { result } from "./result.zh";
import { script } from "./script.zh";
import { settings } from "./settings.zh";
import { stage } from "./stage.zh";
import { status } from "./status.zh";
import { steps } from "./steps.zh";
import { theme } from "./theme.zh";
import { tts } from "./tts.zh";
import { win } from "./win.zh";

export const zh = {
  ...prefix("about", about),
  ...prefix("app", app),
  ...prefix("common", common),
  ...prefix("env", env),
  ...prefix("error", error),
  ...prefix("input", input),
  ...prefix("material", material),
  ...prefix("menu", menu),
  ...prefix("prompts", prompts),
  ...prefix("render", render),
  ...prefix("result", result),
  ...prefix("script", script),
  ...prefix("settings", settings),
  ...prefix("stage", stage),
  ...prefix("status", status),
  ...prefix("steps", steps),
  ...prefix("theme", theme),
  ...prefix("tts", tts),
  ...prefix("win", win),
};

export type MessageKey = keyof typeof zh;

/**
 * 把命名空间内的短键展开成 `命名空间.短键`。
 *
 * 返回类型必须保留键的字面量 —— 直接返回 Record<string, string> 会让
 * MessageKey 塌成 string，t() 就失去键名约束了。
 */
function prefix<T extends Record<string, string>, N extends string>(
  ns: N,
  dict: T,
): { [K in keyof T & string as `${N}.${K}`]: string } {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(dict)) out[`${ns}.${key}`] = value;
  return out as { [K in keyof T & string as `${N}.${K}`]: string };
}
