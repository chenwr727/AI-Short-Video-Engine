import type { CardComposition, CardKind } from "./types.js";

export interface CardTemplate {
  id: CardComposition;
  name: string;
  hint: string;
}

/** 新增模板要同步注册到 remotion/src/Root.tsx */
export const CARD_TEMPLATES: Record<CardKind, CardTemplate[]> = {
  intro: [
    { id: "TitleCard", name: "左对齐标题", hint: "标题靠左、底部进度线，节奏快" },
    { id: "TitleHero", name: "居中大字", hint: "封面感强，适合观点和悬念" },
  ],
  chapter: [
    { id: "ChapterCard", name: "编号 + 标题", hint: "大号数字压底，标准过场" },
    { id: "ChapterSplit", name: "左右分栏", hint: "左侧竖排序号，信息量更大" },
  ],
  outro: [
    { id: "OutroCard", name: "标准片尾", hint: "标题、账号、引导箭头" },
    { id: "OutroMinimal", name: "极简片尾", hint: "光圈呼吸、居中留白" },
  ],
  quote: [{ id: "QuoteCard", name: "观点卡", hint: "素材缺失时兜底" }],
  info: [
    { id: "PersonCard", name: "人物名条", hint: "谁在说话：姓名 + 身份 + 一句判断" },
    { id: "PersonCardHero", name: "人物 · 全屏大字", hint: "关键人物放大到整屏，开篇或转折点最抓眼" },
    { id: "PersonCardCompact", name: "人物 · 角落小条", hint: "只占右下角，让素材画面尽量完整" },
    { id: "CompareCard", name: "立场对比", hint: "左右分栏，适合「A 这么做，B 却那样」" },
    { id: "CompareCardStacked", name: "立场对比 · 上下叠", hint: "两栏各占一行，能放下更长的立场说法" },
    { id: "TimelineCard", name: "事件时间线", hint: "2-4 个节点按顺序点亮" },
    { id: "StatCard", name: "数据卡", hint: "大数字 + 柱状对比（最多 4 根，多出的合并为「其他」）" },
    { id: "StatCardSplit", name: "数据卡 · 横排", hint: "数字在左、柱状在右，画面更扁" },
  ],
};

export function defaultTemplate(kind: CardKind): CardComposition {
  return CARD_TEMPLATES[kind][0]?.id ?? "TitleCard";
}

export function isTemplateFor(kind: CardKind, value: unknown): value is CardComposition {
  return typeof value === "string" && CARD_TEMPLATES[kind].some((template) => template.id === value);
}
