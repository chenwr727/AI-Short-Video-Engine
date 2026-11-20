import { joinApiPath, loadConfig, type AppConfig } from "../config.js";

export interface ChatOptions {
  json?: boolean;
  temperature?: number;
  signal?: AbortSignal;
  retries?: number;
  timeoutMs?: number;
  /** 覆盖磁盘配置，供「测试连接」用未保存的值 */
  config?: AppConfig;
  /** 随消息一起发送的图片 URL，按数组顺序编号（第 1 张 = 1） */
  images?: string[];
}

interface TextPart {
  type: "text";
  text: string;
}

interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}

/** 有图片时走多模态内容数组，否则保持纯字符串 */
function userContent(user: string, images?: string[]): string | (TextPart | ImagePart)[] {
  if (!images || images.length === 0) return user;
  return [
    { type: "text", text: user },
    ...images.map((url): ImagePart => ({ type: "image_url", image_url: { url } })),
  ];
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("已取消", "AbortError"));
      },
      { once: true },
    );
  });
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

async function callOnce(cfg: AppConfig, system: string, user: string, opts: ChatOptions): Promise<string> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 180_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  const body: Record<string, unknown> = {
    model: cfg.LLM_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent(user, opts.images) },
    ],
  };
  if (opts.json) body.response_format = { type: "json_object" };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;

  // 允许只填域名或完整接口地址
  const trimmed = cfg.LLM_API_URL.replace(/\/+$/, "");
  const endpoint = /\/chat\/completions$/.test(trimmed) ? trimmed : joinApiPath(trimmed, "chat/completions");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LLM 请求失败（${res.status}）：${text.slice(0, 400)}`);
  }

  let data: ChatResponse;
  try {
    data = JSON.parse(text) as ChatResponse;
  } catch {
    throw new Error(`LLM 返回的不是合法 JSON：${text.slice(0, 200)}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content || !content.trim()) {
    throw new Error(`LLM 返回内容为空：${data.error?.message ?? text.slice(0, 200)}`);
  }
  return content;
}

/** 调用 chat/completions，失败时按退避重试 */
export async function chat(system: string, user: string, opts: ChatOptions = {}): Promise<string> {
  const cfg = opts.config ?? loadConfig();
  if (!cfg.LLM_API_KEY) {
    throw new Error("未配置 LLM_API_KEY，请编辑 config.json 后重启应用");
  }

  const retries = opts.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callOnce(cfg, system, user, opts);
    } catch (e) {
      lastError = e;
      if (opts.signal?.aborted) throw e;
      if (attempt < retries) await sleep(1500 * (attempt + 1), opts.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 抽出第一个完整 JSON 数组 */
export function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 抽出第一个完整 JSON 对象，容忍代码块包裹与多余文字 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
