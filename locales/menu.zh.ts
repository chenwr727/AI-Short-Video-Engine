/** menu 命名空间的中文字典，也是这一组键的真源。 */
export const menu = {
  about: "关于",
  dataDir: "打开数据目录",
  docs: "使用说明",
  feedback: "反馈问题",
  file: "文件",
  help: "帮助",
  newTask: "新建一条",
  outputDir: "打开输出目录",
  preferences: "首选项…",
  prompts: "提示词…",
  quit: "退出",
  settings: "设置",
} satisfies Record<string, string>;

export type MenuKey = keyof typeof menu;
