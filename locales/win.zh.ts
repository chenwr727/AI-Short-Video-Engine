/** win 命名空间的中文字典，也是这一组键的真源。 */
export const win = {
  close: "关闭",
  maximize: "最大化",
  minimize: "最小化",
} satisfies Record<string, string>;

export type WinKey = keyof typeof win;
