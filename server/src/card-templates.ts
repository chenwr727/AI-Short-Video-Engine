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
};

export function defaultTemplate(kind: CardKind): CardComposition {
  return CARD_TEMPLATES[kind][0]?.id ?? "TitleCard";
}

export function isTemplateFor(kind: CardKind, value: unknown): value is CardComposition {
  return typeof value === "string" && CARD_TEMPLATES[kind].some((template) => template.id === value);
}
