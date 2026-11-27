/** status 命名空间的中文字典，也是这一组键的真源。 */
export const status = {
  current: "当前任务：",
} satisfies Record<string, string>;

export type StatusKey = keyof typeof status;
