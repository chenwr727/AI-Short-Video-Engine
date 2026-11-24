import crypto from "node:crypto";
import * as cheerio from "cheerio";
import type { LogLine } from "../types.js";

const MAX_CONTENT = 60_000;
/** 网页正文下限，低于此值多半是登录页、验证页或纯脚本渲染 */
const MIN_CONTENT = 300;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const REMOVE_TAGS =
  "script, style, noscript, iframe, svg, canvas, template, form, button, input, select, textarea, nav, header, footer, aside";
const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, td";
/** 这些容器基本不可能是正文，直接整块丢掉 */
const NOISE_STRONG =
  /(comment|share|related|recommend|breadcrumb|sidebar|advert|sponsor|评论|推荐|相关|分享|广告|侧栏)/i;
/** 这些词也可能出现在正文外层容器上，只有几乎没段落时才丢 */
const NOISE_WEAK = /(nav|header|footer|toolbar|banner)/i;
/** 开头的博客导航残句 */
const CHROME_LINE = /^(上一篇|下一篇|分类|标签|作者|归档|目录|分享到|责任编辑|来源)\s*[:：]/;
/** 结尾的站点信息与回顾 */
const TAIL_LINE = /^(（完）|\(完\)|文档信息|版权声明|免责声明|转载声明|本文链接|原文链接|发表日期|往年回顾|相关阅读)/;
/** 结尾的回顾/推荐区块，从标题处整段丢弃 */
const TAIL_SECTION = /^(往年回顾|往期回顾|相关推荐|推荐阅读|延伸阅读|相关文章|参考文献)$/;
/** 常见的正文容器，按优先级尝试 */
const CANDIDATES = [
  "article",
  "main",
  "[role='main']",
  "#js_content",
  ".rich_media_content",
  ".article-content",
  ".article_content",
  ".article-body",
  ".post-content",
  ".entry-content",
  ".markdown-body",
  "#content",
  ".content",
  ".post",
  "#article",
];
/** 反爬/验证页特征，仅在正文很短时才判定，避免误伤正常文章 */
const BOT_MARKERS = [
  "正在进行安全检测",
  "安全验证",
  "访问验证",
  "请稍候",
  "访问过于频繁",
  "verify you are human",
  "checking your browser",
  "enable javascript and cookies",
  "just a moment",
  "attention required",
];
const BOT_HTML = /cf-browser-verification|challenge-platform|__cf_chl_|geetest|captcha/i;

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
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** 去重，顺带丢弃被更长段落包含的碎片 */
export function dedupeParagraphs(lines: string[]): string[] {
  const kept: string[] = [];

  for (const raw of lines.slice(0, 400)) {
    const line = raw.trim();
    if (line.length < 2) continue;
    if (kept.some((item) => item === line || item.includes(line))) continue;

    for (let i = kept.length - 1; i >= 0; i--) {
      if (line.includes(kept[i] ?? "")) kept.splice(i, 1);
    }
    kept.push(line);
  }

  return kept;
}

/** 粗判正文：中文文章看字数与句读，英文看词句数 */
export function isSubstantial(text: string, min = MIN_CONTENT): boolean {
  const chars = countChars(text);
  if (chars < min) return false;

  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  if (cjk > 0) {
    if (cjk / chars < 0.15) return false;
    return (text.match(/[。！？；]/g) ?? []).length >= 5;
  }

  return (text.match(/[.!?]\s/g) ?? []).length >= 8;
}

/**
 * 判断抓到的是否为「列表页 / 导航页」而非文章正文。
 * 正文的字/句读比通常在 30~60，列表页全是短标题，比值会高到 100 以上；
 * 再加上平均行长明显偏短（标题一行十几字），两个信号同时命中才判定。
 */
export function looksLikeListing(text: string): string | null {
  const chars = countChars(text);
  if (chars < 300) return null;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const punct = (text.match(/[。！？；]/g) ?? []).length;
  const charsPerPunct = chars / Math.max(punct, 1);
  const avgLine = chars / Math.max(lines.length, 1);

  if (charsPerPunct >= 90 && avgLine < 30) {
    return `平均每 ${Math.round(charsPerPunct)} 字才有一个句号，平均行长仅 ${Math.round(avgLine)} 字，像是列表或导航页`;
  }
  return null;
}

