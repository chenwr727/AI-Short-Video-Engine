/**
 * 面向用户的文案表。
 *
 * 抛错处在流水线里，拿不到请求语言，所以这里存中英两份，由出口决定取哪份：
 * ERRORS 走 /api（请求语言），STAGE_TEXT 在写任务状态时定稿。
 */
import { pick, type Bilingual, type Lang } from "./i18n.js";

/** 插值变量：双语的值也允许，渲染时按请求语言取一份 */
export type ErrorVars = Record<string, string | number | Bilingual>;

/** 失败原因 → 中英对照，占位符用 {name} */
export const ERRORS = {
  // 任务生命周期
  busy: {
    zh: "已有任务未结束，请等待完成或先取消",
    en: "Another task is still running. Wait for it to finish or cancel it first.",
  },
  emptyInput: { zh: "内容不能为空", en: "Content can't be empty" },
  noTask: { zh: "当前没有任务", en: "There's no task yet" },
  badState: { zh: "任务状态异常", en: "The task state is inconsistent" },
  generating: {
    zh: "正在生成，等这一轮结束再重来",
    en: "Still generating. Wait for this round to finish.",
  },
  onlyFailedCanRetry: {
    zh: "只有失败或已停止的任务可以继续",
    en: "Only failed or stopped tasks can be continued",
  },
  nothingToCancel: {
    zh: "任务已结束，无需取消",
    en: "The task has already finished, nothing to cancel",
  },
  cancelled: { zh: "已取消", en: "Cancelled" },

  // 恢复上次任务时写进失败原因的提示（不抛异常，只用来展示）
  interrupted: {
    zh: "上次运行被中断，点「重试失败步骤」接着跑（已完成的阶段会命中缓存）",
    en: "The last run was interrupted. Retry to continue; finished stages are cached.",
  },
  audioMissing: {
    zh: "上次的配音产物也找不到了，请重新生成",
    en: "The previous voice-over files are gone too. Generate them again.",
  },

  // 剧本
  notAwaitingScript: {
    zh: "当前任务不在等待确认状态",
    en: "The task isn't waiting for script confirmation",
  },
  emptyTranscript: { zh: "剧本为空，无法确认", en: "The script is empty, nothing to confirm" },
  badParagraph: { zh: "段号不合法", en: "Invalid section number" },
  emptyLines: { zh: "台词内容为空", en: "The lines are empty" },
  scriptTopLevel: {
    zh: "剧本格式错误：顶层不是对象",
    en: "Bad script format: the top level isn't an object",
  },
  scriptNoParagraphs: {
    zh: "剧本格式错误：缺少 paragraphs",
    en: "Bad script format: `paragraphs` is missing",
  },
  scriptParagraphShape: {
    zh: "剧本格式错误：第 {n} 段不是对象",
    en: "Bad script format: section {n} isn't an object",
  },
  scriptParagraphEmpty: {
    zh: "剧本格式错误：第 {n} 段没有有效对话",
    en: "Bad script format: section {n} has no usable dialogue",
  },
  scriptNoDialogue: {
    zh: "剧本格式错误：没有有效对话",
    en: "Bad script format: no usable dialogue at all",
  },
  rewriteNoJson: {
    zh: "剧本改写失败：模型没有返回合法 JSON",
    en: "Script rewrite failed: the model didn't return valid JSON",
  },
  rewriteBadJson: {
    zh: "剧本改写失败：JSON 解析出错\n{detail}",
    en: "Script rewrite failed: the returned JSON doesn't parse\n{detail}",
  },

  // 配音
  noTranscriptForTts: {
    zh: "还没有剧本，无法生成配音",
    en: "No script yet, can't generate the voice-over",
  },
  ttsIncomplete: {
    zh: "配音还没完成，无法匹配素材",
    en: "The voice-over isn't ready, can't match footage",
  },
  noTtsEngine: { zh: "没有可用的 TTS 引擎", en: "No TTS engine available" },
  noVoice: {
    zh: "TTS 引擎 {engine} 没有可用音色",
    en: "TTS engine {engine} has no available voice",
  },
  noDashscopeKey: {
    zh: "未配置 DASHSCOPE_API_KEY，无法使用 CosyVoice 配音。请编辑 config.json 后重启应用，或改用 Edge 在线语音",
    en: "DASHSCOPE_API_KEY isn't set, so CosyVoice can't be used. Edit config.json and restart, or switch to Edge online voices.",
  },
  noSeedKey: {
    zh: "未配置 SEED_TTS_API_KEY，无法使用豆包 TTS。请编辑 config.json 后重启应用",
    en: "SEED_TTS_API_KEY isn't set, so Doubao TTS can't be used. Edit config.json and restart the app.",
  },
  seedSynthFailed: {
    zh: "豆包 TTS 合成失败（{code}）：{message}",
    en: "Doubao TTS synthesis failed ({code}): {message}",
  },
  seedHttp: {
    zh: "豆包 TTS HTTP {status}：{detail}",
    en: "Doubao TTS returned HTTP {status}: {detail}",
  },
  seedNoStream: { zh: "豆包 TTS 响应无数据流", en: "Doubao TTS returned no data stream" },
  seedNoAudio: { zh: "豆包 TTS 未返回音频数据", en: "Doubao TTS returned no audio data" },
  edgeNoAudio: { zh: "Edge TTS 未返回音频数据", en: "Edge TTS returned no audio data" },

  // 素材
  notAwaitingMaterial: {
    zh: "当前任务不在等待素材确认状态",
    en: "The task isn't waiting for footage confirmation",
  },
  materialDone: { zh: "素材已经匹配过了", en: "Footage has already been matched" },
  noMaterial: { zh: "还没有素材，先生成素材", en: "No footage yet. Generate footage first." },
  emptyMaterial: { zh: "素材清单为空", en: "The footage list is empty" },
  noMaterialForParagraph: {
    zh: "第 {n} 段还没有素材",
    en: "Section {n} has no footage yet",
  },
  replaceFailed: {
    zh: "更换素材失败：{reason}",
    en: "Failed to replace the clip: {reason}",
  },
  searchCancelled: { zh: "检索已取消", en: "Search cancelled" },
  searchFailed: {
    zh: "检索候选失败：{reason}",
    en: "Failed to search candidates: {reason}",
  },
  notEditable: { zh: "当前任务不可编辑", en: "The task can't be edited" },
  notEditableState: {
    zh: "当前任务不在可编辑状态",
    en: "The task isn't editable right now",
  },
  noStockKey: {
    zh: "未配置 {key}，无法检索素材。请编辑 config.json 后重启应用",
    en: "{key} isn't set, so footage search is unavailable. Edit config.json and restart the app.",
  },
  stockApiFailed: {
    zh: "素材接口失败（HTTP {status}）：{url}",
    en: "Footage API failed (HTTP {status}): {url}",
  },
  clipDownloadFailed: {
    zh: "素材下载失败（HTTP {status}）",
    en: "Clip download failed (HTTP {status})",
  },
  clipDownloadTimeout: {
    zh: "素材下载超时（{sec}s 无数据）：{key}",
    en: "Clip download timed out ({sec}s without data): {key}",
  },
  probeFailed: {
    zh: "素材文件无法解析：{file}",
    en: "Can't read the clip file: {file}",
  },
  probeNoTools: {
    zh: "未检测到 ffprobe，ffmpeg 也读不出素材信息：{file}",
    en: "ffprobe isn't available and ffmpeg couldn't read the clip either: {file}",
  },
  noCandidate: {
    zh: "第 {n} 段没有检索到可用素材（关键词没搜到，或时长/画幅不达标）",
    en: "Section {n} found no usable footage (nothing matched, or clips missed the duration/aspect rules)",
  },
  noClip: { zh: "第 {n} 段没有可用素材", en: "Section {n} has no usable footage" },
  downloadAllFailed: {
    zh: "第 {n} 段素材下载失败（已尝试 {tried} 个候选）",
    en: "Section {n} failed to download any clip (tried {tried} candidates)",
  },
  visionSelectShape: { zh: "视觉选片返回格式不符", en: "Visual selection returned an unexpected shape" },

  // 版式
  cardsNotEditable: {
    zh: "当前任务不在可编辑版式的状态",
    en: "Cards can't be edited in the current state",
  },
  emptyCards: { zh: "版式清单为空", en: "The card list is empty" },
  noSuchCard: { zh: "没有这张卡：{id}", en: "No such card: {id}" },
  cardIdInvalid: { zh: "卡片标识不合法", en: "Invalid card id" },
  cardNotRendered: { zh: "这张卡还没渲染", en: "This card hasn't been rendered yet" },
  cardStillFailed: {
    zh: "卡片预览渲染失败：{reason}",
    en: "Failed to render the card preview: {reason}",
  },
  cardNotFit: {
    zh: "这段内容不适合做信息卡，换一段或换个模板试试",
    en: "This section doesn't suit an info card. Try another section or template.",
  },
  infoCardFailed: {
    zh: "生成信息卡失败：{reason}",
    en: "Failed to generate the info card: {reason}",
  },
  badAccent: { zh: "配色不在允许的色板里", en: "This color isn't in the allowed palette" },
  durationRange: {
    zh: "{label}时长要在 0–15 秒之间",
    en: "{label} duration must be between 0 and 15 seconds",
  },

  // 合成
  nothingToCompose: {
    zh: "还没有可合成的内容，先跑完素材确认",
    en: "Nothing to compose yet. Finish footage confirmation first.",
  },
  composeIncomplete: {
    zh: "缺少剧本、配音或素材，无法合成",
    en: "The script, voice-over or footage is missing, so there's nothing to compose",
  },
  noComposeParagraphs: { zh: "没有可合成的段落", en: "No sections to compose" },
  composeMissingClip: { zh: "第 {n} 段缺少素材", en: "Section {n} is missing its footage" },
  composing: {
    zh: "正在合成，等这一版出来再改参数",
    en: "Rendering in progress. Wait for this version before changing settings.",
  },
  confirmCardsFirst: {
    zh: "先确认版式，再生成成片",
    en: "Confirm the cards before rendering the video",
  },
  cardsNotBuilt: {
    zh: "还没有生成版式，先跑完「版式确认」",
    en: "No cards generated yet. Finish card confirmation first.",
  },
  badMusic: {
    zh: "自定义音乐不可用：{reason}",
    en: "The custom music can't be used: {reason}",
  },
  badFile: { zh: "文件名不合法", en: "Invalid file name" },
  noAudio: { zh: "音频不存在", en: "Audio not found" },
  noVideo: { zh: "还没有生成成片", en: "No final cut yet" },

  // 抓取
  fetchBlocked: {
    zh: "站点拒绝抓取（HTTP {status}），可能有反爬限制。请打开页面复制正文粘贴到输入框。",
    en: "The site refused the request (HTTP {status}); it may block bots. Open the page and paste the text into the input box.",
  },
  fetchHttpFailed: {
    zh: "抓取失败（HTTP {status}）：{url}",
    en: "Fetch failed (HTTP {status}): {url}",
  },
  fetchFailed: { zh: "抓取失败：{url}", en: "Fetch failed: {url}" },
  fetchBotPage: {
    zh: "抓到的是一张验证页（命中「{reason}」），不是文章正文。请用浏览器打开页面，复制正文粘贴到输入框。",
    en: "That was a verification page (matched “{reason}”), not the article. Open the page in a browser and paste the text into the input box.",
  },
  fetchTooShort: {
    zh: "抓到的正文只有 {n} 字，可能是登录页、验证页，或内容由脚本动态渲染。请用浏览器打开页面，复制正文粘贴到输入框。",
    en: "The page yielded only {n} characters — probably a login wall, a verification page, or client-rendered content. Open the page in a browser and paste the text into the input box.",
  },
  fetchListing: {
    zh: "抓到的不是文章正文（{reason}）。请打开具体文章页，或复制正文粘贴到输入框。",
    en: "That looks like a list page rather than an article ({reason}). Open the article itself, or paste the text into the input box.",
  },

  // 模型
  noLlmKey: {
    zh: "未配置 LLM_API_KEY，请编辑 config.json 后重启应用",
    en: "LLM_API_KEY isn't set. Edit config.json and restart the app.",
  },
  llmHttp: {
    zh: "LLM 请求失败（{status}）：{detail}",
    en: "LLM request failed ({status}): {detail}",
  },
  llmBadJson: {
    zh: "LLM 返回的不是合法 JSON：{detail}",
    en: "The LLM didn't return valid JSON: {detail}",
  },

  // 环境
  noFfmpeg: {
    zh: "未检测到 ffmpeg，请安装 ffmpeg 或使用带内置 ffmpeg 的安装包",
    en: "ffmpeg wasn't found. Install it, or use a build that bundles ffmpeg.",
  },
  noFfprobe: {
    zh: "未检测到 ffprobe，无法解析音频时长",
    en: "ffprobe wasn't found, so audio duration can't be read",
  },
  audioProbeFailed: {
    zh: "无法解析音频时长：{file}",
    en: "Can't read the audio duration: {file}",
  },
  audioProbeFailedBoth: {
    zh: "无法解析音频时长：{file}（ffprobe 与 ffmpeg 均不可用）",
    en: "Can't read the audio duration: {file} (neither ffprobe nor ffmpeg is usable)",
  },

  // 提示词文件
  promptFileMissing: { zh: "缺少 prompt 文件：{path}", en: "Prompt file is missing: {path}" },
  promptFileUnreadable: { zh: "无法读取 prompt 文件：{path}", en: "Can't read the prompt file: {path}" },
  promptBuiltinMissing: {
    zh: "{path} 缺少 {key}",
    en: "{path} doesn't contain {key}",
  },
  promptUnknownFile: { zh: "未知提示词文件：{file}", en: "Unknown prompt file: {file}" },
  promptUnknownKey: {
    zh: "{title} 没有 {key}",
    en: "{title} doesn't have {key}",
  },
  promptBuiltinFileMissing: {
    zh: "缺少内置提示词：{path}",
    en: "Built-in prompt is missing: {path}",
  },
  promptEmpty: { zh: "提示词不能为空", en: "The prompt can't be empty" },
  promptValueInvalid: { zh: "value 必须是字符串", en: "value must be a string" },
} as const satisfies Record<string, Bilingual>;

