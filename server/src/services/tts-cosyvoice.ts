import crypto from "node:crypto";
import WebSocket from "ws";
import type { AppConfig } from "../config.js";
import type { TtsRequest } from "./tts.js";

/** DASHSCOPE_WS_URL 优先，否则由 base url 推导 */
function wsEndpoint(cfg: AppConfig): string {
  if (cfg.DASHSCOPE_WS_URL) return cfg.DASHSCOPE_WS_URL;
  const base = cfg.DASHSCOPE_BASE_URL.replace(/\/+$/, "");
  if (base.includes("/api-ws/")) return base;
  return base.replace(/^http/, "ws").replace(/\/api\/v1$/, "/api-ws/v1/inference");
}

interface DashScopeEvent {
  header?: { event?: string; error_message?: string; error_code?: string };
  payload?: { message?: string };
}

/** 协议：run-task → task-started → continue-task → finish-task → 音频帧 */
export function synthesizeCosyvoice(cfg: AppConfig, req: TtsRequest): Promise<Buffer> {
  const endpoint = wsEndpoint(cfg);
  const taskId = crypto.randomUUID();
  const rate = Number(cfg.TTS_SPEED) > 0 ? Number(cfg.TTS_SPEED) : 1;

  // 多 workspace 需带业务空间，否则落到默认空间
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.DASHSCOPE_API_KEY}` };
  if (cfg.DASHSCOPE_WORKSPACE_ID) headers["X-DashScope-WorkSpace"] = cfg.DASHSCOPE_WORKSPACE_ID;

  return new Promise<Buffer>((resolve, reject) => {
    const socket = new WebSocket(endpoint, { headers });

    const chunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => finish(new Error("cosyvoice 合成超时（120s）")), 120_000);

    const onAbort = () => finish(new DOMException("已取消", "AbortError"));

    const cleanup = () => {
      clearTimeout(timer);
      req.signal.removeEventListener("abort", onAbort);
      try {
        socket.close();
      } catch {
        // 已关闭
      }
    };

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else if (chunks.length === 0) reject(new Error("cosyvoice 未返回音频数据"));
      else resolve(Buffer.concat(chunks));
    }

    req.signal.addEventListener("abort", onAbort, { once: true });

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          header: { action: "run-task", task_id: taskId, streaming: "duplex" },
          payload: {
            model: cfg.TTS_COSYVOICE_MODEL,
            task_group: "audio",
            task: "tts",
            function: "SpeechSynthesizer",
            input: {},
            parameters: {
              voice: req.voice,
              format: "wav",
              sample_rate: 24000,
              rate,
              text_type: "PlainText",
            },
          },
        }),
      );
    });

    socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
        return;
      }

      let event: DashScopeEvent;
      try {
        event = JSON.parse(data.toString()) as DashScopeEvent;
      } catch {
        return;
      }

      switch (event.header?.event) {
        case "task-started":
          socket.send(
            JSON.stringify({
              header: { action: "continue-task", task_id: taskId },
              payload: { input: { text: req.text } },
            }),
          );
          socket.send(
            JSON.stringify({
              header: { action: "finish-task", task_id: taskId },
              payload: { input: {} },
            }),
          );
          break;
        case "task-finished":
          finish();
          break;
        case "task-failed":
          finish(
            new Error(
              `cosyvoice 合成失败：${event.header?.error_code ?? ""} ${event.header?.error_message ?? event.payload?.message ?? "unknown"}`.trim(),
            ),
          );
          break;
        default:
          break;
      }
    });

    socket.on("error", (error) => finish(new Error(`cosyvoice 连接失败：${error.message}`)));
    socket.on("close", () => {
      if (!settled && chunks.length === 0) finish(new Error("cosyvoice 连接被提前关闭"));
    });
  });
}
