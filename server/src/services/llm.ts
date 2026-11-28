import { bool, joinApiPath, loadConfig, type AppConfig } from "../config.js";
import { userError } from "../errors.js";

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
  /** 输出上限，缺省 8192 */
  maxTokens?: number;
  thinking?: boolean;
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
  return [{ type: "text", text: user }, ...images.map((url): ImagePart => ({ type: "image_url", image_url: { url } }))];
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
  choices?: {
    message?: {
      content?: string;
      reasoning_content?: string;
    };
    finish_reason?: string;
  }[];
  usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  error?: { message?: string };
}

/** 思考也占额度，给少了正文为空 */
const DEFAULT_MAX_TOKENS = 8192;
/** 可用 SHORTDECK_LLM_MAX_TOKENS 覆盖 */
const MAX_TOKENS_CAP = (() => {
  const value = Number(process.env.SHORTDECK_LLM_MAX_TOKENS);
  return Number.isFinite(value) && value >= 512 ? Math.floor(value) : 32768;
})();

function defaultMaxTokens(): number {
  return Math.min(DEFAULT_MAX_TOKENS, MAX_TOKENS_CAP);
}

/** 各家关思考的写法不同，一并发出 */
const THINKING_OFF = {
  enable_thinking: false,
  thinking: { type: "disabled" },
  chat_template_kwargs: { thinking: false },
} as const;

/** 不接受关思考参数的端点 */
const thinkingStrictEndpoints = new Set<string>();

class EmptyReplyError extends Error {
  constructor(
    message: string,
    readonly nextMaxTokens?: number,
  ) {
    super(message);
    this.name = "EmptyReplyError";
  }
}

async function callOnce(cfg: AppConfig, system: string, user: string, opts: ChatOptions): Promise<string> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 180_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  // 允许只填域名或完整接口地址
  const trimmed = cfg.LLM_API_URL.replace(/\/+$/, "");
  const endpoint = /\/chat\/completions$/.test(trimmed) ? trimmed : joinApiPath(trimmed, "chat/completions");

  const body: Record<string, unknown> = {
    model: cfg.LLM_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent(user, opts.images) },
    ],
  };
  if (opts.json) body.response_format = { type: "json_object" };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  // 服务端默认值太小会把长 JSON 截断，必须显式给
  const maxTokens = Math.min(opts.maxTokens ?? defaultMaxTokens(), MAX_TOKENS_CAP);
  body.max_tokens = maxTokens;

  const wantThinking = opts.thinking ?? bool(cfg.LLM_THINKING, false);
  const canAskOff = !wantThinking && !thinkingStrictEndpoints.has(endpoint);
  if (canAskOff) Object.assign(body, THINKING_OFF);

  const send = () =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.LLM_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal,
    });

  let res = await send();
  let text = await res.text();
  // 网关不认这些字段时整组剥掉重发
  if (res.status === 400 && canAskOff) {
    thinkingStrictEndpoints.add(endpoint);
    for (const key of Object.keys(THINKING_OFF)) delete body[key];
    res = await send();
    text = await res.text();
  }
  if (!res.ok) {
    throw userError("llmHttp", 500, { status: res.status, detail: text.slice(0, 400) });
  }

  let data: ChatResponse;
  try {
    data = JSON.parse(text) as ChatResponse;
  } catch {
    throw userError("llmBadJson", 500, { detail: text.slice(0, 200) });
  }

  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";
  if (content.trim()) return content;

  const finish = choice?.finish_reason ?? "unknown";
  const reasoning = choice?.message?.reasoning_content ?? "";
  const completionTokens = data.usage?.completion_tokens;
  const reasonTokens = data.usage?.completion_tokens_details?.reasoning_tokens;
  const detail = [
    `finish_reason=${finish}`,
    `max_tokens=${maxTokens}`,
    completionTokens ? `completion_tokens=${completionTokens}` : "",
    reasoning.trim() ? `推理 ${reasoning.length} 字` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // 额度被思考吃光或被截断，放大额度重试
  const outOfBudget = finish === "length" || Boolean(reasoning.trim()) || (reasonTokens ?? 0) > 0;
  if (outOfBudget) {
    const next = Math.min(maxTokens * 2, MAX_TOKENS_CAP);
    throw new EmptyReplyError(
      `LLM 返回内容为空（${detail}）：思考过程占满了输出额度`,
      next > maxTokens ? next : undefined,
    );
  }

  throw new EmptyReplyError(`LLM 返回内容为空（${detail}）：${data.error?.message ?? text.slice(0, 200)}`);
}

/** 调用 chat/completions，失败时按退避重试 */
export async function chat(system: string, user: string, opts: ChatOptions = {}): Promise<string> {
  const cfg = opts.config ?? loadConfig();
  if (!cfg.LLM_API_KEY) {
    throw userError("noLlmKey", 500);
  }

  const retries = opts.retries ?? 2;
  let lastError: unknown;
  let maxTokens = opts.maxTokens;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await callOnce(cfg, system, user, { ...opts, maxTokens });
    } catch (e) {
      lastError = e;
      if (opts.signal?.aborted) throw e;
      if (e instanceof EmptyReplyError && e.nextMaxTokens) maxTokens = e.nextMaxTokens;
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