export type ErrorKey = keyof typeof ERRORS;

/** 阶段进度文案：只放固定说法，纯数字摘要走 StageState.counts 由前端拼 */
export const STAGE_TEXT = {
  cached: { zh: "命中缓存", en: "Cached" },
  progress: { zh: "第 {i}/{total} 段", en: "Section {i}/{total}" },
  progressPercent: {
    zh: "第 {i}/{total} 段 {percent}%",
    en: "Section {i}/{total} {percent}%",
  },
  infoLayer: { zh: "第 {i} 段信息层", en: "Info layer on section {i}" },
  chapterTransition: { zh: "第 {i} 段过场卡", en: "Chapter card before section {i}" },
  renderIntro: { zh: "渲染片头", en: "Rendering intro" },
  renderOutro: { zh: "渲染片尾", en: "Rendering outro" },
  merging: { zh: "合并片段", en: "Merging clips" },
  reviewing: { zh: "审稿中", en: "Reviewing" },
  repairing: { zh: "按审稿意见返修", en: "Repairing per review" },
  fixing: { zh: "按约束修复", en: "Fixing per constraints" },
  designingCards: { zh: "AI 设计版式", en: "AI drafting cards" },
  cardsOff: { zh: "版式已关闭，本次不出卡片", en: "Cards are off, none this time" },
  cardsFailed: { zh: "生成失败，本次不带卡片", en: "Generation failed, skipping cards" },
  appQuit: { zh: "应用退出时中断", en: "Interrupted when the app quit" },
} as const satisfies Record<string, Bilingual>;

