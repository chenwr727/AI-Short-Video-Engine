import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { useT } from "../i18n";
import type { Health } from "../types";
import { useConfirm } from "./ConfirmDialog";

/** 一项是一组能力，组内为「或」关系 */
interface EnvItem {
  /** 稳定标识，用作列表 key；不随语言变化 */
  id: string;
  label: string;
  ok: boolean;
  /** 缺失时提示补救办法，就绪时为可用档位 */
  note: string;
}

function envItems(health: Health, t: ReturnType<typeof useT>): EnvItem[] {
  const { config, deps } = health;
  const engines = [
    config.tts.edge && t("tts.engineEdge"),
    config.tts.dashscope && "CosyVoice",
    config.tts.seed && t("tts.engineDoubao"),
  ].filter((name): name is string => Boolean(name));
  const sources = [config.material.pixabay && "Pixabay", config.material.pexels && "Pexels"].filter(
    (name): name is string => Boolean(name),
  );

  return [
    {
      id: "llm",
      label: "LLM",
      ok: config.llm.configured,
      note: config.llm.configured ? "" : t("env.needLlm"),
    },
    {
      id: "ffmpeg",
      label: "ffmpeg",
      ok: Boolean(deps.ffmpeg),
      note: deps.ffmpeg ? "" : t("env.ffmpegMissing"),
    },
    {
      id: "tts",
      label: t("env.voiceEngine"),
      ok: engines.length > 0,
      note: engines.length > 0 ? t("tts.available", { list: engines.join(" · ") }) : t("env.needTts"),
    },
    {
      id: "material",
      label: t("env.materialSource"),
      ok: sources.length > 0,
      note: sources.length > 0 ? t("material.sourceAvailable", { list: sources.join(" · ") }) : t("env.needMaterial"),
    },
  ];
}

/** 环境状态，仅有缺项时显示 */
export function EnvStatus({ health }: { health: Health | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // 打不开设置时的提示
  const { alert, dialog } = useConfirm();

  useEffect(() => {
    if (!open) return;

    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!health) return <span className="pill">{t("stage.connecting")}</span>;

  const items = envItems(health, t);
  const missing = items.filter((item) => !item.ok);

  if (missing.length === 0) return null;

  const summary =
    missing.length === 1
      ? t("env.missingOne", { label: missing[0]?.label ?? "" })
      : t("env.missing", { n: missing.length });

  async function openSettings() {
    setOpen(false);
    const api = bridge();
    if (!api) {
      await alert({ title: "common.notice", body: "common.settingsDesktopOnly" });
      return;
    }
    try {
      const res = await api.menu("settings");
      if (!res.ok) {
        await alert({ title: "common.operationFailed", body: { raw: res.error ?? t("error.settings") } });
      }
    } catch (error) {
      await alert({
        title: "common.operationFailed",
        body: { raw: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  return (
    <div className="env" ref={wrapRef}>
      <button
        type="button"
        className="env-pill bad"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        title={missing.map((item) => `${item.label}：${item.note}`).join("\n")}
      >
        <span className="dot" />
        {summary}
      </button>

      {open && (
        <div className="env-pop" role="dialog" aria-label={t("env.title")}>
          <div className="env-pop-head">{t("env.title")}</div>
          <ul className="env-list">
            {items.map((item) => (
              <li key={item.id} className={`env-item ${item.ok ? "ok" : "missing"}`}>
                <span className="env-name">{item.label}</span>
                <span className="env-state">{item.ok ? t("common.ready") : t("common.notConfigured")}</span>
                {item.note && <span className="env-note">{item.note}</span>}
              </li>
            ))}
          </ul>
          <button type="button" className="env-settings" onClick={() => void openSettings()}>
            {t("stage.openSettings")}
          </button>
        </div>
      )}
      {dialog}
    </div>
  );
}
