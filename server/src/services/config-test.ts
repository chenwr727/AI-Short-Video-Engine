import type { AppConfig } from "../config.js";
import { pick, type Lang } from "../i18n.js";
import { chat } from "./llm.js";
import { synthesizeCosyvoice } from "./tts-cosyvoice.js";

export type TestTarget = "llm" | "dashscope";

export interface TestResult {
  ok: boolean;
  ms: number;
  message: string;
}

const PROBE_VOICE = "longwan_v3";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const MISSING_KEY = { zh: "未填 API Key", en: "API key is empty" };
const MISSING_URL = { zh: "未填接口地址", en: "Endpoint URL is empty" };
const MISSING_MODEL = { zh: "未填模型", en: "Model is empty" };

async function testLlm(cfg: AppConfig, lang: Lang): Promise<TestResult> {
  if (!cfg.LLM_API_KEY) return { ok: false, ms: 0, message: pick(lang, MISSING_KEY) };
  if (!cfg.LLM_API_URL) return { ok: false, ms: 0, message: pick(lang, MISSING_URL) };
  if (!cfg.LLM_MODEL) return { ok: false, ms: 0, message: pick(lang, MISSING_MODEL) };

  const started = Date.now();
  try {
    // 不重试，避免掩盖真实错误
    const content = await chat("你是连通性测试助手，只回复 OK。", "请回复 OK", {
      config: cfg,
      retries: 0,
      timeoutMs: 20_000,
      temperature: 0,
    });
    const ms = Date.now() - started;
    const echo = content.trim().slice(0, 20);
    const message = lang === "en" ? `${cfg.LLM_MODEL} returned “${echo}”` : `${cfg.LLM_MODEL} 返回「${echo}」`;
    return { ok: true, ms, message };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, message: reason(e).slice(0, 300) };
  }
}

async function testDashscope(cfg: AppConfig, lang: Lang): Promise<TestResult> {
  if (!cfg.DASHSCOPE_API_KEY) return { ok: false, ms: 0, message: pick(lang, MISSING_KEY) };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    // 走真实合成链路，与配音行为一致
    const audio = await synthesizeCosyvoice(cfg, {
      // 探针文本只用中文：这是合成引擎的连通性测试，与界面语言无关
      text: "连接测试",
      voice: PROBE_VOICE,
      signal: controller.signal,
    });
    const ms = Date.now() - started;
    if (!audio.length) {
      const message = lang === "en" ? "Connected, but no audio data returned" : "连上了但没返回音频数据";
      return { ok: false, ms, message };
    }
    const size = Math.round(audio.length / 1024);
    const message = lang === "en" ? `Synthesized ${size} KB of sample audio` : `合成 ${size} KB 试听音频`;
    return { ok: true, ms, message };
  } catch (e) {
    const ms = Date.now() - started;
    const timeout = lang === "en" ? "Timed out (30s)" : "测试超时（30s）";
    const text = controller.signal.aborted ? timeout : reason(e);
    return { ok: false, ms, message: text.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

export function runConfigTest(target: TestTarget, cfg: AppConfig, lang: Lang = "zh"): Promise<TestResult> {
  return target === "llm" ? testLlm(cfg, lang) : testDashscope(cfg, lang);
}
