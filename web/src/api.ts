import type { Health, MaterialInfo, Meta, RawTranscript, TaskState } from "./types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit, errMsg = "请求失败"): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${errMsg}：${res.status}`);
  }
  return (await res.json()) as T;
}

export function getHealth(): Promise<Health> {
  return request<Health>("/health", undefined, "无法连接后端");
}

export function getMeta(): Promise<Meta> {
  return request<Meta>("/meta", undefined, "获取配置项失败");
}

export interface GeneratePayload {
  input: string;
  promptSource: string;
  /** 剧本里的两个角色名（主讲 / 追问） */
  speakers: { main: string; guest: string };
  ttsEngine: string;
  voice: string;
  materialSource: string;
  resolution: string;
}

export async function getTask(): Promise<TaskState | null> {
  const data = await request<{ state: TaskState | null }>("/task", undefined, "获取任务失败");
  return data.state;
}

export async function startGenerate(payload: GeneratePayload): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/generate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "创建任务失败",
  );
  return data.state;
}

/** 用同一份输入重新生成剧本；speakers 传空值则沿用任务原来的角色名 */
export async function regenerateScript(speakers?: { main?: string; guest?: string }): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/regenerate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speakers }),
    },
    "重新生成剧本失败",
  );
  return data.state;
}

export interface ConfirmPayload {
  transcript: RawTranscript;
  options?: {
    ttsEngine?: string;
    voices?: Record<string, string>;
    /** 配音语速，1 = 原速 */
    ttsSpeed?: number;
    materialSource?: string;
    resolution?: string;
  };
}

export async function confirmScript(payload: ConfirmPayload): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/confirm",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "确认剧本失败",
  );
  return data.state;
}

/** 确认素材（只提交手动换过的段与分辨率），随后开始合成 */
export async function confirmMaterial(
  items: (MaterialInfo & { paragraph: number })[] = [],
  resolution?: string,
): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/material",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, resolution }),
    },
    "确认素材失败",
  );
  return data.state;
}

/** 重新检索某一段的候选素材 */
export async function searchMaterial(paragraph: number, terms?: string[]): Promise<MaterialInfo[]> {
  const data = await request<{ candidates: MaterialInfo[] }>(
    "/task/material/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paragraph, terms }),
    },
    "检索候选素材失败",
  );
  return data.candidates;
}

/** 某段素材的本地预览地址；带上素材 url 做版本，换素材后播放器才会重新加载 */
export function materialPreviewUrl(paragraph: number, version?: string): string {
  return `${BASE}/material/${paragraph}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}

/** 素材确认页：按台词检索并匹配素材（可先指定素材来源） */
export async function matchMaterial(materialSource?: string): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/material/match",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialSource }),
    },
    "匹配素材失败",
  );
  return data.state;
}

/** 成片预览页的渲染参数（字号 / BGM 开关 / 自定义音乐） */
export interface RenderPatch {
  subtitleFontSize: number;
  bgmEnabled: boolean;
  bgmVolume: number;
  bgmFile: string;
}

/** 点「生成成片 / 重新生成」：按当前参数跑合成，配音与素材命中缓存 */
export async function renderVideo(patch: RenderPatch): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/render",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    "生成成片失败",
  );
  return data.state;
}

/** 重试失败的任务：沿用原工作目录，已完成的阶段会命中缓存 */
export async function retryTask(): Promise<TaskState> {
  const data = await request<{ state: TaskState }>("/task/retry", { method: "POST" }, "重试失败");
  return data.state;
}

export async function cancelTask(): Promise<TaskState> {
  const data = await request<{ state: TaskState }>("/task/cancel", { method: "POST" }, "取消失败");
  return data.state;
}

/** 订阅任务快照；EventSource 断线会自动重连 */
export function subscribeTask(onState: (state: TaskState | null) => void): () => void {
  const es = new EventSource(`${BASE}/stream`);
  es.addEventListener("snapshot", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as { state: TaskState | null };
      onState(data.state);
    } catch {
      // 忽略坏帧，等下一次快照
    }
  });
  es.onerror = () => {
    // 交给浏览器自动重连
  };
  return () => es.close();
}
