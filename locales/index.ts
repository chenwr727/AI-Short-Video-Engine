/**
 * 语言包入口。
 *
 * 一门语言一个文件，键的真源在 zh.ts。新增语言：
 *   1. 复制 en.ts 为 xx.ts，逐条翻译
 *   2. 在 MESSAGES 里登记
 *   3. 在 i18n.ts 的 Language 类型里加 id
 */
import { en } from "./en";
import { zh, type MessageKey } from "./zh";

export { zh, en };
export type { MessageKey };

export type Language = "zh" | "en";

export const MESSAGES: Record<Language, Record<MessageKey, string>> = { zh, en };

/** 当前语言缺键时落到的语言 */
export const FALLBACK_LANGUAGE: Language = "en";
