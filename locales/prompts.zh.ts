/** prompts 命名空间的中文字典，也是这一组键的真源。 */
export const prompts = {
  autoSaved: "已保存",
  builtin: "内置默认",
  chars: "{n} 字",
  reset: "恢复默认",
  saving: "保存中…",
  title: "提示词",
} satisfies Record<string, string>;

export type PromptsKey = keyof typeof prompts;