export type StageTextKey = keyof typeof STAGE_TEXT;

/** 缺省原因：渲染失败时拿不到具体信息 */
export const UNKNOWN_REASON: Bilingual = { zh: "未知原因", en: "unknown reason" };

/** 音乐文件既没有具体原因也没给兜底时用 */
export const NO_MUSIC_REASON: Bilingual = {
  zh: "文件不存在或格式不支持",
  en: "the file is missing or the format isn't supported",
};

/** message 传字符串＝内部错误原样透出；传双语对象则在出口按语言取一份 */
export class TaskError extends Error {
  readonly statusCode: number;
  readonly text?: Bilingual;
  readonly vars?: ErrorVars;

  constructor(message: string | Bilingual, statusCode = 400, vars?: ErrorVars, cause?: unknown) {
    // message 落中文且已填好占位符：它要进日志和兜底路径
    super(
      typeof message === "string" ? message : fill("zh", message, vars),
      cause === undefined ? undefined : { cause },
    );
    this.name = "TaskError";
    this.statusCode = statusCode;
    if (typeof message !== "string") this.text = message;
    if (vars) this.vars = vars;
  }
}

/** 抛一条会显示在界面上的错误 */
export function userError(key: ErrorKey, statusCode: number, vars?: ErrorVars, cause?: unknown): TaskError {
  return new TaskError(ERRORS[key], statusCode, vars, cause);
}

