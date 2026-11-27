/**
 * 英文字典。
 *
 * 每个命名空间都 satisfies 了中文的键集合，漏翻一条就编译报错，
 * 所以这里不需要额外的对齐检查。
 */
import type { MessageKey } from "./zh";
import { about } from "./about.en";
import { app } from "./app.en";
import { common } from "./common.en";
import { env } from "./env.en";
import { error } from "./error.en";
import { input } from "./input.en";
import { material } from "./material.en";
import { menu } from "./menu.en";
import { prompts } from "./prompts.en";
import { render } from "./render.en";
import { result } from "./result.en";
import { script } from "./script.en";
import { settings } from "./settings.en";
import { stage } from "./stage.en";
import { status } from "./status.en";
import { steps } from "./steps.en";
import { theme } from "./theme.en";
import { tts } from "./tts.en";
import { win } from "./win.en";

const flat = {
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

export const en: Record<MessageKey, string> = flat;

function prefix<T extends Record<string, string>, N extends string>(
  ns: N,
  dict: T,
): { [K in keyof T & string as `${N}.${K}`]: string } {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(dict)) out[`${ns}.${key}`] = value;
  return out as { [K in keyof T & string as `${N}.${K}`]: string };
}
