简体中文 | [English](packaging_EN.md)

# 打包

```bash
pnpm dist:win     # 产物：desktop/release/AI Short Video-<version>-win-portable.zip
```

体积约 200 MB（含 ffmpeg / ffprobe）。`compression: maximum` 会让 zip 阶段跑较久，日常迭代可临时改成 `normal`。

带 Remotion 卡片（片头 / 过场 / 版式卡）的包有两种打法：

| 命令 | 卡片运行时 | 体积 |
| --- | --- | --- |
| `pnpm dist:win` | 不带，卡片渲染自动跳过 | 约 200 MB |
| `pnpm dist:win:remotion` | 自带 Chrome Headless Shell，离线可用 | 约 400 MB |
| `pnpm dist:win:remotion-slim` | 借用系统 Edge / Chrome（Windows 10+ 自带 Edge） | 约 300 MB |

打包时只带渲染链路：预构建 bundle、`@remotion/renderer`、compositor（瘦身版再加 Chrome Headless Shell）。`remotion/node_modules` 里 266 MB 的 webpack 缓存、typescript、rspack / babel、mediabunny、react 等一概不进包，bundle 的 sourcemap（23 MB）也会在暂存时剔掉。

瘦身版要求机器上有 Edge 或 Chrome；都没有时卡片渲染失败并按原逻辑回退（片头用字幕标题，其余卡片跳过），不会中断出片。想指定浏览器可用 `REMOTION_BROWSER` 指向可执行文件。普通包会主动清掉上次的暂存，避免把卡片运行时误打进轻量包。

构建流程：前端构建 → 生成图标 → 复制 ffmpeg/ffprobe → 暂存后端并安装生产依赖 →（可选）暂存 Remotion → 编译主进程 → electron-builder → 产物自检。

macOS / Linux 与其余 `dist:*` 命令见主页的[常用命令](../README.md#常用命令)表，桌面端细节见 [desktop/README.md](../desktop/README.md)。
