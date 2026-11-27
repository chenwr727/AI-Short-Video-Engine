import type { Meta } from "../types";
import { useT } from "../i18n";
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
  const t = useT();
  const style = meta?.promptSources.find((option) => option.id === form.promptSource);
  // 单人风格不显示追问角色
  const soloStyle = (style?.speakers ?? 2) < 2;

  return (
    <div className="row row-3">
      <div className="field">
        <label htmlFor="prompt-source">{t("script.styleLabel")}</label>
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
        <label htmlFor="speaker-main">{t("script.mainLabel")}</label>
        <input
          id="speaker-main"
          className="text-input"
          value={form.speakerMain}
          onChange={(event) => onChange({ speakerMain: event.target.value })}
          placeholder={meta?.speakers.main ?? t("script.speakerMain")}
          maxLength={8}
          disabled={disabled}
        />
        <span className="field-hint">{t("script.fromSettings")}</span>
      </div>

      {!soloStyle && (
        <div className="field">
          <label htmlFor="speaker-guest">{t("script.guestLabel")}</label>
          <input
            id="speaker-guest"
            className="text-input"
            value={form.speakerGuest}
            onChange={(event) => onChange({ speakerGuest: event.target.value })}
            placeholder={meta?.speakers.guest ?? t("script.speakerGuest")}
            maxLength={8}
            disabled={disabled}
          />
          <span className="field-hint">{t("script.blankDefault")}</span>
        </div>
      )}
    </div>
  );
}
