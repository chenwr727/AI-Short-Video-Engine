import fs from "node:fs";
import path from "node:path";
import { chat, extractJsonObject } from "../services/llm.js";
import { fetchContent } from "../services/fetcher.js";
import { loadPrompts } from "../services/prompts.js";
import { splitContent } from "./split.js";
import type { RawTranscript, TaskContext, Transcript } from "../types.js";

const FILES = {
  html: "_html.txt",
  draft: "_transcript.txt",
  script: "_transcript.json",
} as const;

const SCRIPT_STAGES = ["fetch", "write", "rewrite", "split"] as const;

function normalizeRaw(input: unknown): RawTranscript {
  const obj = input as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") throw new Error("剧本格式错误：顶层不是对象");

  const rawTitle = obj.title;
  const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : "未命名";

  const rawParagraphs = obj.paragraphs;
  if (!Array.isArray(rawParagraphs) || rawParagraphs.length === 0) {
    throw new Error("剧本格式错误：缺少 paragraphs");
  }

  const paragraphs: RawTranscript["paragraphs"] = [];
  for (const p of rawParagraphs) {
    const paragraph = p as Record<string, unknown> | null;
    if (!paragraph) continue;

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

    if (dialogues.length === 0) continue;
    const description = typeof paragraph.description === "string" ? paragraph.description.trim() : "";
    paragraphs.push({ description, dialogues });
  }

  if (paragraphs.length === 0) throw new Error("剧本格式错误：没有有效对话");
  return { title, paragraphs };
}

/** 原始剧本 → 已分句剧本 */
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
  return transcript.paragraphs.reduce(
    (sum, p) => sum + p.dialogues.reduce((s, d) => s + d.contents.length, 0),
    0,
  );
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

/**
 * M1 流水线：抓取内容 → LLM 写草稿 → LLM 改写成结构化剧本 → 分句。
 * 每一步都落盘缓存，重复运行会直接复用。
 */
export async function runScriptStages(ctx: TaskContext): Promise<Transcript> {
  const scriptFile = path.join(ctx.workspace, FILES.script);

  if (fs.existsSync(scriptFile)) {
    ctx.log("复用已生成的剧本（_transcript.json）");
    const raw = normalizeRaw(readJson<unknown>(scriptFile));
    const transcript = toTranscript(raw);
    for (const id of SCRIPT_STAGES) ctx.markStage(id, "skipped", "命中缓存");
    ctx.markStage("split", "done", `${transcript.paragraphs.length} 段 / ${sentenceCount(transcript)} 句`);
    return transcript;
  }

  const prompts = loadPrompts(ctx.options.promptSource, ctx.options.speakers);

  // 1) 内容
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

  // 2) 草稿
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

  // 3) 改写为结构化剧本
  ctx.markStage("rewrite", "running");
  const rewritten = await chat(prompts.rewriter, draft, {
    json: true,
    signal: ctx.signal,
    temperature: 0.8,
  });
  const jsonText = extractJsonObject(rewritten);
  if (!jsonText) throw new Error("剧本改写失败：模型没有返回合法 JSON");

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`剧本改写失败：JSON 解析出错\n${jsonText.slice(0, 300)}`);
  }
  const raw = normalizeRaw(parsed);
  fs.writeFileSync(scriptFile, JSON.stringify(raw, null, 2), "utf-8");
  ctx.markStage("rewrite", "done", `${raw.paragraphs.length} 段`);

  // 4) 分句
  ctx.markStage("split", "running");
  const transcript = toTranscript(raw);
  ctx.markStage("split", "done", `${transcript.paragraphs.length} 段 / ${sentenceCount(transcript)} 句`);
  ctx.log(`剧本已就绪：${transcript.title}`);

  return transcript;
}

/** 确认（或修改后）的剧本重新分句并落盘 */
export function persistConfirmed(workspace: string, raw: RawTranscript): Transcript {
  const normalized = normalizeRaw(raw);
  fs.writeFileSync(path.join(workspace, FILES.script), JSON.stringify(normalized, null, 2), "utf-8");
  return toTranscript(normalized);
}
