/** steps 命名空间的中文字典，也是这一组键的真源。 */
export const steps = {
  backTo: "回到「{step}」",
  content: "文案脚本",
  contentDesc: "输入链接或正文",
  material: "素材确认",
  materialDesc: "匹配素材 · 片头章节",
  render: "成片预览",
  renderDesc: "渲染设置 · 播放",
  script: "剧本生成",
  scriptDesc: "选脚本风格 · AI 写稿",
  tts: "配音生成",
  ttsDesc: "逐句配音 · 音色选择",
} satisfies Record<string, string>;

export type StepsKey = keyof typeof steps;
