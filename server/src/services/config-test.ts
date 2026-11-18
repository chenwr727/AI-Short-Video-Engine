import type { AppConfig } from "../config.js";
import { chat } from "./llm.js";
import { synthesizeCosyvoice } from "./tts-cosyvoice.js";

export type TestTarget = "llm" | "dashscope";

export interface TestResult {
  ok: boolean;
  ms: number;
  message: string;
}

const PROBE_VOICE = "longwan_v3";
const PROBE_TEXT = "连接测试";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function testLlm(cfg: AppConfig): Promise<TestResult> {
  if (!cfg.LLM_API_KEY) return { ok: false, ms: 0, message: "未填 API Key" };
  if (!cfg.LLM_API_URL) return { ok: false, ms: 0, message: "未填接口地址" };
  if (!cfg.LLM_MODEL) return { ok: false, ms: 0, message: "未填模型" };

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
    return { ok: true, ms, message: `${cfg.LLM_MODEL} 返回「${content.trim().slice(0, 20)}」` };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, message: reason(e).slice(0, 300) };
  }
}

async function testDashscope(cfg: AppConfig): Promise<TestResult> {
  if (!cfg.DASHSCOPE_API_KEY) return { ok: false, ms: 0, message: "未填 API Key" };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    // 走真实合成链路，与配音行为一致
    const audio = await synthesizeCosyvoice(cfg, {
      text: PROBE_TEXT,
      voice: PROBE_VOICE,
      signal: controller.signal,
    });
    const ms = Date.now() - started;
    if (!audio.length) return { ok: false, ms, message: "连上了但没返回音频数据" };
    return { ok: true, ms, message: `合成 ${Math.round(audio.length / 1024)} KB 试听音频` };
  } catch (e) {
    const ms = Date.now() - started;
    const text = controller.signal.aborted ? "测试超时（30s）" : reason(e);
    return { ok: false, ms, message: text.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

export function runConfigTest(target: TestTarget, cfg: AppConfig): Promise<TestResult> {
  return target === "llm" ? testLlm(cfg) : testDashscope(cfg);
}
