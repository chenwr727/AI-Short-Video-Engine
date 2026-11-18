import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import type { Health } from "../types";

/** 一项是一组能力，组内为「或」关系 */
interface EnvItem {
  label: string;
  ok: boolean;
  /** 缺失时提示补救办法，就绪时为可用档位 */
  note: string;
}

function envItems(health: Health): EnvItem[] {
  const { config, deps } = health;
  const engines = [
    config.tts.edge && "Edge 语音",
    config.tts.dashscope && "CosyVoice",
    config.tts.seed && "豆包 Seed-TTS",
  ].filter((name): name is string => Boolean(name));
  const sources = [config.material.pixabay && "Pixabay", config.material.pexels && "Pexels"].filter(
    (name): name is string => Boolean(name),
  );

  return [
    {
      label: "LLM",
      ok: config.llm.configured,
      note: config.llm.configured ? "" : "未配置 API Key，无法生成剧本",
    },
    {
      label: "ffmpeg",
      ok: Boolean(deps.ffmpeg),
      note: deps.ffmpeg ? "" : "未检测到，合成视频会失败",
    },
    {
      label: "配音引擎",
      ok: engines.length > 0,
      note: engines.length > 0 ? `可用：${engines.join(" · ")}` : "Edge 语音 / CosyVoice / 豆包 Seed-TTS 至少配一个",
    },
    {
      label: "素材源",
      ok: sources.length > 0,
      note: sources.length > 0 ? `可用：${sources.join(" · ")}` : "Pixabay / Pexels 至少配一个 Key，否则匹配素材会失败",
    },
  ];
}

/** 环境状态，仅有缺项时显示 */
export function EnvStatus({ health }: { health: Health | null }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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

  if (!health) return <span className="pill">连接中…</span>;

  const items = envItems(health);
  const missing = items.filter((item) => !item.ok);

  if (missing.length === 0) return null;

  const summary = missing.length === 1 ? `${missing[0]?.label}未配置` : `${missing.length} 项未配置`;

  async function openSettings() {
    setOpen(false);
    const api = bridge();
    if (!api) {
      window.alert("设置只在桌面应用里可用，浏览器里请直接改配置文件。");
      return;
    }
    try {
      const res = await api.menu("settings");
      if (!res.ok) window.alert(res.error ?? "打开设置失败");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
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
        <div className="env-pop" role="dialog" aria-label="运行环境">
          <div className="env-pop-head">运行环境</div>
          <ul className="env-list">
            {items.map((item) => (
              <li key={item.label} className={`env-item ${item.ok ? "ok" : "missing"}`}>
                <span className="env-name">{item.label}</span>
                <span className="env-state">{item.ok ? "就绪" : "未配置"}</span>
                {item.note && <span className="env-note">{item.note}</span>}
              </li>
            ))}
          </ul>
          <button type="button" className="env-settings" onClick={() => void openSettings()}>
            打开设置…
          </button>
        </div>
      )}
    </div>
  );
}
