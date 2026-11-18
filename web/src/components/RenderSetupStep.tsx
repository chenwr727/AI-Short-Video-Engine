import type { Meta, TaskState, TtsEngineOption } from "../types";
import { Panel } from "./Panel";
import type { RenderFormState } from "./stepTypes";

/** 常用语速档位，其它值临时插入 */
const SPEED_OPTIONS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5];

function editSummary(task: TaskState): string {
  const transcript = task.transcript;
  if (!transcript) return "未生成";
  return `${transcript.title || "未命名"} · ${transcript.paragraphs.length} 段`;
}

interface VoiceOptionsProps {
  speakers: string[];
  form: RenderFormState;
  engine: TtsEngineOption | undefined;
  meta: Meta | null;
  disabled: boolean;
  onChange: (patch: Partial<RenderFormState>) => void;
  onVoiceChange: (speaker: string, voice: string) => void;
}

/** 音色、引擎与语速，配音设置页与配音页共用 */
export function VoiceOptions({ speakers, form, engine, meta, disabled, onChange, onVoiceChange }: VoiceOptionsProps) {
  // 语速不在常用档位时临时插入，避免下拉为空
  const speedOptions =
    form.ttsSpeed > 0 && !SPEED_OPTIONS.includes(form.ttsSpeed)
      ? [...SPEED_OPTIONS, form.ttsSpeed].sort((a, b) => a - b)
      : SPEED_OPTIONS;

  return (
    <>
      <div className="voice-list">
        {speakers.length === 0 && <p className="hint">剧本里还没有角色。</p>}
        {speakers.map((speaker) => (
          <div className="voice-row" key={speaker}>
            <span className="speaker">{speaker}</span>
            <select
              value={form.voices[speaker] ?? ""}
              onChange={(event) => onVoiceChange(speaker, event.target.value)}
              disabled={disabled}
            >
              {engine?.voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="tts-engine">配音引擎</label>
          <select
            id="tts-engine"
            value={form.ttsEngine}
            onChange={(event) => onChange({ ttsEngine: event.target.value })}
            disabled={disabled}
          >
            {meta?.ttsEngines.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {engine?.description && <span className="field-hint">{engine.description}</span>}
        </div>

        <div className="field">
          <label htmlFor="tts-speed">语速</label>
          <select
            id="tts-speed"
            value={String(form.ttsSpeed)}
            onChange={(event) => onChange({ ttsSpeed: Number(event.target.value) })}
            disabled={disabled}
          >
            {speedOptions.map((speed) => (
              <option key={speed} value={speed}>
                {speed === 1 ? "1.0 倍速（原速）" : `${speed.toFixed(1)} 倍速`}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

interface RenderSetupStepProps {
  task: TaskState;
  speakers: string[];
  form: RenderFormState;
  engine: TtsEngineOption | undefined;
  meta: Meta | null;
  busy: boolean;
  error: string;
  onChange: (patch: Partial<RenderFormState>) => void;
  onVoiceChange: (speaker: string, voice: string) => void;
  onStart: () => void;
  onBack: () => void;
}

/** 第三步前半段：为角色选音色 */
export function RenderSetupStep(props: RenderSetupStepProps) {
  const { task, speakers, form, engine, meta, busy, error, onChange, onVoiceChange, onStart, onBack } = props;

  return (
    <Panel title="配音设置" desc="按角色选择音色；确认后开始配音、找素材并合成成片。" fill>
      <div className="panel-config">
        <VoiceOptions
          speakers={speakers}
          form={form}
          engine={engine}
          meta={meta}
          disabled={busy}
          onChange={onChange}
          onVoiceChange={onVoiceChange}
        />
        <p className="hint">素材来源与分辨率在下一步「素材确认」里选。</p>
      </div>

      <div className="kv">
        <span className="k">剧本</span>
        <span className="v">
          {editSummary(task)} · {speakers.length} 个角色
        </span>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
          返回上一步
        </button>
        <button className="primary" type="button" onClick={onStart} disabled={busy || speakers.length === 0}>
          开始配音
        </button>
      </div>
    </Panel>
  );
}
