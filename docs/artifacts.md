简体中文 | [English](artifacts_EN.md)

# 任务产物与断点续跑

每个任务在 `<数据目录>/workspaces/<时间戳>/` 下留一份完整中间产物（源码运行为 `server/data/workspaces/`，免安装版为 `UserData/data/workspaces/`）：

```
20261115-214501/
  _html.txt          # 抓取到的原文
  _transcript.txt    # LLM 草稿
  _transcript.json   # 确认后的结构化剧本
  _terms.json        # 每段素材检索词
  *.mp3              # 分句配音，命名为 段_句_分片
  _durations.json    # 配音时长
  _videos.json       # 素材清单
  clips/ subs/       # 分段视频与 ASS 字幕
  cards/             # 卡片视频与静帧，文件名带参数指纹
  _task.json         # 任务状态快照（含版式清单），用于断点恢复
  _bgm.wav           # 混入的背景音乐
  _output.mp4        # 成片
```

中断后重跑会复用已有产物，只补缺失部分；在成片页点「重新生成」会清掉 `_output.mp4` 与 `clips/` 重跑合成，配音与素材保持不变。

数据目录位置与 `SHORTDECK_DATA_DIR` 等变量见 [configuration.md](configuration.md#环境变量)；**文件 → 打开数据目录** 可直接定位。
