import { useEffect, useState } from "react";
import type { RenderPatch } from "../api";
import { COMPOSE_STAGE_IDS } from "../phases";
import type { Meta, TaskState } from "../types";
import { ConfigSection, Panel } from "./Panel";
import { LogPanel, StageList } from "./StageList";
import { stepLayout, type StepStage } from "./stepLayout";

interface ResultStepProps {
  task: TaskState | null;
  busy: boolean;
  error: string;
  meta: Meta | null;
  onRender: (patch: RenderPatch) => void;
  onBack: () => void;
  onRestart: () => void;
  /** 仅桌面端 */
  onPickMusic?: () => Promise<string>;
  onReveal?: (file: string) => void;
}

/** 第五步：定渲染参数 → 生成成片，生成后仍可改参数重做 */
export function ResultStep(props: ResultStepProps) {
  const { task, busy, error, meta, onRender, onBack, onRestart, onPickMusic, onReveal } = props;
  const options = task?.options;
  const defaults = meta?.render;
  const hasVideo = task?.status === "completed" && Boolean(task.result);
  const rendering = task?.status === "running";

  const stepStage: StepStage = rendering ? "running" : hasVideo ? "ready" : "setup";
  const layout = stepLayout(stepStage, hasVideo);

  // 自动字号，须与后端比例一致
  const width = task?.options.width ?? 1080;
  const autoFontSize = Math.round(Math.round(width * 0.8) / 12);
  const defaultFontSize = autoFontSize > 0 ? autoFontSize : 72;
  const shownFontSize = (value?: number) => (value && value > 0 ? value : defaultFontSize);

  const [fontSize, setFontSize] = useState(shownFontSize(options?.subtitleFontSize));
  const [bgmEnabled, setBgmEnabled] = useState(options?.bgmEnabled ?? defaults?.bgmEnabled ?? true);
  const [bgmVolume, setBgmVolume] = useState(options?.bgmVolume ?? defaults?.bgmVolume ?? 0.1);
  const [music, setMusic] = useState(options?.bgmFile ?? "");
  const [picking, setPicking] = useState(false);

  // 任务参数或默认值晚到时回填
  useEffect(() => {
    setFontSize(shownFontSize(options?.subtitleFontSize));
    setBgmEnabled(options?.bgmEnabled ?? defaults?.bgmEnabled ?? true);
    setBgmVolume(options?.bgmVolume ?? defaults?.bgmVolume ?? 0.1);
    setMusic(options?.bgmFile ?? "");
  }, [
    options?.subtitleFontSize,
    options?.bgmEnabled,
    options?.bgmVolume,
    options?.bgmFile,
    defaults?.subtitleFontSize,
    defaults?.bgmEnabled,
    defaults?.bgmVolume,
    width,
  ]);

  if (!task) {
    return (
      <Panel title="成片预览" desc="成片生成后会出现在这里。">
        <p className="hint">还没有任务，请先生成剧本并完成素材确认。</p>
        <div className="panel-actions">
          <button className="secondary" type="button" onClick={onRestart}>
            返回第一步
          </button>
        </div>
      </Panel>
    );
  }

  async function pick() {
    if (!onPickMusic) return;
    setPicking(true);
    try {
      const file = await onPickMusic();
      if (file) setMusic(file);
    } finally {
      setPicking(false);
    }
  }

  function render() {
    onRender({
      subtitleFontSize: Math.max(1, Math.min(200, Math.round(Number(fontSize) || defaultFontSize))),
      bgmEnabled,
      bgmVolume: Math.min(2, Math.max(0, Number(bgmVolume) || 0)),
      bgmFile: bgmEnabled ? music.trim() : "",
    });
  }

  const bgmText = bgmEnabled ? `BGM ${bgmVolume}` : "无 BGM";
  const configSummary = `字幕 ${fontSize}px · ${bgmText}${music.trim() ? ` · ${music.trim()}` : " · 默认音乐"}`;

  return (
    <Panel
      title="成片预览"
      desc={
        hasVideo
          ? "成片已经保存在本地。上面这些参数改完可以重新生成，配音与素材都不用重跑。"
          : "素材已就绪，先设置字幕与背景音乐，再点「生成成片」。"
      }
      fill
    >
      {/* 有片子时收起配置与日志，把高度留给预览 */}
      <ConfigSection title="渲染参数" summary={configSummary} open={layout.configOpen}>
        <div className="row">
          <div className="field">
            <label htmlFor="subtitle-size">字幕字号（px）</label>
            <input
              id="subtitle-size"
              className="text-input"
              type="number"
              min={1}
              max={200}
              step={1}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
              disabled={rendering || picking}
            />
          </div>
          <div className="field">
            <label htmlFor="bgm-volume">BGM 音量（0–2，默认 0.1）</label>
            <input
              id="bgm-volume"
              className="text-input"
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={bgmVolume}
              onChange={(event) => setBgmVolume(Number(event.target.value))}
              disabled={rendering || picking || !bgmEnabled}
            />
          </div>
        </div>

        <div className="field">
          <label className="check" htmlFor="bgm-enabled">
            <input
              id="bgm-enabled"
              type="checkbox"
              checked={bgmEnabled}
              onChange={(event) => setBgmEnabled(event.target.checked)}
              disabled={rendering}
            />
            插入背景音乐（不勾选则只保留配音）
          </label>
        </div>

        {bgmEnabled && (
          <div className="field">
            <label htmlFor="bgm-file">自定义音乐</label>
            <div className="music-picker">
              <input
                id="bgm-file"
                className="text-input"
                value={music}
                onChange={(event) => setMusic(event.target.value)}
                placeholder="留空 = 程序合成的默认 BGM；也可填音乐目录里的文件名"
                disabled={rendering || picking}
              />
              {onPickMusic && (
                <button className="secondary" type="button" onClick={() => void pick()} disabled={rendering || picking}>
                  {picking ? "选择中…" : "选择…"}
                </button>
              )}
            </div>
          </div>
        )}

        <p className="hint">
          字号按画面宽度算好（{defaultFontSize}px，当前 {task.options.width}×{task.options.height}），可以直接改。
          改字号会重新渲染分段片段，只改 BGM 则复用片段、仅重跑合并与混音。
        </p>
      </ConfigSection>

      {task && (
        <div className="panel-logbar">
          <StageList stages={task.stages.filter((stage) => COMPOSE_STAGE_IDS.includes(stage.id))} />
          <LogPanel
            logs={task.logs}
            stages={COMPOSE_STAGE_IDS}
            collapsible
            expanded={layout.logOpen}
            tall={layout.logOpen}
          />
        </div>
      )}

      {/* 预览占满剩余高度 */}
      <div className="panel-stage">
        {hasVideo ? (
          // updatedAt 作版本号，播放器才会换新片
          <video className="player" src={`/api/result?v=${encodeURIComponent(task.updatedAt)}`} controls playsInline />
        ) : (
          <p className="hint">还没有生成成片。</p>
        )}
      </div>

      {error && <div className="alert">{error}</div>}

      {/* 主操作固定最右 */}
      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack}>
          返回上一步
        </button>
        <button className="secondary" type="button" onClick={onRestart}>
          再做一条
        </button>
        {hasVideo &&
          (onReveal ? (
            <button className="secondary" type="button" onClick={() => onReveal(task.result as string)}>
              在文件夹中显示
            </button>
          ) : (
            <a className="secondary link-btn" href="/api/result?download=1">
              下载成片
            </a>
          ))}
        <button className="primary" type="button" onClick={render} disabled={busy || rendering}>
          {busy || rendering ? "合成中…" : hasVideo ? "重新生成" : "生成成片"}
        </button>
      </div>
    </Panel>
  );
}
