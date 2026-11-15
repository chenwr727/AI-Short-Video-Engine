import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { num, type AppConfig } from "../config.js";
import type { TtsRequest } from "./tts.js";

/**
 * 豆包语音（火山引擎 Seed-TTS）：POST /api/v3/tts/unidirectional，
 * 响应是 NDJSON 流，每行一个事件，音频以 base64 分片下发：
 *   code 0 / 3000 → 音频分片；code 20000000 → 结束；其它 → 失败。
 * 因为 Node 的 fetch 在某些代理环境下会 ECONNRESET，保留 curl 作为兜底。
 */
const ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const DONE_CODE = 20000000;
const NETWORK_ERROR = /fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i;

interface SeedEvent {
  code?: number;
  message?: string;
  data?: string;
}

function readEvent(line: string, push: (chunk: Buffer) => void): "continue" | "done" {
  const text = line.trim();
  if (!text) return "continue";

  let event: SeedEvent;
  try {
    event = JSON.parse(text) as SeedEvent;
  } catch {
    // 非 JSON 行（心跳/日志）直接忽略
    return "continue";
  }

  if (event.code === DONE_CODE) return "done";
  if (event.code === 0 || event.code === 3000) {
    if (event.data) push(Buffer.from(event.data, "base64"));
    return "continue";
  }
  throw new Error(`豆包 TTS 合成失败（${event.code ?? "unknown"}）：${event.message ?? "未知错误"}`);
}

async function fetchSeed(body: string, headers: Record<string, string>, signal: AbortSignal): Promise<Buffer> {
  const res = await fetch(ENDPOINT, { method: "POST", headers, body, signal });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`豆包 TTS HTTP ${res.status}：${detail.slice(0, 300)}`);
  }
  if (!res.body) throw new Error("豆包 TTS 响应无数据流");

  const chunks: Buffer[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (readEvent(line, (chunk) => chunks.push(chunk)) === "done") {
        reader.releaseLock();
        return Buffer.concat(chunks);
      }
    }
  }

  if (chunks.length === 0) throw new Error("豆包 TTS 未返回音频数据");
  return Buffer.concat(chunks);
}

function curlSeed(body: string, headers: Record<string, string>, signal: AbortSignal): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const args = ["-sS", "-N", "-X", "POST", ENDPOINT];
    for (const [key, value] of Object.entries(headers)) args.push("-H", `${key}: ${value}`);
    args.push("--data-binary", body);

    const child = spawn("curl", args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";
    let buffer = "";
    let settled = false;

    const onAbort = () => finish(new DOMException("已取消", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      try {
        child.kill();
      } catch {
        // 进程已退出
      }
      if (error) reject(error);
      else if (chunks.length === 0) reject(new Error("豆包 TTS 未返回音频数据"));
      else resolve(Buffer.concat(chunks));
    }

    child.stdout.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (settled) return;
        try {
          if (readEvent(line, (chunk) => chunks.push(chunk)) === "done") {
            finish();
            return;
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
    });

    child.on("error", (error) => {
      finish(new Error(`豆包 TTS 调用 curl 失败：${error.message}`));
    });

    child.on("close", (code) => {
      finish(chunks.length > 0 ? undefined : new Error(`豆包 TTS curl 退出码 ${code}：${stderr.slice(0, 300)}`));
    });
  });
}

export async function synthesizeSeed(cfg: AppConfig, req: TtsRequest): Promise<Buffer> {
  if (!cfg.SEED_TTS_API_KEY) {
    throw new Error("未配置 SEED_TTS_API_KEY，无法使用豆包 TTS。请编辑 config.json 后重启应用");
  }

  const speed = num(cfg.TTS_SPEED, 1);
  const body = JSON.stringify({
    user: { uid: "ai-short-video-engine" },
    req_params: {
      text: req.text,
      speaker: req.voice,
      model: cfg.TTS_SEED_MODEL || "seed-tts-2.0-expressive",
      audio_params: {
        format: "mp3",
        sample_rate: 24000,
        speech_rate: Math.round((speed - 1) * 100) || 0,
      },
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": cfg.SEED_TTS_API_KEY,
    "X-Api-Resource-Id": cfg.TTS_SEED_RESOURCE_ID || "seed-tts-2.0",
    "X-Api-Request-Id": randomUUID(),
  };

  try {
    return await fetchSeed(body, headers, req.signal);
  } catch (error) {
    if (req.signal.aborted) throw new DOMException("已取消", "AbortError");

    const message = error instanceof Error ? error.message : String(error);
    if (!NETWORK_ERROR.test(message)) throw error;

    // 网络层失败才走 curl，业务错误（如鉴权失败）直接抛给上层重试逻辑
    return curlSeed(body, headers, req.signal);
  }
}