/** 阶段进度：一对填好占位符的文案 */
export function stageText(key: StageTextKey, vars?: ErrorVars): Bilingual {
  return bilingualMessage(STAGE_TEXT[key], vars);
}

/** 取异常文本，拼「失败：{reason}」这类文案用 */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 按请求语言把占位符填上 */
function fill(lang: Lang, text: Bilingual, vars?: ErrorVars): string {
  const template = pick(lang, text);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    if (value === undefined) return whole;
    return typeof value === "object" ? pick(lang, value) : String(value);
  });
}

/** 一次填好两种语言：调用方在流水线里、挑语言在 manager 里时用 */
export function bilingualMessage(text: Bilingual, vars?: ErrorVars): Bilingual {
  return { zh: fill("zh", text, vars), en: fill("en", text, vars) };
}

/** 不走异常、只想要一句话时用（比如路由里直接 reply.send） */
export function userText(key: ErrorKey, lang: Lang, vars?: ErrorVars): string {
  return fill(lang, ERRORS[key], vars);
}

/** 出口统一走这里：双语的按语言取，内部错误原样透出 */
export function errorMessage(error: unknown, lang: Lang): string {
  if (error instanceof TaskError && error.text) return fill(lang, error.text, error.vars);
  return error instanceof Error ? error.message : String(error);
}
