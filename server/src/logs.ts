/*
 * 运行日志的文案：流水线里取，由 manager 按当时的界面语言挑一条落盘。
 */
import { bilingualMessage, type ErrorVars } from "./errors.js";
import type { Bilingual } from "./i18n.js";

export const LOG_TEXT = {
  // ——— 任务级（manager）———
  taskStart: { zh: "任务开始：{path}", en: "Task started: {path}" },
  voiceSettings: {
    zh: "配音设置：{engine}{voices} · {speed}× 语速",
    en: "Voice settings: {engine}{voices} · {speed}× speed",
  },
  scriptSaved: { zh: "已保存修改后的剧本", en: "Saved the edited script" },
  scriptConfirmed: {
    zh: "剧本已确认：{n} 段 / {sent} 句",
    en: "Script confirmed: {n} sections / {sent} lines",
  },
  scriptReady: { zh: "剧本已生成，确认后进入配音", en: "Script ready. Confirm it to start the voice-over." },
  ttsStart: { zh: "开始生成配音…", en: "Generating the voice-over…" },
  ttsRegen: {
    zh: "重新生成配音：{engine} · {speed}× 语速",
    en: "Regenerating the voice-over: {engine} · {speed}× speed",
  },
  ttsDone: {
    zh: "配音已完成：{n} 段，总时长 {sec} 秒",
    en: "Voice-over done: {n} sections, {sec}s total",
  },
  ttsReady: {
    zh: "配音就绪，去「素材确认」点「开始匹配素材」",
    en: "Voice-over ready. Open Footage and hit Start matching.",
  },
  materialSource: { zh: "素材来源：{source}", en: "Footage source: {source}" },
  resolution: { zh: "成片分辨率：{w}×{h}", en: "Output resolution: {w}×{h}" },
  materialStart: { zh: "开始按台词匹配素材…", en: "Matching footage to the lines…" },
  materialReady: { zh: "素材已就绪：{n} 段", en: "Footage ready: {n} sections" },
  materialMatched: {
    zh: "素材已匹配，确认后开始合成视频",
    en: "Footage matched. Confirm to start rendering.",
  },
  materialConfirmed: {
    zh: "素材已确认，去「成片预览」设置字幕与 BGM 后生成成片",
    en: "Footage confirmed. Open Final cut, set subtitles and BGM, then render.",
  },
  sectionReady: { zh: "第 {n} 段就绪", en: "Section {n} ready" },
  clipReplaced: {
    zh: "第 {n} 段换成新素材：{label}",
    en: "Section {n} switched to new footage: {label}",
  },
  cardsStart: { zh: "按当前参数生成版式…", en: "Generating cards with the current settings…" },
  cardsOff: { zh: "版式开关已关闭，本次成片不含卡片", en: "Cards are off, so this video has no cards" },
  cardsBuilt: {
    zh: "版式已生成并确认：{n} 张卡",
    en: "Cards generated and confirmed: {n} cards",
  },
  cardsConfirmedEmpty: { zh: "版式已确认：本次不加任何卡片", en: "Cards confirmed, none this time" },
  cardsFailed: {
    zh: "版式生成失败，本次成片不含卡片：{reason}",
    en: "Card generation failed, so this video has no cards: {reason}",
  },
  cardsReady: {
    zh: "版式已就绪：可以预览、换一个或删掉不要的卡，确认后进入合成",
    en: "Cards ready: preview, swap or drop any card, then confirm to render.",
  },
  cardsChangedResume: {
    zh: "版式有改动，成片会按新卡片重新合成",
    en: "Cards changed; the final cut will be re-rendered with them",
  },
  cardsChangedConfirm: {
    zh: "版式有改动，需要重新确认后再合成",
    en: "Cards changed; confirm them again before rendering",
  },
  bothConfirmed: {
    zh: "素材与版式都确认了，去「成片预览」设置字幕与 BGM 后生成成片",
    en: "Footage and cards confirmed. Open Final cut, set subtitles and BGM, then render.",
  },
  accentChanged: { zh: "配色换成 {accent}", en: "Accent switched to {accent}" },
  cardUpdated: { zh: "「{title}」已更新", en: "“{title}” updated" },
  cardPreviewFailed: {
    zh: "第 {n} 段卡片预览生成失败，稍后打开页面会重试",
    en: "Section {n} card preview failed; it will be retried when the page opens",
  },
  infoCardBatch: {
    zh: "开始为 {n} 段配信息卡：逐段判断适合做成哪种卡，每段要调一次模型",
    en: "Adding info cards to {n} sections: each is judged separately and costs one model call",
  },
  infoCardAdded: {
    zh: "第 {n} 段信息卡：{kind}「{title}」",
    en: "Section {n} info card: {kind} “{title}”",
  },
  infoCardFailed: {
    zh: "第 {n} 段信息卡生成失败，只保留实拍：{reason}",
    en: "Section {n} info card failed, keeping the footage only: {reason}",
  },
  infoCardSummary: {
    zh: "已为 {n} 段生成信息卡{failed}",
    en: "Info cards added to {n} sections{failed}",
  },
  infoCardNone: { zh: "本次没有段落配信息卡", en: "No info cards this time" },
  subtitleResize: {
    zh: "字幕字号变了，分段片段会重新渲染",
    en: "Subtitle size changed, so segments will be re-rendered",
  },
  renderStart: {
    zh: "生成成片：字号 {size}（0=自动） · BGM {bgm}{file}",
    en: "Rendering: subtitle size {size} (0=auto) · BGM {bgm}{file}",
  },
  videoDone: { zh: "视频已生成：{path}", en: "Video ready: {path}" },
  resumeLog: {
    zh: "继续未完成的步骤（已完成的阶段会命中缓存）",
    en: "Continuing the unfinished steps (finished stages are cached)",
  },
  cancelled: { zh: "任务已取消", en: "Task cancelled" },
  oldVideoBusy: {
    zh: "旧成片被占用，暂时删不掉；合成时会覆盖它",
    en: "The old final cut is locked and can't be deleted; rendering will overwrite it",
  },

  // ——— 剧本（script.ts）———
  reuseTranscript: {
    zh: "复用已生成的剧本（_transcript.json）",
    en: "Reusing the generated script (_transcript.json)",
  },
  reuseHtml: { zh: "复用已抓取的正文", en: "Reusing the fetched article" },
  reuseDraft: { zh: "复用已生成的草稿", en: "Reusing the generated draft" },
  writingDraft: { zh: "正在用「{style}」风格撰写草稿…", en: "Drafting in the “{style}” style…" },
  rulesMissed: {
    zh: "剧本未达约束：{issue}{more}",
    en: "Script missed the constraints: {issue}{more}",
  },
  fixCallFailed: { zh: "修复调用失败：{reason}", en: "Repair call failed: {reason}" },
  repairNotConverged: {
    zh: "修复未收敛，保留原稿",
    en: "Repair didn't converge, keeping the original",
  },
  stillOff: {
    zh: "修复后仍有 {n} 项偏差",
    en: "Still {n} items off after the repair",
  },
  rulesFixed: { zh: "约束已修正", en: "Constraints now satisfied" },
  critiqueUnparsable: {
    zh: "审稿结果无法解析，跳过返修",
    en: "Couldn't parse the review, skipping the repair",
  },
  critiqueFailed: { zh: "审稿失败，跳过：{reason}", en: "Review failed, skipping: {reason}" },
  critiqueScore: {
    zh: "审稿评分 {score} 分（阈值 {threshold}）{first}",
    en: "Review score {score} (threshold {threshold}){first}",
  },
  repairedOnce: { zh: "已按审稿意见返修一次", en: "Repaired once per the review" },
  repairWorse: {
    zh: "返修后约束变差，保留原稿",
    en: "The repair made things worse; keeping the original",
  },
  scriptReadyLog: { zh: "剧本已就绪：{title}", en: "Script ready: {title}" },

  // ——— 配音（tts.ts）———
  reuseAudioManifest: {
    zh: "复用已生成的配音清单（_durations.json）",
    en: "Reusing the generated audio manifest (_durations.json)",
  },
  ttsScriptChanged: {
    zh: "台词有改动，重新生成配音",
    en: "The lines changed, so the voice-over is regenerated",
  },
  ttsEngineLog: {
    zh: "配音引擎：{engine} / {model} · 语速 {speed}×",
    en: "TTS engine: {engine} / {model} · speed {speed}×",
  },
  voiceAssign: { zh: "音色分配：{list}", en: "Voice assignment: {list}" },
  reuseAudio: { zh: "复用音频 {file}", en: "Reusing audio {file}" },
  ttsAttemptFailed: {
    zh: "配音失败（第 {i}/{total} 次）：{reason}",
    en: "Voice-over failed (attempt {i}/{total}): {reason}",
  },
  dialogueDone: {
    zh: "第 {n} 段 · {speaker}（{voice}）：{lines} 句 / {sec}s",
    en: "Section {n} · {speaker} ({voice}): {lines} lines / {sec}s",
  },

  // ——— 素材（material.ts）———
  reuseTerms: { zh: "复用检索词（_terms.json）", en: "Reusing the search terms (_terms.json)" },
  termsPromptUpdated: {
    zh: "检索词提示词有更新，重新生成检索词",
    en: "The search-term prompt changed, regenerating the terms",
  },
  termsPartial: {
    zh: "检索词只覆盖 {done}/{total} 段，{action}",
    en: "Search terms only cover {done}/{total} sections, {action}",
  },
  noEnglishTerms: {
    zh: "第 {n} 段拿不到英文检索词，改用台词关键词",
    en: "Section {n} got no English terms, using line keywords instead",
  },
  termsReady: {
    zh: "检索词已生成：{n} 段 × {k} 个（示例：{sample}）",
    en: "Search terms ready: {n} sections × {k} each (e.g. {sample})",
  },
  visionPicked: {
    zh: "视觉选片：看 {n} 张缩略图 → {label}（{sec}s, {w}×{h}）",
    en: "Picked from visuals: {n} thumbnails → {label} ({sec}s, {w}×{h})",
  },
  visionNoPick: {
    zh: "视觉选片没有给出可用画面，回退到标签选片",
    en: "Visual selection found nothing usable, falling back to tags",
  },
  visionUnsupported: {
    zh: "模型不支持图片输入，本次任务改用标签选片：{reason}",
    en: "The model can't take image input; using tag selection for this task: {reason}",
  },
  visionFailed: {
    zh: "本段视觉选片失败，先退回标签选片，下一段继续尝试看图：{reason}",
    en: "Visual selection failed here; falling back to tags and retrying vision on the next section: {reason}",
  },
  aiSelectFailed: {
    zh: "AI 选片失败，改用时长匹配：{reason}",
    en: "AI selection failed, matching by duration instead: {reason}",
  },
  termFallback: {
    zh: "「{term}」没有贴切素材，改用「{short}」重搜",
    en: "No good match for “{term}”, searching “{short}” instead",
  },
  noNewCandidates: {
    zh: "连续两个检索词几乎没带来新素材（当前 {n} 个），停止继续检索",
    en: "Two terms in a row brought almost nothing new ({n} so far), stopping the search",
  },
  reuseMaterial: {
    zh: "复用已匹配的素材（_videos.json）",
    en: "Reusing the matched footage (_videos.json)",
  },
  signatureChanged: {
    zh: "素材来源、画幅或时长门槛变了，重新匹配素材（{source}）",
    en: "Source, aspect or duration threshold changed; matching again ({source})",
  },
  matchStart: {
    zh: "第 {n} 段匹配素材（需 {sec}s）：{terms}",
    en: "Matching section {n} (needs {sec}s): {terms}",
  },
  noCandidatesForSection: {
    zh: "第 {n} 段没有检索到素材，改用设计卡",
    en: "Section {n} found no footage; using a design card",
  },
  fewCandidates: {
    zh: "第 {n} 段新素材只有 {fresh} 个，放宽到已用过的候选（共 {total} 个）",
    en: "Section {n} had only {fresh} fresh clips; allowing previously used ones ({total} total)",
  },
  noPickForSection: {
    zh: "第 {n} 段没有可选素材，改用设计卡",
    en: "Section {n} has no usable clip; using a design card",
  },
  loopFill: {
    zh: "第 {n} 段没有 {need}s 以上的整条素材，用 {have}s 的素材循环铺满",
    en: "No clip longer than {need}s for section {n}; looping a {have}s clip to fill it",
  },
  downloadRetry: {
    zh: "第 {n} 段下载失败，换下一个候选：{reason}",
    en: "Section {n} download failed, trying the next candidate: {reason}",
  },
  downloadAllFailed: {
    zh: "第 {n} 段素材下载全部失败（已试 {tried} 个），改用设计卡",
    en: "Section {n} couldn't download any clip ({tried} tried); using a design card",
  },
  clipChosen: {
    zh: "第 {n} 段 → {label}（{sec}s, {w}×{h}）",
    en: "Section {n} → {label} ({sec}s, {w}×{h})",
  },
  shotCount: { zh: "第 {n} 段共 {shots} 个镜头", en: "Section {n} is split into {shots} shots" },

  // ——— 版式（cards.ts）———
  accentFromFrame: {
    zh: "按画面主色选配色：{accent}{note}",
    en: "Accent taken from the frame: {accent}{note}",
  },
  accentVisionFailed: {
    zh: "视觉选色失败，用默认主色：{reason}",
    en: "Visual accent selection failed, using the default: {reason}",
  },
  noCardTypes: { zh: "没有可用的卡片类型，跳过版式", en: "No card types are on, skipping cards" },
  cardTypesHint: {
    zh: "未单独开启片头 / 章节卡 / 片尾，按「片头时长」与「过场卡时长」出片头与章节卡；不想要卡片请在版式页把时长改成 0",
    en: "Intro / chapter / outro aren't switched on individually; they follow the intro and transition durations. To drop cards, set those durations to 0 on the cards page.",
  },
  aiDrafting: {
    zh: "正在让 AI 为片头 / 章节 / 片尾写文案并选模板…",
    en: "Asking the AI for intro / chapter / outro copy and templates…",
  },
  accentManual: { zh: "按你的选择用主色：{accent}", en: "Using the accent you picked: {accent}" },
  aiDraftFailed: {
    zh: "AI 设计版式失败，改用内置模板：{reason}",
    en: "AI card drafting failed, using built-in templates: {reason}",
  },
  cardsGenerated: {
    zh: "版式已生成：{n} 张卡 · 风格 {style}",
    en: "Cards generated: {n} · style {style}",
  },
  rewriteTitle: { zh: "换文案：{title}", en: "Rewriting the copy: {title}" },
  rewriteFailed: { zh: "换文案失败：{reason}", en: "Couldn't rewrite the copy: {reason}" },
  cardRenderFailed: {
    zh: "「{title}」卡片渲染失败：{reason}",
    en: "Card “{title}” failed to render: {reason}",
  },
  stillRenderFailed: {
    zh: "卡片静帧渲染失败：{reason}",
    en: "Card still frame failed to render: {reason}",
  },
  notFitCard: {
    zh: "第 {n} 段不适合做信息卡，或模型没给出可用字段",
    en: "Section {n} doesn't suit an info card, or the model returned no usable fields",
  },
  titleUsed: {
    zh: "第 {n} 段的主题「{title}」已在别处用过，跳过以免重复",
    en: "The title “{title}” for section {n} is already used elsewhere; skipping it",
  },
  infoLayerRenderFailed: {
    zh: "「{title}」信息层渲染失败：{reason}",
    en: "Info layer “{title}” failed to render: {reason}",
  },

  // ——— 合成（compose.ts）———
  designCardUsed: {
    zh: "第 {n} 段使用设计卡：「{quote}」",
    en: "Section {n} uses a design card: “{quote}”",
  },
  designCardFailed: {
    zh: "第 {n} 段设计卡渲染失败，改用纯色底",
    en: "Section {n} design card failed to render; using a solid background",
  },
  reuseClip: { zh: "复用已渲染片段 {file}", en: "Reusing the rendered clip {file}" },
  clipStale: {
    zh: "第 {n} 段的素材或参数变了，重新渲染片段",
    en: "Section {n} footage or settings changed; re-rendering the clip",
  },
  probeFailedAvg: {
    zh: "无法探测片段时长，按平均时长估算转场偏移",
    en: "Couldn't probe clip durations; estimating transition offsets from the average",
  },
  transitionClamped: {
    zh: "转场 {t}s 对最短片段 {short}s 过长，已收敛为 {fade}s",
    en: "A {t}s transition is too long for the shortest clip ({short}s); clamped to {fade}s",
  },
  reuseOutput: { zh: "复用已生成的成片（_output.mp4）", en: "Reusing the rendered video (_output.mp4)" },
  outputStale: { zh: "成片参数已变，重新合成", en: "Render settings changed; rendering again" },
  outputPartial: {
    zh: "上次合成没跑完，丢弃不完整的成片重新合成",
    en: "The last render didn't finish; discarding it and rendering again",
  },
  lookBoost: {
    zh: "画面增强：运镜 {motion} · 调色 {grade}",
    en: "Visual boost: motion {motion} · grade {grade}",
  },
  introTitle: { zh: "片头：{title}", en: "Intro: {title}" },
  introCardFailed: {
    zh: "片头卡没渲染出来，本次成片不含片头（原因见上一条渲染日志）",
    en: "The intro card didn't render, so this video has no intro (see the render log above)",
  },
  outroTitle: { zh: "片尾：{title}", en: "Outro: {title}" },
  outroCardFailed: {
    zh: "片尾卡没渲染出来，本次成片不含片尾（原因见上一条渲染日志）",
    en: "The outro card didn't render, so this video has no outro (see the render log above)",
  },
  introZeroDuration: {
    zh: "已勾选用 Remotion 渲染片头，但「片头时长」是 0，本次不出片头",
    en: "Remotion intro is on, but the intro duration is 0, so there's no intro this time",
  },
  reuseRemotionIntro: { zh: "复用已渲染的 Remotion 片头", en: "Reusing the rendered Remotion intro" },
  remotionIntroUsed: { zh: "片头使用 Remotion 模板", en: "Intro uses the Remotion template" },
  remotionIntroUnavailable: {
    zh: "Remotion 片头不可用，回退到字幕标题",
    en: "Remotion intro isn't available; falling back to the caption title",
  },
  reuseRemotionOutro: { zh: "复用已渲染的 Remotion 片尾", en: "Reusing the rendered Remotion outro" },
  remotionOutroUsed: { zh: "片尾使用 Remotion 模板", en: "Outro uses the Remotion template" },
  remotionOutroUnavailable: {
    zh: "Remotion 片尾不可用，本次不加片尾",
    en: "Remotion outro isn't available; no outro this time",
  },
  infoLayerOverlay: {
    zh: "第 {n} 段叠加信息层「{title}」（{kind}）",
    en: "Section {n} overlays the info layer “{title}” ({kind})",
  },
  infoLayerMissing: {
    zh: "第 {n} 段信息层没渲染出来，本段只用实拍",
    en: "Section {n} info layer didn't render; this section uses footage only",
  },
  infoCardReplaces: {
    zh: "第 {n} 段无素材，用信息卡「{title}」整段替代",
    en: "Section {n} has no footage; the info card “{title}” stands in for it",
  },
  infoCardFallback: {
    zh: "第 {n} 段信息卡没渲染出来，回退实拍",
    en: "Section {n} info card didn't render; falling back to footage",
  },
  chapterMissing: {
    zh: "第 {n} 段过场卡「{title}」没渲染出来，成片缺这张卡",
    en: "The chapter card “{title}” before section {n} didn't render; the video is missing it",
  },
  chapterSkipped: {
    zh: "第 {n} 段过场卡渲染失败，本次跳过",
    en: "The chapter card before section {n} failed to render; skipping it",
  },
  sectionCompose: {
    zh: "合成第 {n} 段（{sec}s，{lines} 句{shots}）",
    en: "Composing section {n} ({sec}s, {lines} lines{shots})",
  },
  chapterInsertedCards: {
    zh: "已插入 {n} 张章节卡（共 {sec}s）",
    en: "Inserted {n} chapter cards ({sec}s total)",
  },
  chapterInsertedPlain: {
    zh: "已插入 {n} 张段落过场卡（每张 {sec}s）",
    en: "Inserted {n} section transition cards ({sec}s each)",
  },
  remotionSubtitleUnavailable: {
    zh: "Remotion 字幕层不可用，回退 libass：{reason}",
    en: "Remotion subtitles aren't available; falling back to libass: {reason}",
  },
  bgmFailed: { zh: "BGM 生成失败，跳过混音", en: "BGM generation failed; skipping the mix" },
  bgmOff: {
    zh: "配置里关掉了 BGM，本次只保留配音",
    en: "BGM is off in the config; keeping the voice-over only",
  },
  sfxFailed: {
    zh: "音效生成失败，本次不加音效",
    en: "Sound effects failed to generate; skipping them",
  },
  mergeSummary: {
    zh: "合并 {n} 个片段{bgm}{transition}{sfx}",
    en: "Merging {n} clips{bgm}{transition}{sfx}",
  },
  missingCards: {
    zh: "注意：本次成片缺少 {n} 张已确认的版式卡",
    en: "Heads-up: this video is missing {n} confirmed cards",
  },

  // ——— 抓取（fetcher.ts）———
  fetchRetry: { zh: "抓取失败，重试一次…", en: "Fetch failed, retrying once…" },
  serverRetry: { zh: "站点返回 {status}，重试一次…", en: "The site returned {status}, retrying once…" },
  pastedText: {
    zh: "使用粘贴的正文（{n} 字）",
    en: "Using the pasted text ({n} characters)",
  },
  fetching: { zh: "抓取网页：{url}", en: "Fetching the page: {url}" },
  decrypted: { zh: "已解密 36kr 正文数据", en: "Decrypted the 36kr article payload" },
  decryptFailed: {
    zh: "36kr 正文解密失败，页面可见文本也不足",
    en: "Couldn't decrypt the 36kr payload, and the visible text isn't enough",
  },
  fetched: {
    zh: "抓取完成：正文 {chars} 字 · {paragraphs} 段 · 来源 {source}",
    en: "Fetched: {chars} characters · {paragraphs} paragraphs · source {source}",
  },
  linkDensity: {
    zh: "正文里链接占比 {percent}%，可能混入了导航或推荐位",
    en: "Links make up {percent}% of the text; navigation or recommendations may have leaked in",
  },
  truncated: { zh: "正文过长，截断到 {n} 字", en: "The article was too long, truncated to {n} characters" },
} as const satisfies Record<string, Bilingual>;

export type LogKey = keyof typeof LOG_TEXT;

/** 取一条日志文案：两种语言都已填好占位符 */
export function logText(key: LogKey, vars?: ErrorVars): Bilingual {
  return bilingualMessage(LOG_TEXT[key], vars);
}
