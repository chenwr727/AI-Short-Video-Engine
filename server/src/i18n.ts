/**
 * 后端文案的语种协商。
 *
 * 界面语言由前端决定，后端只负责按请求头返回对应语言的提示。
 */

export type Lang = "zh" | "en";

/**
 * 从 Accept-Language 取主语言。
 *
 * 只认第一段：浏览器按偏好排序，第一段就是用户最想要的那个。
 * 解析不出来时给中文，与改动前的行为一致。
 */
export function langOf(header: string | undefined): Lang {
  if (!header) return "zh";
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("zh")) return "zh";
  if (first.startsWith("en")) return "en";
  return "zh";
}

/** 一份中英对照，键是内部标识 */
export type Bilingual = { zh: string; en: string };

/** 取对应语言的文案 */
export function pick(lang: Lang, text: Bilingual): string {
  return lang === "en" ? text.en : text.zh;
}
