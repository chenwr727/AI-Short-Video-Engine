import { useEffect, useRef, useState } from "react";
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
          配音总时长 {manifest.totalDuration.toFixed(1)}s · {manifest.paragraphs.length} 段 · {manifest.model}
        </span>
        {playingKey && (
          <button className="play-btn" type="button" onClick={stop}>
            全部停止
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
              <span className="audio-para-title">第 {paragraph.index} 段</span>
              <span className="audio-para-meta">
                {paragraph.duration.toFixed(1)}s · {lines.length} 句
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
                {playingKey === key ? "停止" : "播放整段"}
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
                    {playingKey === line.file ? "停止" : "试听"}
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
  const stageIds = props.stageIds ?? RENDER_STAGE_IDS;
  const title = props.title ?? "配音生成";

  if (!task) {
    return (
      <Panel title={title} desc="还没有任务，请先回到第一步生成剧本。">
        <div className="panel-actions">
          <button className="secondary" type="button" onClick={onRestart}>
            返回第一步
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
  const desc =
    props.desc ??
    (needsTts
      ? "配音还没开始：确认音色与语速后，点「开始生成配音」。已合成的句子会落盘，中断后只补缺失的部分。"
      : "逐句合成配音，中间产物都会落盘，命中缓存会直接复用。");

  return (
    <Panel title={title} desc={desc} fill>
      {props.voices && (
        <ConfigSection
          title="音色与语速"
          summary={`${props.engine?.label ?? "默认引擎"} · ${props.voices.ttsSpeed || 1} 倍速 · ${
            (props.speakers ?? []).length
          } 个角色`}
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
          {onRegenerate && (
            <p className="hint">
              {props.regenerateHint ?? "改完上面的音色或语速，点「重新生成」会重做配音；素材与成片会一起作废。"}
            </p>
          )}
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
            {task.error ??
              (task.status === "cancelled"
                ? "已停止。已完成的步骤都留在磁盘上，点「继续」从断掉的地方接着跑。"
                : "合成失败")}
          </div>
        )}
        {error && <div className="alert">{error}</div>}
      </div>

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
          返回上一步
        </button>
        {failed && (
          <button className="secondary" type="button" onClick={onRestart} disabled={busy}>
            清空并重开
          </button>
        )}
        {running && (
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            停止生成
          </button>
        )}
        {onRegenerate && !needsTts && !running && (
          <button className="secondary" type="button" onClick={onRegenerate} disabled={busy}>
            重新生成
          </button>
        )}
        {failed && (
          <button className="primary" type="button" onClick={onRetry} disabled={busy}>
            {task.status === "cancelled" ? "继续" : "重试失败步骤"}
          </button>
        )}
        {needsTts && onRegenerate && (
          <button className="primary" type="button" onClick={onRegenerate} disabled={busy}>
            开始生成配音
          </button>
        )}
        {showAudio && task.status === "awaiting_material" && (
          <button className="primary" type="button" onClick={onNext} disabled={busy}>
            下一步：素材确认
          </button>
        )}
      </div>
    </Panel>
  );
}
