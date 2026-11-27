import { useT } from "../i18n";
import type { Meta, TaskState, TtsEngineOption } from "../types";
import { Dropdown } from "./Dropdown";
import { Panel } from "./Panel";
import type { RenderFormState } from "./stepTypes";

/** 常用语速档位，其它值临时插入 */
const SPEED_OPTIONS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5];

function editSummary(task: TaskState, t: ReturnType<typeof useT>): string {
  const transcript = task.transcript;
  if (!transcript) return t("common.notGenerated");
  return t("script.summary", { title: transcript.title || t("script.unnamed"), n: transcript.paragraphs.length });
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
  const t = useT();
  // 语速不在常用档位时临时插入，避免下拉为空
  const speedOptions =
    form.ttsSpeed > 0 && !SPEED_OPTIONS.includes(form.ttsSpeed)
      ? [...SPEED_OPTIONS, form.ttsSpeed].sort((a, b) => a - b)
      : SPEED_OPTIONS;

  return (
    <>
      <div className="voice-list">
        {speakers.length === 0 && <p className="hint">{t("render.noSpeakers")}</p>}
        {speakers.map((speaker) => (
          <div className="voice-row" key={speaker}>
            <span className="speaker">{speaker}</span>
            <Dropdown
              value={form.voices[speaker] ?? ""}
              options={(engine?.voices ?? []).map((voice) => ({ value: voice.id, label: voice.label }))}
              onChange={(next) => onVoiceChange(speaker, next)}
              disabled={disabled}
            />
          </div>
        ))}
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="tts-engine">{t("tts.engine")}</label>
          <Dropdown
            id="tts-engine"
            value={form.ttsEngine}
            options={(meta?.ttsEngines ?? []).map((option) => ({ value: option.id, label: option.label }))}
            onChange={(next) => onChange({ ttsEngine: next })}
            disabled={disabled}
          />
          {engine?.description && <span className="field-hint">{engine.description}</span>}
        </div>

        <div className="field">
          <label htmlFor="tts-speed">{t("tts.speedLabel")}</label>
          <Dropdown
            id="tts-speed"
            value={String(form.ttsSpeed)}
            options={speedOptions.map((speed) => ({
              value: String(speed),
              label: speed === 1 ? t("tts.speedOriginal") : t("tts.speed", { v: speed.toFixed(1) }),
            }))}
            onChange={(next) => onChange({ ttsSpeed: Number(next) })}
            disabled={disabled}
          />
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
  const t = useT();

  return (
    <Panel title={t("tts.settings")} desc={t("tts.hint2")} fill>
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
      </div>

      <div className="kv">
        <span className="k">{t("render.scriptLabel")}</span>
        <span className="v">
          {editSummary(task, t)} · {t("tts.characters", { n: speakers.length })}
        </span>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="panel-actions">
        <button className="secondary btn-back" type="button" onClick={onBack} disabled={busy}>
          {t("common.back")}
        </button>
        <button className="primary" type="button" onClick={onStart} disabled={busy || speakers.length === 0}>
          {t("tts.startShort")}
        </button>
      </div>
    </Panel>
  );
}
