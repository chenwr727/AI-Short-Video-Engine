import crypto from "node:crypto";
import * as cheerio from "cheerio";
import type { LogLine } from "../types.js";

const MAX_CONTENT = 60_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type Logger = (text: string, level?: LogLine["level"]) => void;

/** 36kr 正文加密在 window.initialState 里 */
function decode36kr(html: string): string {
  const match = /window\.initialState=(\{[\s\S]*\})/.exec(html);
  if (!match?.[1]) return "";

  try {
    const state = JSON.parse(match[1]) as { state?: string };
    if (!state.state) return "";

    const decipher = crypto.createDecipheriv("aes-128-ecb", Buffer.from("efabccee-b754-4c", "utf-8"), null);
    decipher.setAutoPadding(true);
    const plain = Buffer.concat([decipher.update(Buffer.from(state.state, "base64")), decipher.final()]).toString(
      "utf-8",
    );

    const parsed = JSON.parse(plain) as {
      article?: { detail?: { data?: unknown } };
      articleDetail?: { articleDetailData?: { data?: unknown } };
    };
    const data = parsed.article?.detail?.data ?? parsed.articleDetail?.articleDetailData?.data;
    return data ? JSON.stringify(data) : "";
  } catch {
    return "";
  }
}

function normalize(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 粗判正文，排除 base64 与压缩 JS */
function looksLikeProse(value: string): boolean {
  if (value.length < 120) return false;
  if (/^data:/.test(value) || /^[A-Za-z0-9+/=]{200,}$/.test(value)) return false;
  const cjk = (value.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  if (cjk >= 60) return true;
  const words = value.trim().split(/\s+/).length;
  const symbols = (value.match(/[{};=<>]/g) ?? []).length;
  return words >= 80 && symbols / value.length < 0.02;
}

/** 递归收集像正文的字符串，最多 200 条 */
function collectProse(value: unknown, out: string[], depth = 0): void {
  if (out.length >= 200 || depth > 12) return;

  if (typeof value === "string") {
    if (looksLikeProse(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProse(item, out, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectProse(item, out, depth + 1);
  }
}

/** 从 script 内嵌 JSON 提取内容 */
function extractFromScripts(html: string): string {
  const found: string[] = [];

  for (const match of html.matchAll(/<script[^>]*>([\s\S]{200,}?)<\/script>/gi)) {
    const body = match[1]?.trim();
    if (!body) continue;
    // 剥掉 window.__INITIAL_STATE__ = 这类赋值前缀
    const jsonText = body.replace(/^[A-Za-z_$][\w$.]*\s*=\s*/, "").replace(/;?\s*$/, "");
    if (!/^[[{]/.test(jsonText)) continue;

    try {
      collectProse(JSON.parse(jsonText), found);
    } catch {
      // 非 JSON 跳过
    }
  }

  return [...new Set(found)].join("\n\n");
}

/** JSON-LD 中的 articleBody */
function extractJsonLd(html: string): string {
  const parts: string[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1] ?? "") as unknown;
      for (const node of Array.isArray(data) ? data : [data]) {
        const body = (node as { articleBody?: unknown }).articleBody;
        if (typeof body === "string" && body.length > 100) parts.push(body);
      }
    } catch {
      // 部分站点的 JSON-LD 带注释，忽略
    }
  }
  return parts.join("\n\n");
}

/** 最后一档兜底 */
function extractMeta($: cheerio.CheerioAPI): string {
  return normalize(
    $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:title"]').attr("content") ||
      "",
  );
}

/** URL 抓取正文，非 URL 直接当正文 */
export async function fetchContent(input: string, signal: AbortSignal, log: Logger): Promise<string> {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    log(`使用粘贴的正文（${trimmed.length} 字）`);
    return trimmed;
  }

  log(`抓取网页：${trimmed}`);
  const res = await fetch(trimmed, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`抓取失败（HTTP ${res.status}）：${trimmed}`);

  const html = await res.text();

  // 内嵌数据通常更完整，DOM 文本作补充
  const jsonLdText = extractJsonLd(html);
  const scriptText = extractFromScripts(html);

  const $ = cheerio.load(html);
  const metaText = extractMeta($);
  $("script, style, noscript, iframe, svg, nav, footer, header, aside, form").remove();
  const domText = normalize($("body").text() || $("article").text());

  const pieces: string[] = [];
  if (jsonLdText) {
    pieces.push(jsonLdText);
    log("从 JSON-LD 结构化数据取到正文");
  }
  if (scriptText) {
    pieces.push(scriptText);
    log("从页面内嵌数据取到正文");
  }
  // DOM 文本含导航与推荐位，最后兜底
  if (domText.length >= 50) pieces.push(domText);
  else if (metaText) {
    pieces.push(metaText);
    log("页面可见文本过少，只用摘要（成稿会比较短）", "warn");
  }

  let text = normalize(pieces.join("\n\n"));

  if (/^https?:\/\/(www\.)?36kr\.com\/p\//.test(trimmed)) {
    const extra = decode36kr(html);
    if (extra) {
      text = normalize(`${extra}\n\n${text}`);
      log("已解密 36kr 正文数据");
    } else {
      log("36kr 正文解密失败，退回到页面可见文本", "warn");
    }
  }

  if (text.length < 50) {
    throw new Error(
      "抓取到的正文过短：这个页面可能在浏览器里才渲染内容，或需要登录。请打开页面复制正文后粘贴到输入框。",
    );
  }

  if (text.length > MAX_CONTENT) {
    log(`正文过长，截断到 ${MAX_CONTENT} 字`, "warn");
    text = text.slice(0, MAX_CONTENT);
  }

  log(`抓取完成，正文 ${text.length} 字`);
  return text;
}
