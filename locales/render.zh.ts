/** render 命名空间的中文字典，也是这一组键的真源。 */
export const render = {
  backFirst: "返回第一步",
  bgmPlaceholder: "留空 = 程序合成的默认 BGM；也可填音乐目录里的文件名",
  defaultMusic: "默认音乐",
  empty: "成片生成后会出现在这里。",
  fontSize: "字幕字号",
  generate: "生成成片",
  generating: "合成中…",
  hint: "成片已经保存在本地。上面这些参数改完可以重新生成，配音与素材都不用重跑。",
  hintNoTts: "素材已就绪，先设置字幕与背景音乐，再点「生成成片」。",
  log: "运行日志",
  noBgm: "无 BGM",
  noSpeakers: "剧本里还没有角色。",
  noTask: "还没有任务，请先回到第一步生成剧本。",
  params: "渲染参数",
  scriptLabel: "剧本",
  summary: "字幕 {size}px · {bgm}{music}",
} satisfies Record<string, string>;

export type RenderKey = keyof typeof render;
