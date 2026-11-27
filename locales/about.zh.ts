/** about 命名空间的中文字典，也是这一组键的真源。 */
export const about = {
  "app.name": "AI 短视频生成器",
  "app.tagline": "链接 → 剧本 → 配音 → 素材 → 成片",
  "app.title": "关于",
  "btn.close": "关闭",
  "btn.ok": "知道了",
  "version.backend": "后端",
  "version.chromium": "Chromium",
  "version.desktop": "桌面版",
  "version.electron": "Electron",
  "version.error": "读取失败",
  "version.node": "Node",
} satisfies Record<string, string>;

export type AboutKey = keyof typeof about;
