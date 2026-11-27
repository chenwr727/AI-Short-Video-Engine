/** stage 命名空间的中文字典，也是这一组键的真源。 */
export const stage = {
  cards: "生成版式",
  compose: "合成视频",
  connecting: "连接中…",
  count: "（{n} 条）",
  fetch: "获取内容",
  hasError: "有报错",
  material: "匹配素材",
  noLog: "暂无日志",
  openSettings: "打开首选项…",
  rewrite: "改写剧本",
  split: "拆分台词",
  "summary.cards": "{n} 张",
  "summary.chars": "{n} 字",
  "summary.missingCards": " / 缺 {n} 张版式卡",
  "summary.sections": "{n} 段",
  "summary.sectionsSeconds": "{n} 段 / {sec}s",
  "summary.sectionsSentences": "{n} 段 / {sent} 句",
  tts: "合成配音",
  write: "生成草稿",
} satisfies Record<string, string>;

export type StageKey = keyof typeof stage;
