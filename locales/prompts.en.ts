import type { PromptsKey } from "./prompts.zh";

/** prompts 命名空间的英文字典，键由 zh 侧约束。 */
export const prompts = {
  autoSaved: "Saved",
  builtin: "Built-in",
  chars: "{n} chars",
  saving: "Saving…",
  title: "Prompts",
} satisfies Record<PromptsKey, string>;
