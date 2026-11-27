/** result 命名空间的中文字典，也是这一组键的真源。 */
export const result = {
  again: "再做一条",
  bgmToggle: "插入背景音乐（不勾选则只保留配音）",
  bgmVolume: "BGM 音量（0–2，默认 0.1）",
  customMusic: "自定义音乐",
  download: "下载成片",
  fontHint:
    "字号按画面宽度算好（{n}px，当前 {w}×{h}），可以直接改。改字号会重新渲染分段片段，只改 BGM 则复用片段、仅重跑合并与混音。",
  hint: "成片已生成，每段用的就是下面的素材。想换素材，点上面的「重新生成」按新来源重做。",
  noOutput: "还没有生成成片。",
  noTask: "还没有任务，请先生成剧本并完成素材确认。",
  revealFailed: "打开文件位置失败",
  showInFolder: "在文件夹中显示",
  title: "成片预览",
} satisfies Record<string, string>;

export type ResultKey = keyof typeof result;
