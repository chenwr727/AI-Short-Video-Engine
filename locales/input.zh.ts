/** input 命名空间的中文字典，也是这一组键的真源。 */
export const input = {
  afterScript: "剧本已生成但还没确认：改完上面的内容点「重新生成」会整条重写；只想换风格或角色名，去「剧本生成」。",
  chars: "{n} 字",
  hint: "输入网页链接或正文；下一步再定脚本风格与角色名，然后手动开始生成。",
  label: "内容（网页 URL 或正文）",
  needContent: "先填入链接或正文",
  nextHint: "下一步：剧本生成",
  placeholder: "例如：https://36kr.com/p/xxxxx　或直接粘贴文章正文",
  regenerateHint: "丢弃当前剧本以及已生成的配音、素材与成片，按上面的内容重新走一遍全流程",
  subHint: "支持文章链接（自动抓正文）或直接粘贴文字；内容越具体，剧本越贴题。",
} satisfies Record<string, string>;

export type InputKey = keyof typeof input;
