import { useEffect, useState } from "react";
import type { RenderPatch } from "../api";
import { useT } from "../i18n";
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
  const t = useT();
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

  const [fontSize, setFontSize] = useState(String(shownFontSize(options?.subtitleFontSize)));
  const [bgmEnabled, setBgmEnabled] = useState(options?.bgmEnabled ?? defaults?.bgmEnabled ?? true);
  const [bgmVolume, setBgmVolume] = useState(options?.bgmVolume ?? defaults?.bgmVolume ?? 0.1);
  const [music, setMusic] = useState(options?.bgmFile ?? "");
  const [picking, setPicking] = useState(false);

  // 清空或非法输入回落到默认值，摘要与实际提交都用这个值
  const parsedFontSize = Math.round(Number(fontSize));
  const effectiveFontSize = parsedFontSize > 0 ? Math.min(200, parsedFontSize) : defaultFontSize;

  // 任务参数或默认值晚到时回填
  useEffect(() => {
    setFontSize(String(shownFontSize(options?.subtitleFontSize)));
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
      <Panel title={t("result.title")} desc={t("render.empty")}>
        <p className="hint">{t("result.noTask")}</p>
        <div className="panel-actions">
          <button className="secondary" type="button" onClick={onRestart}>
            {t("render.backFirst")}
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
      subtitleFontSize: effectiveFontSize,
      bgmEnabled,
      bgmVolume: Math.min(2, Math.max(0, Number(bgmVolume) || 0)),
      bgmFile: bgmEnabled ? music.trim() : "",
    });
  }

  const bgmText = bgmEnabled ? `BGM ${bgmVolume}` : t("render.noBgm");
  const configSummary = t("render.summary", {
    size: effectiveFontSize,
    bgm: bgmText,
    music: music.trim() ? ` · ${music.trim()}` : ` · ${t("render.defaultMusic")}`,
  });

  return (
    <Panel title={t("result.title")} desc={hasVideo ? t("result.hint") : t("render.hintNoTts")} fill>
      {/* 有片子时收起配置与日志，把高度留给预览 */}
      <ConfigSection title={t("render.params")} summary={configSummary} open={layout.configOpen} resetKey={stepStage}>
        <div className="row">
          <div className="field">
            <label htmlFor="subtitle-size">{t("render.fontSize")}（px）</label>
            <input
              id="subtitle-size"
              className="text-input"
              type="number"
              min={1}
              max={200}
              step={1}
              value={fontSize}
              placeholder={String(defaultFontSize)}
              onChange={(event) => setFontSize(event.target.value)}
              onBlur={() => setFontSize(String(effectiveFontSize))}
              disabled={rendering || picking}
            />
          </div>
          <div className="field">
            <label htmlFor="bgm-volume">{t("result.bgmVolume")}</label>
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
            {t("result.bgmToggle")}
          </label>
        </div>

        {bgmEnabled && (
          <div className="field">
            <label htmlFor="bgm-file">{t("result.customMusic")}</label>
            <div className="music-picker">
              <input
                id="bgm-file"
                className="text-input"
                value={music}
                onChange={(event) => setMusic(event.target.value)}
                placeholder={t("render.bgmPlaceholder")}
                disabled={rendering || picking}
              />
              {onPickMusic && (
                <button className="secondary" type="button" onClick={() => void pick()} disabled={rendering || picking}>
                  {picking ? t("common.choosing") : t("common.choose")}
                </button>
              )}
            </div>
          </div>
        )}

        <p className="hint">
          {t("result.fontHint", { n: defaultFontSize, w: task.options.width, h: task.options.height })}
        </p>
      </ConfigSection>

      <div className="panel-scroll">
        <StageList stages={task.stages.filter((stage) => COMPOSE_STAGE_IDS.includes(stage.id))} />

        <LogPanel
          logs={task.logs}
          stages={COMPOSE_STAGE_IDS}
          since={task.runStartedAt}
          collapsible
          expanded={layout.logOpen}
          tall={layout.logOpen}
        />

        <div className="panel-stage">
          {hasVideo ? (
            // updatedAt 作版本号，播放器才会换新片
            <video
              className="player"
              src={`/api/result?v=${encodeURIComponent(task.updatedAt)}`}
              controls
              playsInline
            />
          ) : (
            <p className="hint">{t("result.noOutput")}</p>
          )}
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      {/* 主操作固定最右 */}
      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack}>
          {t("common.back")}
        </button>
        <button className="secondary" type="button" onClick={onRestart}>
          {t("result.again")}
        </button>
        {hasVideo &&
          (onReveal ? (
            <button className="secondary" type="button" onClick={() => onReveal(task.result as string)}>
              {t("result.showInFolder")}
            </button>
          ) : (
            <a className="secondary link-btn" href="/api/result?download=1">
              {t("result.download")}
            </a>
          ))}
        <button className="primary" type="button" onClick={render} disabled={busy || rendering}>
          {busy || rendering ? t("render.generating") : hasVideo ? t("common.regenerate") : t("render.generate")}
        </button>
      </div>
    </Panel>
  );
}
