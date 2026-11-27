import type { Meta } from "../types";
import { Dropdown } from "./Dropdown";
import type { FormState } from "./stepTypes";

/** 脚本风格与角色名 */
export function ScriptOptions({
  meta,
  form,
  onChange,
  disabled,
}: {
  meta: Meta | null;
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  disabled: boolean;
}) {
  const style = meta?.promptSources.find((option) => option.id === form.promptSource);
  // 单人风格不显示追问角色
  const soloStyle = (style?.speakers ?? 2) < 2;

  return (
    <div className="row row-3">
      <div className="field">
        <label htmlFor="prompt-source">脚本风格</label>
        <Dropdown
          id="prompt-source"
          value={form.promptSource}
          options={(meta?.promptSources ?? []).map((option) => ({ value: option.id, label: option.label }))}
          onChange={(next) => onChange({ promptSource: next })}
          disabled={disabled}
        />
        {/* 占位保持高度，避免切换风格时跳动 */}
        <span className="field-hint">{style?.description ?? "　"}</span>
      </div>

      <div className="field">
        <label htmlFor="speaker-main">主讲角色名</label>
        <input
          id="speaker-main"
          className="text-input"
          value={form.speakerMain}
          onChange={(event) => onChange({ speakerMain: event.target.value })}
          placeholder={meta?.speakers.main ?? "小简"}
          maxLength={8}
          disabled={disabled}
        />
        <span className="field-hint">默认取自设置</span>
      </div>

      {!soloStyle && (
        <div className="field">
          <label htmlFor="speaker-guest">追问角色名</label>
          <input
            id="speaker-guest"
            className="text-input"
            value={form.speakerGuest}
            onChange={(event) => onChange({ speakerGuest: event.target.value })}
            placeholder={meta?.speakers.guest ?? "老陈"}
            maxLength={8}
            disabled={disabled}
          />
          <span className="field-hint">留空用默认角色名</span>
        </div>
      )}
    </div>
  );
}
