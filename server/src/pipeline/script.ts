import fs from "node:fs";
import path from "node:path";
import { chat, extractJsonObject } from "../services/llm.js";
import { fetchContent } from "../services/fetcher.js";
import { loadCriticPrompts, loadPrompts } from "../services/prompts.js";
import { splitContent } from "./split.js";
import type { PromptSource, RawTranscript, TaskContext, Transcript } from "../types.js";

const FILES = {
  html: "_html.txt",
  draft: "_transcript.txt",
  script: "_transcript.json",
} as const;

const SCRIPT_STAGES = ["fetch", "write", "rewrite", "split"] as const;
/** 动作、情绪注释常用这些括号开头 */
const BRACKETS = ["（", "(", "【", "["];

/** 审稿低于阈值时按意见返修一次；AISV_SCRIPT_REVIEW=0 关闭 */
const REVIEW_ENABLED = process.env.AISV_SCRIPT_REVIEW !== "0";
const REVIEW_THRESHOLD = (() => {
  const value = Number(process.env.AISV_SCRIPT_REVIEW_THRESHOLD);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : 0.82;
})();

export interface ScriptRules {
  speakers: string[];
  maxTitle: number;
  minChars: number;
  maxChars: number;
  minParagraphs: number;
  maxParagraphs: number;
  minTurns: number;
  maxTurns: number;
  minParaTurns: number;
  maxParaTurns: number;
  maxSentence: number;
  /** 一条台词最多允许几个句末标点；相声的「反问＋包袱」结构需要 2 */
  maxStops: number;
}

/** 提示词给的是硬区间，这里各留一点余量，只拦明显跑偏的稿子 */
const RULES: Record<PromptSource, Omit<ScriptRules, "speakers">> = {
  podcast: {
    maxTitle: 10,
    minChars: 500,
    maxChars: 900,
    minParagraphs: 3,
    maxParagraphs: 7,
    minTurns: 20,
    maxTurns: 44,
    minParaTurns: 3,
    maxParaTurns: 9,
    maxSentence: 20,
    maxStops: 1,
  },
  crosstalk: {
    maxTitle: 10,
    minChars: 500,
    maxChars: 900,
    minParagraphs: 3,
    maxParagraphs: 7,
    minTurns: 20,
    maxTurns: 44,
    minParaTurns: 3,
    maxParaTurns: 9,
    maxSentence: 20,
    maxStops: 2,
  },
  talkshow: {
    maxTitle: 10,
    minChars: 380,
    maxChars: 740,
    minParagraphs: 3,
    maxParagraphs: 6,
    minTurns: 12,
    maxTurns: 50,
    minParaTurns: 3,
    maxParaTurns: 11,
    maxSentence: 20,
    maxStops: 1,
  },
};

export function scriptRules(source: PromptSource, speakers: { main: string; guest: string }): ScriptRules {
  return { ...RULES[source], speakers: source === "talkshow" ? [speakers.main] : [speakers.main, speakers.guest] };
}

