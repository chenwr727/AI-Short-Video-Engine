import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { RENDER_STAGE_IDS } from "../phases";
import type { AudioManifest, Meta, TaskState, TtsEngineOption } from "../types";
import { ConfigSection, Panel } from "./Panel";
import { VoiceOptions } from "./RenderSetupStep";
import { LogPanel, StageList } from "./StageList";
import { stepLayout, type StepStage } from "./stepLayout";
import type { RenderFormState } from "./stepTypes";

interface RenderStepProps {
  task: TaskState | null;
  busy: boolean;
  error: string;
  /** 本页展示的阶段 */
  stageIds?: string[];
  onBack: () => void;
  onRestart: () => void;
  onRetry: () => void;
  onCancel: () => void;
  /** 只切换页面，不自动开始匹配 */
  onNext: () => void;
  title?: string;
  desc?: string;
  /** 会一并作废下游产物 */
  onRegenerate?: () => void;
  /** 「重新生成」的额外说明 */
  regenerateHint?: string;
  speakers?: string[];
  voices?: RenderFormState;
  engine?: TtsEngineOption | undefined;
  meta?: Meta | null;
  onFormChange?: (patch: Partial<RenderFormState>) => void;
  onVoiceChange?: (speaker: string, voice: string) => void;
}

/** 配音试听：整段连播或单句试听 */
function AudioBoard({ manifest }: { manifest: AudioManifest }) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onEnded = () => {
      const next = queueRef.current.shift();
      if (!next) {
        setPlayingKey(null);
        return;
      }
      el.src = `/api/audio/${encodeURIComponent(next)}`;
      void el.play().catch(() => setPlayingKey(null));
    };

    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, []);

  function play(files: string[], key: string) {
    const el = audioRef.current;
    if (!el || files.length === 0) return;
    queueRef.current = files.slice(1);
    el.src = `/api/audio/${encodeURIComponent(files[0] as string)}`;
    setPlayingKey(key);
    void el.play().catch(() => setPlayingKey(null));
  }

  function stop() {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.removeAttribute("src");
    queueRef.current = [];
    setPlayingKey(null);
  }

  return (
    <div className="audio-board">
      <audio ref={audioRef} preload="none" hidden />
      <div className="audio-board-head">
        <span>
          {t("tts.total", {
            sec: manifest.totalDuration.toFixed(1),
            n: manifest.paragraphs.length,
            model: manifest.model,
          })}
        </span>
        {playingKey && (
          <button className="play-btn" type="button" onClick={stop}>
            {t("tts.stopAll")}
          </button>
        )}
      </div>

      {manifest.paragraphs.map((paragraph) => {
        const lines = paragraph.dialogues.flatMap((dialogue) =>
          dialogue.files.map((file) => ({ ...file, speaker: dialogue.speaker })),
        );
        const key = `p${paragraph.index}`;

        return (
          <details className="audio-para" key={paragraph.index}>
            <summary>
              <span className="audio-para-title">{t("tts.paragraph", { n: paragraph.index })}</span>
              <span className="audio-para-meta">
                {t("tts.paragraphMeta", { sec: paragraph.duration.toFixed(1), n: lines.length })}
              </span>
              <button
                className="play-btn"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  if (playingKey === key) stop();
                  else
                    play(
                      lines.map((line) => line.file),
                      key,
                    );
                }}
              >
                {playingKey === key ? t("common.stop") : t("tts.playAll")}
              </button>
            </summary>
            <div className="audio-lines">
              {lines.map((line) => (
                <div className="audio-line" key={line.file}>
                  <span className="speaker">{line.speaker}</span>
                  <span className="audio-text">{line.text}</span>
                  <span className="audio-dur">{line.duration.toFixed(1)}s</span>
                  <button
                    className="play-btn"
                    type="button"
                    onClick={() => (playingKey === line.file ? stop() : play([line.file], line.file))}
                  >
                    {playingKey === line.file ? t("common.stop") : t("tts.play")}
                  </button>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function RenderStep(props: RenderStepProps) {
  const { task, busy, error, onBack, onRestart, onRetry, onNext, onRegenerate, onCancel } = props;
  const t = useT();
  const stageIds = props.stageIds ?? RENDER_STAGE_IDS;
  const title = props.title ?? t("tts.title");

  if (!task) {
    return (
      <Panel title={title} desc={t("render.noTask")}>
        <div className="panel-actions">
          <button className="secondary" type="button" onClick={onRestart}>
            {t("render.backFirst")}
          </button>
        </div>
      </Panel>
    );
  }

  const failed = task.status === "failed" || task.status === "cancelled";
  const running = task.status === "running";
  const stages = task.stages.filter((stage) => stageIds.includes(stage.id));
  const showAudio = stageIds.includes("tts");
  // 还没有配音清单时要给出开跑入口
  const needsTts = showAudio && !task.audio && !failed && !running;

  const stepStage: StepStage = needsTts ? "setup" : running ? "running" : failed ? "failed" : "ready";
  const layout = stepLayout(stepStage, Boolean(task.audio));
  const desc = props.desc ?? (needsTts ? t("tts.hintSetup") : t("tts.hint"));

  return (
    <Panel title={title} desc={desc} fill>
      {props.voices && (
        <ConfigSection
          title={t("tts.voice")}
          summary={`${props.engine?.label ?? t("tts.defaultEngine")} · ${t("tts.speed", {
            v: props.voices.ttsSpeed || 1,
          })} · ${t("tts.characters", { n: (props.speakers ?? []).length })}`}
          open={layout.configOpen}
        >
          <VoiceOptions
            speakers={props.speakers ?? []}
            form={props.voices}
            engine={props.engine}
            meta={props.meta ?? null}
            disabled={running || busy}
            onChange={props.onFormChange ?? (() => {})}
            onVoiceChange={props.onVoiceChange ?? (() => {})}
          />
          {onRegenerate && <p className="hint">{props.regenerateHint ?? t("tts.regenerateHint")}</p>}
        </ConfigSection>
      )}

      <div className="panel-scroll">
        <StageList stages={stages} />

        <LogPanel
          logs={task.logs}
          stages={stageIds}
          since={task.runStartedAt}
          collapsible
          expanded={layout.logOpen}
          tall={layout.logOpen}
        />

        {showAudio && layout.showResult && task.audio && <AudioBoard manifest={task.audio} />}

        {failed && (
          <div className="alert">
            {task.error ?? (task.status === "cancelled" ? t("tts.stopped") : t("error.compose"))}
          </div>
        )}
        {error && <div className="alert">{error}</div>}
      </div>

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
          {t("common.back")}
        </button>
        {failed && (
          <button className="secondary" type="button" onClick={onRestart} disabled={busy}>
            {t("script.clearRestart")}
          </button>
        )}
        {running && (
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            {t("script.stopRunning")}
          </button>
        )}
        {onRegenerate && !needsTts && !running && (
          <button className="secondary" type="button" onClick={onRegenerate} disabled={busy}>
            {t("common.regenerate")}
          </button>
        )}
        {failed && (
          <button className="primary" type="button" onClick={onRetry} disabled={busy}>
            {task.status === "cancelled" ? t("common.continue") : t("common.retry")}
          </button>
        )}
        {needsTts && onRegenerate && (
          <button className="primary" type="button" onClick={onRegenerate} disabled={busy}>
            {t("tts.start")}
          </button>
        )}
        {/* 有配音且不在跑就能进下一步 */}
        {showAudio && task.audio && !running && !failed && (
          <button className="primary" type="button" onClick={onNext} disabled={busy}>
            {t("tts.nextMaterial")}
          </button>
        )}
      </div>
    </Panel>
  );
}