/** 只在正文很短时按反爬特征判定，正常文章提到这些词不受影响 */
export function detectAntiBot(title: string, text: string, html: string): string | null {
  if (countChars(text) >= 2000) return null;

  const head = `${title}\n${text.slice(0, 500)}`.toLowerCase();
  const marker = BOT_MARKERS.find((word) => head.includes(word));
  if (marker) return marker;
  if (BOT_HTML.test(html)) return "cloudflare";

  return null;
}

export function charsetFrom(contentType: string | null, head: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  return (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
}

function decodeHtml(buffer: ArrayBuffer, contentType: string | null): string {
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder("utf-8").decode(bytes.slice(0, 4096));
  const charset = charsetFrom(contentType, head);

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
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

  return dedupeParagraphs(found.flatMap((item) => item.split(/\n{2,}/))).join("\n\n");
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
  return dedupeParagraphs(parts.flatMap((item) => item.split(/\n{2,}/))).join("\n\n");
}

/** 砍掉开头结尾的博客导航残句 */
function trimChrome(text: string): string {
  const lines = text.split("\n");
  const blank = (line: string | undefined): boolean => !line?.trim();
  const chrome = (line: string | undefined): boolean => CHROME_LINE.test((line ?? "").trim());
  let start = 0;
  let end = lines.length;

  while (start < end && (blank(lines[start]) || chrome(lines[start]))) start++;
  while (
    end > start &&
    (blank(lines[end - 1]) || chrome(lines[end - 1]) || TAIL_LINE.test((lines[end - 1] ?? "").trim()))
  ) {
    end--;
  }

  // 只在后半段出现时才当作结尾区块，避免误伤正文中间的小标题
  const section = lines.findIndex((line) => TAIL_SECTION.test(line.trim()));
  if (section > start && section > lines.length * 0.6) end = Math.min(end, section);

  return lines.slice(start, end).join("\n").trim();
}

export interface ExtractedArticle {
  title: string;
  text: string;
  source: "dom" | "jsonld" | "script";
  linkDensity: number;
}

/** 正文节点打分：文本越长、段落越多、链接占比越低越好 */
function extractDom(html: string): { title: string; text: string; linkDensity: number } {
  const $ = cheerio.load(html);
  const title = normalize($("title").first().text() || $('meta[property="og:title"]').attr("content") || "");

  $(REMOVE_TAGS).remove();
  $("body *").each((_, el) => {
    const $el = $(el);
    const name = `${$el.attr("class") ?? ""} ${$el.attr("id") ?? ""}`;
    const weak = NOISE_WEAK.test(name) && $el.find(BLOCKS).length <= 1;
    if (NOISE_STRONG.test(name) || weak) $el.remove();
  });

  const textOf = (node: ReturnType<typeof $>): string => {
    const parts: string[] = [];
    node.find(BLOCKS).each((_, el) => {
      // 只取叶子块，避免父子重复
      if ($(el).find(BLOCKS).length > 0) return;
      const piece = normalize($(el).text());
      if (piece) parts.push(piece);
    });

    const joined = dedupeParagraphs(parts).join("\n\n");
    return joined.length >= 100 ? joined : normalize(node.text());
  };

  const densityOf = (node: ReturnType<typeof $>, length: number): number => {
    const links = countChars(node.find("a").text());
    return Math.min(1, links / Math.max(length, 1));
  };

  let best = textOf($("body"));
  let bestDensity = densityOf($("body"), best.length);
  let bestScore = best.length * (1 - Math.min(bestDensity, 0.8));

  for (const selector of CANDIDATES) {
    const node = $(selector).first();
    if (node.length === 0) continue;

    const text = textOf(node);
    if (text.length < 100) continue;

    const density = densityOf(node, text.length);
    const paragraphs = text.split("\n").length;
    const score = text.length * (1 - Math.min(density, 0.8)) + paragraphs * 60;

    if (score > bestScore) {
      best = text;
      bestDensity = density;
      bestScore = score;
    }
  }

  return { title, text: trimChrome(best), linkDensity: bestDensity };
}

/** 按 DOM → JSON-LD → 内嵌数据 的顺序取第一份合格正文 */
export function extractArticle(html: string): ExtractedArticle {
  const dom = extractDom(html);
  if (isSubstantial(dom.text)) return { title: dom.title, text: dom.text, source: "dom", linkDensity: dom.linkDensity };

  const jsonLd = normalize(extractJsonLd(html));
  if (isSubstantial(jsonLd)) return { title: dom.title, text: jsonLd, source: "jsonld", linkDensity: 0 };

  const script = normalize(extractFromScripts(html));
  if (isSubstantial(script)) return { title: dom.title, text: script, source: "script", linkDensity: 0 };

  // 都不达标时返回最长的一份，由调用方决定是否报错
  const options: { source: ExtractedArticle["source"]; text: string }[] = [
    { source: "dom", text: dom.text },
    { source: "jsonld", text: jsonLd },
    { source: "script", text: script },
  ];
  const longest = options.reduce((best, current) => (current.text.length > best.text.length ? current : best));
  return { title: dom.title, text: longest.text, source: longest.source, linkDensity: dom.linkDensity };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("已取消", "AbortError"));
      },
      { once: true },
    );
  });
}