function countChars(text: string): number {
  return [...text].length;
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/** 结构、角色、字数与单句长度，返回可执行的问题清单 */
export function scriptIssues(raw: RawTranscript, rules: ScriptRules): string[] {
  const issues: string[] = [];
  const title = raw.title.trim();
  if (!title) issues.push("title 为空");
  else if (countChars(title) > rules.maxTitle) issues.push(`title 超过 ${rules.maxTitle} 字`);

  const turns = raw.paragraphs.reduce((sum, p) => sum + p.dialogues.length, 0);
  const chars = raw.paragraphs.reduce((sum, p) => sum + p.dialogues.reduce((s, d) => s + countChars(d.content), 0), 0);

  if (!inRange(raw.paragraphs.length, rules.minParagraphs, rules.maxParagraphs)) {
    issues.push(`段落数 ${raw.paragraphs.length} 不在 ${rules.minParagraphs}~${rules.maxParagraphs}`);
  }
  if (!inRange(turns, rules.minTurns, rules.maxTurns)) {
    issues.push(`总轮数 ${turns} 不在 ${rules.minTurns}~${rules.maxTurns}`);
  }
  if (!inRange(chars, rules.minChars, rules.maxChars)) {
    issues.push(`总字数 ${chars} 不在 ${rules.minChars}~${rules.maxChars}`);
  }

  raw.paragraphs.forEach((paragraph, pi) => {
    if (!inRange(paragraph.dialogues.length, rules.minParaTurns, rules.maxParaTurns)) {
      issues.push(`第 ${pi + 1} 段 ${paragraph.dialogues.length} 轮，不在 ${rules.minParaTurns}~${rules.maxParaTurns}`);
    }

    paragraph.dialogues.forEach((dialogue, di) => {
      const where = `第 ${pi + 1} 段第 ${di + 1} 轮`;
      const content = dialogue.content.trim();

      if (!rules.speakers.includes(dialogue.speaker)) {
        issues.push(`${where}角色「${dialogue.speaker}」不在允许名单`);
      }
      if (!content) {
        issues.push(`${where}台词为空`);
        return;
      }
      if (BRACKETS.some((mark) => content.includes(mark))) issues.push(`${where}含括号注释`);
      if (/[*#`~]/.test(content)) issues.push(`${where}含 Markdown 标记`);
      if (/[\u{1f300}-\u{1faff}\u{2600}-\u{27bf}]/u.test(content)) issues.push(`${where}含表情符号`);

      const long = splitContent(content).find((sentence) => countChars(sentence) > rules.maxSentence);
      if (long) issues.push(`${where}单句超过 ${rules.maxSentence} 字`);

      // 一条台词塞了两句话：分句后每句都不长，但合起来会撑爆一行字幕。
      // 相声的「先反问再接包袱」是固定结构，拆开就断，所以 crosstalk 放宽到 2。
      const stops = (content.match(/[。！？]/g) ?? []).length;
      if (stops > rules.maxStops) issues.push(`${where}一条台词含 ${stops} 句，应拆成多条`);
    });
  });

  return [...new Set(issues)].slice(0, 8);
}

function normalizeRaw(input: unknown): RawTranscript {
  const obj = input as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") throw new Error("剧本格式错误：顶层不是对象");

  const title = typeof obj.title === "string" ? obj.title.trim() : "";

  const rawParagraphs = obj.paragraphs;
  if (!Array.isArray(rawParagraphs) || rawParagraphs.length === 0) {
    throw new Error("剧本格式错误：缺少 paragraphs");
  }

  const paragraphs: RawTranscript["paragraphs"] = [];
  rawParagraphs.forEach((p, index) => {
    const paragraph = p as Record<string, unknown> | null;
    if (!paragraph || typeof paragraph !== "object") throw new Error(`剧本格式错误：第 ${index + 1} 段不是对象`);

    const rawDialogues = paragraph.dialogues;
    const dialogues: RawTranscript["paragraphs"][number]["dialogues"] = [];
    if (Array.isArray(rawDialogues)) {
      for (const d of rawDialogues) {
        const dialogue = d as Record<string, unknown> | null;
        const speaker = typeof dialogue?.speaker === "string" ? dialogue.speaker.trim() : "";
        const content = typeof dialogue?.content === "string" ? dialogue.content.trim() : "";
        if (speaker && content) dialogues.push({ speaker, content });
      }
    }

    // 整段没有可用台词视为结构错误，交给修复回路处理
    if (dialogues.length === 0) throw new Error(`剧本格式错误：第 ${index + 1} 段没有有效对话`);

    const description = typeof paragraph.description === "string" ? paragraph.description.trim() : "";
    paragraphs.push({ description, dialogues });
  });

  if (paragraphs.length === 0) throw new Error("剧本格式错误：没有有效对话");
  return { title, paragraphs };
}

export function toTranscript(raw: RawTranscript): Transcript {
  return {
    title: raw.title,
    paragraphs: raw.paragraphs.map((p) => ({
      description: p.description,
      dialogues: p.dialogues.map((d) => {
        const contents = splitContent(d.content);
        return { speaker: d.speaker, contents, contentsTts: [...contents] };
      }),
    })),
  };
}

export function sentenceCount(transcript: Transcript): number {
  return transcript.paragraphs.reduce((sum, p) => sum + p.dialogues.reduce((s, d) => s + d.contents.length, 0), 0);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseScript(answer: string): RawTranscript {
  const json = extractJsonObject(answer);
  if (!json) throw new Error("剧本改写失败：模型没有返回合法 JSON");

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`剧本改写失败：JSON 解析出错\n${json.slice(0, 300)}`);
  }
  return normalizeRaw(parsed);
}

async function requestScript(
  ctx: TaskContext,
  system: string,
  user: string,
  temperature: number,
): Promise<RawTranscript> {
  const answer = await chat(system, user, { json: true, signal: ctx.signal, temperature });
  return parseScript(answer);
}

/** 带上问题清单修一次，调用失败返回 null */
async function fixScript(
  ctx: TaskContext,
  prompt: string,
  script: RawTranscript,
  issues: string[],
  draft: string,
  temperature: number,
): Promise<RawTranscript | null> {
  try {
    return await requestScript(ctx, prompt, JSON.stringify({ draft, script, issues }), temperature);
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    ctx.log(`修复调用失败：${errorText(error)}`, "warn");
    return null;
  }
}

/** 未达约束时修复一次，修复不收敛则保留原稿 */
async function enforceRules(
  ctx: TaskContext,
  prompt: string,
  script: RawTranscript,
  rules: ScriptRules,
  draft: string,
): Promise<RawTranscript> {
  const issues = scriptIssues(script, rules);
  if (issues.length === 0) return script;

  ctx.log(`剧本未达约束：${issues[0]}${issues.length > 1 ? `（共 ${issues.length} 项）` : ""}`, "warn");
  ctx.markStage("rewrite", "running", "按约束修复");

  const fixed = await fixScript(ctx, prompt, script, issues, draft, 0.5);
  if (!fixed) return script;

  const left = scriptIssues(fixed, rules);
  if (left.length >= issues.length) {
    ctx.log("修复未收敛，保留原稿", "warn");
    return script;
  }

  ctx.log(left.length ? `修复后仍有 ${left.length} 项偏差` : "约束已修正", left.length ? "warn" : "info");
  return fixed;
}

export interface Critique {
  overall: number;
  issues: string[];
}

export function parseCritique(answer: string): Critique | null {
  const json = extractJsonObject(answer);
  if (!json) return null;

  try {
    const data = JSON.parse(json) as { overall?: unknown; scores?: unknown; issues?: unknown };
    const scores =
      data.scores && typeof data.scores === "object" ? Object.values(data.scores as Record<string, unknown>) : [];
    const numbers = scores.map(Number).filter((n) => Number.isFinite(n));

    let overall = Number(data.overall);
    if (!Number.isFinite(overall)) {
      overall = numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : Number.NaN;
    }
    if (!Number.isFinite(overall)) return null;
    if (overall > 1) overall /= 100;

    const issues = Array.isArray(data.issues)
      ? data.issues.filter((v): v is string => typeof v === "string" && v.trim().length > 0).slice(0, 6)
      : [];

    return { overall: Math.min(1, Math.max(0, overall)), issues };
  } catch {
    return null;
  }
}

/** 审稿失败不阻塞出稿 */
async function critiqueScript(
  ctx: TaskContext,
  prompt: string,
  script: RawTranscript,
  draft: string,
): Promise<Critique | null> {
  try {
    const input = JSON.stringify({
      style: ctx.options.promptSource,
      speakers: ctx.options.speakers,
      draft,
      script,
    });
    const answer = await chat(prompt, input, { json: true, signal: ctx.signal, temperature: 0.2 });
    const critique = parseCritique(answer);
    if (!critique) ctx.log("审稿结果无法解析，跳过返修", "warn");
    return critique;
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    ctx.log(`审稿失败，跳过：${errorText(error)}`, "warn");
    return null;
  }
}

/** 抓取 → 写草稿 → 改写 → 校验/审稿 → 分句，每步落盘并可复用 */
export async function runScriptStages(ctx: TaskContext): Promise<Transcript> {
  const scriptFile = path.join(ctx.workspace, FILES.script);

  if (fs.existsSync(scriptFile)) {
    ctx.log("复用已生成的剧本（_transcript.json）");
    const raw = normalizeRaw(readJson<unknown>(scriptFile));
    const transcript = toTranscript(raw);
    for (const id of SCRIPT_STAGES) ctx.markStage(id, "skipped", "命中缓存");
    ctx.markStage("split", "done", `${transcript.paragraphs.length} 段 / ${sentenceCount(transcript)} 句`, {
      sections: transcript.paragraphs.length,
      sentences: sentenceCount(transcript),
    });
    return transcript;
  }

  const prompts = loadPrompts(ctx.options.promptSource, ctx.options.speakers);
  const rules = scriptRules(ctx.options.promptSource, ctx.options.speakers);

  ctx.markStage("fetch", "running");
  const htmlFile = path.join(ctx.workspace, FILES.html);
  let content: string;
  if (fs.existsSync(htmlFile)) {
    content = fs.readFileSync(htmlFile, "utf-8");
    ctx.log("复用已抓取的正文");
  } else {
    content = await fetchContent(ctx.input, ctx.signal, ctx.log);
    fs.writeFileSync(htmlFile, content, "utf-8");
  }
  ctx.markStage("fetch", "done", `${content.length} 字`);

  ctx.markStage("write", "running");
  const draftFile = path.join(ctx.workspace, FILES.draft);
  let draft: string;
  if (fs.existsSync(draftFile)) {
    draft = fs.readFileSync(draftFile, "utf-8");
    ctx.log("复用已生成的草稿");
  } else {
    ctx.log(`正在用「${ctx.options.promptSource}」风格撰写草稿…`);
    draft = await chat(prompts.writer, content, { signal: ctx.signal, temperature: 0.9 });
    fs.writeFileSync(draftFile, draft, "utf-8");
  }
  ctx.markStage("write", "done", `${draft.length} 字`);

  ctx.markStage("rewrite", "running");
  const review = loadCriticPrompts();
  let script = await requestScript(ctx, prompts.rewriter, draft, 0.8);
  script = await enforceRules(ctx, review.repair, script, rules, draft);

  if (REVIEW_ENABLED) {
    ctx.markStage("rewrite", "running", "审稿中");
    const critique = await critiqueScript(ctx, review.critic, script, draft);
    if (critique) {
      const score = Math.round(critique.overall * 100);
      ctx.log(
        `审稿评分 ${score} 分（阈值 ${Math.round(REVIEW_THRESHOLD * 100)}）${critique.issues[0] ? `：${critique.issues[0]}` : ""}`,
        critique.overall < REVIEW_THRESHOLD ? "warn" : "info",
      );

      if (critique.overall < REVIEW_THRESHOLD && critique.issues.length > 0) {
        ctx.markStage("rewrite", "running", "按审稿意见返修");
        const revised = await fixScript(ctx, review.repair, script, critique.issues, draft, 0.6);
        if (revised && scriptIssues(revised, rules).length <= scriptIssues(script, rules).length) {
          script = revised;
          ctx.log("已按审稿意见返修一次");
        } else {
          if (revised) ctx.log("返修后约束变差，保留原稿", "warn");
        }
      }
    }
  }

  fs.writeFileSync(scriptFile, JSON.stringify(script, null, 2), "utf-8");
  ctx.markStage("rewrite", "done", `${script.paragraphs.length} 段`);

  ctx.markStage("split", "running");
  const transcript = toTranscript(script);
  ctx.markStage("split", "done", `${transcript.paragraphs.length} 段 / ${sentenceCount(transcript)} 句`, {
    sections: transcript.paragraphs.length,
    sentences: sentenceCount(transcript),
  });
  ctx.log(`剧本已就绪：${transcript.title}`);

  return transcript;
}

/** 确认后的剧本重新分句并落盘 */
export function persistConfirmed(workspace: string, raw: RawTranscript): Transcript {
  const normalized = normalizeRaw(raw);
  fs.writeFileSync(path.join(workspace, FILES.script), JSON.stringify(normalized, null, 2), "utf-8");
  return toTranscript(normalized);
}
