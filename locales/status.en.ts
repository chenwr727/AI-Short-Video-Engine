import type { StatusKey } from "./status.zh";

/** status 命名空间的英文字典，键由 zh 侧约束。 */
export const status = {
  current: "Task: ",
} satisfies Record<StatusKey, string>;
