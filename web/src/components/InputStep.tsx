import type { FormState } from "./stepTypes";
import { Panel } from "./Panel";

interface InputStepProps {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  canNext: boolean;
  running: boolean;
  awaiting: boolean;
  error: string;
  /** 有剧本时才允许整条重跑 */
  canRegenerate: boolean;
  onRegenerate: () => void;
  busy: boolean;
  onNext: () => void;
}

export function InputStep(props: InputStepProps) {
  const { form, onChange, canNext, running, awaiting, error, canRegenerate, onRegenerate, busy, onNext } =
    props;
  const empty = !form.content.trim();

  return (
    <Panel title="文案脚本" desc="输入网页链接或正文；下一步再定脚本风格与角色名，然后手动开始生成。" fill>
      <div className="field field-grow">
        <div className="field-head">
          <label htmlFor="content">内容（网页 URL 或正文）</label>
          {form.content.trim() && <span className="field-count">{form.content.trim().length} 字</span>}
        </div>
        <textarea
          id="content"
          className="textarea-main"
          value={form.content}
          onChange={(event) => onChange({ content: event.target.value })}
          placeholder="例如：https://36kr.com/p/xxxxx　或直接粘贴文章正文"
          disabled={running}
        />
        <span className="field-hint">支持文章链接（自动抓正文）或直接粘贴文字；内容越具体，剧本越贴题。</span>
      </div>

      {awaiting && (
        <p className="hint">
          剧本已生成但还没确认：改完上面的内容点「重新生成」会整条重写；只想换风格或角色名，去「剧本生成」。
        </p>
      )}
      {error && <div className="alert">{error}</div>}

      <div className="panel-actions">
        <span className="action-hint">
          {running
            ? "正在跑，跑完会自动切到剧本页"
            : awaiting
              ? "剧本在等你确认"
              : empty
                ? "先填入链接或正文"
                : "下一步选脚本风格与角色名，确认后才开始写稿"}
        </span>
        {canRegenerate && (
          <button
            className="secondary"
            type="button"
            onClick={onRegenerate}
            disabled={busy}
            title="丢弃当前剧本以及已生成的配音、素材与成片，按上面的内容重新走一遍全流程"
          >
            重新生成
          </button>
        )}
        <button className="primary" type="button" onClick={onNext} disabled={!canNext}>
          下一步：剧本生成
        </button>
      </div>
    </Panel>
  );
}
