import type {
  CardPrefs,
  CardSpec,
  Health,
  MaterialInfo,
  Meta,
  PromptDoc,
  PromptSummary,
  PromptValue,
  RawTranscript,
  TaskState,
} from "./types";

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
  /** 主讲 / 追问 */
  speakers: { main: string; guest: string };
  ttsEngine: string;
  voice: string;
  materialSource: string;
  /** 素材匹配完成后顺带配信息卡；缺省 true */
  autoInfoCards?: boolean;
  resolution: string;
}

export interface PromptCatalog {
  docs: PromptDoc[];
  values: PromptSummary[];
}

export function getPrompts(): Promise<PromptCatalog> {
  return request<PromptCatalog>("/prompts", undefined, "读取提示词失败");
}

/** 详情带内置默认值，用来对比与恢复 */
export function getPrompt(file: string, key: string): Promise<PromptValue> {
  const query = `?file=${encodeURIComponent(file)}&key=${encodeURIComponent(key)}`;
  return request<PromptValue>(`/prompts/one${query}`, undefined, "读取提示词失败");
}

export async function savePrompt(file: string, key: string, value: string): Promise<PromptValue> {
  return request<PromptValue>(
    "/prompts",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, key, value }),
    },
    "保存提示词失败",
  );
}

export async function resetPrompt(file: string, key: string): Promise<PromptValue> {
  return request<PromptValue>(
    "/prompts/reset",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, key }),
    },
    "恢复默认失败",
  );
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

/** 未传的字段沿用原值 */
export async function regenerateScript(patch: {
  input?: string;
  promptSource?: string;
  speakers?: { main?: string; guest?: string };
}): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/regenerate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
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
    /** 素材匹配后是否配信息卡 */
    autoInfoCards?: boolean;
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

/** 台词不动，按新引擎/音色/语速重做配音 */
export async function regenerateTts(patch: ConfirmPayload["options"] = {}): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/tts/regenerate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options: patch }),
    },
    "重新生成配音失败",
  );
  return data.state;
}

/** 提交手动换过的段与分辨率；cardPrefs 是素材页里选的片头/章节/片尾参数 */
export async function confirmMaterial(
  items: (MaterialInfo & { paragraph: number })[] = [],
  resolution?: string,
  cardPrefs?: CardPrefs,
): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/material",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, resolution, cardPrefs }),
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

/** 带版本号，换素材后播放器才会重新加载 */
export function materialPreviewUrl(paragraph: number, version?: string): string {
  return `${BASE}/material/${paragraph}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}

/**
 * 把某段画面换成信息卡。
 * template 留空由模型判断该段适合哪种卡；指定时按该模板生成。
 */
export async function applyInfoCard(paragraph: number, template?: string): Promise<TaskState> {
  const data = await request<{ card: CardSpec; state: TaskState }>(
    "/task/material/info-card",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paragraph, template }),
    },
    "生成信息卡失败",
  );
  return data.state;
}

/** 撤掉信息卡，回到实拍素材 */
export async function clearInfoCard(paragraph: number): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/material/info-card/clear",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paragraph }),
    },
    "撤销信息卡失败",
  );
  return data.state;
}

/** 一键配置结果：哪几段配上了、哪几段跳过、哪几段失败 */
export interface AutoInfoCardResult {
  applied: number[];
  skipped: number[];
  failed: { paragraph: number; reason: string }[];
  state: TaskState;
}

/**
 * 一键配置信息卡：逐段判断哪几段适合，适合的自动生成。
 * overwrite = 连已有的也重做（会重新调 AI，慢一些）。
 */
export async function applyInfoCardsAuto(overwrite = false): Promise<AutoInfoCardResult> {
  return request<AutoInfoCardResult>(
    "/task/material/info-card/auto",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overwrite }),
    },
    "一键配置信息卡失败",
  );
}

/** 卡片静帧；指纹变了 URL 也变，避免浏览器吃旧图 */
export function cardStillUrl(id: string, fingerprint?: string): string {
  return `${BASE}/card/${encodeURIComponent(id)}/still${fingerprint ? `?v=${fingerprint}` : ""}`;
}

/** 换一张：text = AI 重写文案，accent = 换配色 */
export async function rewriteCard(id: string, mode: "text" | "accent"): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/cards/rewrite",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, mode }),
    },
    "换版式失败",
  );
  return data.state;
}

/** 分辨率一起传，检索才按新画幅筛选 */
export async function matchMaterial(
  patch: { materialSource?: string; resolution?: string; autoInfoCards?: boolean; force?: boolean } = {},
): Promise<TaskState> {
  const data = await request<{ state: TaskState }>(
    "/task/material/match",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    "匹配素材失败",
  );
  return data.state;
}

/** 字号 / BGM 开关 / 自定义音乐 */
export interface RenderPatch {
  subtitleFontSize: number;
  bgmEnabled: boolean;
  bgmVolume: number;
  bgmFile: string;
}

/** 配音与素材命中缓存时只重跑合成 */
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

/** 沿用原工作目录，已完成阶段命中缓存 */
export async function retryTask(): Promise<TaskState> {
  const data = await request<{ state: TaskState }>("/task/retry", { method: "POST" }, "重试失败");
  return data.state;
}

export async function cancelTask(): Promise<TaskState> {
  const data = await request<{ state: TaskState }>("/task/cancel", { method: "POST" }, "取消失败");
  return data.state;
}

/** onReconnect 在断开后又连上时触发 */
export function subscribeTask(onState: (state: TaskState | null) => void, onReconnect?: () => void): () => void {
  const es = new EventSource(`${BASE}/stream`);
  let opened = false;
  es.onopen = () => {
    if (opened) onReconnect?.();
    opened = true;
  };
  es.addEventListener("snapshot", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as { state: TaskState | null };
      onState(data.state);
    } catch {
      // 忽略坏帧
    }
  });
  return () => es.close();
}
