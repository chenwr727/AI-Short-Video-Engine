简体中文 | [English](faq_EN.md)

# 常见问题与已知限制

## 常见问题

**提示「未检测到 ffprobe / ffmpeg」**
开发态请安装系统 ffmpeg 并确保在 `PATH` 中；免安装包已内置，若仍报错说明解压不完整。

**改了配置没生效**
设置页点「保存并重启后端」会自动重启；如果直接改 `config.json`，需要重启应用（二进制探测有进程内缓存）。

**首次启动弹出设置页**
说明还没填 LLM API Key，填好保存即可，之后不会再弹。

**生成失败 / 素材一直匹配不到**
检查 `PIXABAY_API_KEY` 或 `PEXELS_API_KEY` 是否有效、网络能否访问素材站；LLM 接口超时也会导致写稿阶段失败。

**端口 4000 被占用**
Electron 会复用已在运行的后端；单独跑 `pnpm dev:server` 时可用 `PORT=4001` 换端口。

**打包后程序打不开 / 白屏**
确认 `web/dist` 已构建（`pnpm build:web`），后端日志会在 Electron 控制台以 `[server]` 前缀输出。

**卡片渲染失败 / 没找到 remotion 运行环境**
`remotion/` 是独立的 npm 子工程，不在 pnpm workspace 里，根目录 `pnpm install` 不会装它，需要单独 `npm install`：

```bash
cd remotion && npm install
```

`remotion.ts` 要求目录里同时有 `render.mjs` 与 `node_modules`，缺任一项都会报这个错。未装时卡片按原逻辑回退（片头用字幕标题，其余卡片跳过），不会中断出片。细节见 [remotion.md](remotion.md)。

**改了 prompt 不生效**
编辑器保存后下一条任务生效，已生成的任务不受影响。若直接改文件，确认改的是 `<数据目录>/prompts/` 下的覆盖层而非随包内置文件，见 [prompts.md](prompts.md)。

## 已知限制

- 单任务串行：同一时间只能跑一个任务，需要排队或等前一个结束
- 素材依赖第三方站（Pixabay / Pexels），必须联网且有可用 Key
- 字幕用系统字体渲染：Windows 走微软雅黑，macOS / Linux 由 libass 回退，字形可能有差异
- CosyVoice 与豆包需要各自平台的 Key，未配置时界面上不会出现对应引擎
- 需要登录或强反爬的站点抓不到正文时，会直接提示改用「粘贴正文」
- 片头 / 片尾 / 版式卡依赖 `remotion/` 子工程的依赖与 Chrome Headless Shell；未安装时卡片渲染失败会被跳过，片头回退到字幕标题