/** 网络错误与 5xx 再试一次，4xx 直接给可读提示 */
async function fetchHtml(url: string, signal: AbortSignal, log: Logger): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        redirect: "follow",
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (attempt === 1) throw error;
      log("抓取失败，重试一次…", "warn");
      await sleep(600, signal);
      continue;
    }

    if (res.status === 403 || res.status === 429) {
      throw new Error(`站点拒绝抓取（HTTP ${res.status}），可能有反爬限制。请打开页面复制正文粘贴到输入框。`);
    }
    if (res.status >= 500 && attempt === 0) {
      log(`站点返回 ${res.status}，重试一次…`, "warn");
      await sleep(600, signal);
      continue;
    }
    if (!res.ok) throw new Error(`抓取失败（HTTP ${res.status}）：${url}`);

    return decodeHtml(await res.arrayBuffer(), res.headers.get("content-type"));
  }

  throw new Error(`抓取失败：${url}`);
}

function truncate(text: string): string {
  if (text.length <= MAX_CONTENT) return text;

  const cut = text.lastIndexOf("\n", MAX_CONTENT);
  return text.slice(0, cut > MAX_CONTENT * 0.8 ? cut : MAX_CONTENT);
}

/** URL 抓取正文，非 URL 直接当正文 */
export async function fetchContent(input: string, signal: AbortSignal, log: Logger): Promise<string> {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    const text = truncate(normalize(trimmed));
    log(`使用粘贴的正文（${text.length} 字）`);
    return text;
  }

  log(`抓取网页：${trimmed}`);
  const html = await fetchHtml(trimmed, signal, log);
  let article = extractArticle(html);

  const botReason = detectAntiBot(article.title, article.text, html);
  if (botReason) {
    throw new Error(
      `抓到的是一张验证页（命中「${botReason}」），不是文章正文。请用浏览器打开页面，复制正文粘贴到输入框。`,
    );
  }

  if (/^https?:\/\/(www\.)?36kr\.com\/p\//.test(trimmed)) {
    const extra = normalize(decode36kr(html));
    if (extra) {
      article = {
        ...article,
        text: trimChrome(dedupeParagraphs([...extra.split(/\n{2,}/), ...article.text.split(/\n{2,}/)]).join("\n\n")),
        source: "script",
      };
      log("已解密 36kr 正文数据");
    } else if (!isSubstantial(article.text)) {
      log("36kr 正文解密失败，页面可见文本也不足", "warn");
    }
  }

  const chars = countChars(article.text);
  if (!isSubstantial(article.text)) {
    throw new Error(
      `抓到的正文只有 ${chars} 字，可能是登录页、验证页，或内容由脚本动态渲染。` +
        `请用浏览器打开页面，复制正文粘贴到输入框。`,
    );
  }

  // 列表页字数够、但全是短标题，放过去会让模型从标题里瞎猜主题
  const listing = looksLikeListing(article.text);
  if (listing) {
    throw new Error(`抓到的不是文章正文（${listing}）。请打开具体文章页，或复制正文粘贴到输入框。`);
  }

  const text = truncate(article.text);
  const paragraphs = text.split(/\n{2,}/).length;
  log(`抓取完成：正文 ${chars} 字 · ${paragraphs} 段 · 来源 ${article.source}`);

  if (article.linkDensity > 0.25) {
    log(`正文里链接占比 ${Math.round(article.linkDensity * 100)}%，可能混入了导航或推荐位`, "warn");
  }
  if (text.length < article.text.length) log(`正文过长，截断到 ${MAX_CONTENT} 字`, "warn");

  return text;
}
