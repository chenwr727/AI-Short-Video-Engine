import crypto from "node:crypto";
import * as cheerio from "cheerio";
import type { LogLine } from "../types.js";

const MAX_CONTENT = 60_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type Logger = (text: string, level?: LogLine["level"]) => void;

/** 36kr 正文被 AES 加密在 window.initialState 里，复用 Python 版的解密逻辑 */
function decode36kr(html: string): string {
  const match = /window\.initialState=(\{[\s\S]*\})/.exec(html);
  if (!match?.[1]) return "";

  try {
    const state = JSON.parse(match[1]) as { state?: string };
    if (!state.state) return "";

    const decipher = crypto.createDecipheriv("aes-128-ecb", Buffer.from("efabccee-b754-4c", "utf-8"), null);
    decipher.setAutoPadding(true);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(state.state, "base64")),
      decipher.final(),
    ]).toString("utf-8");

    const parsed = JSON.parse(plain) as Record<string, any>;
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

/**
 * 统一入口：URL 抓取正文，非 URL 直接当正文使用。
 * 返回可直接喂给 LLM 的纯文本。
 */
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
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, svg, nav, footer, header, aside, form").remove();

  let text = normalize($("body").text() || $("article").text());

  if (/^https?:\/\/(www\.)?36kr\.com\/p\//.test(trimmed)) {
    const extra = decode36kr(html);
    if (extra) {
      text += `\n${extra}`;
      log("已解密 36kr 正文数据");
    } else {
      log("36kr 正文解密失败，退回到页面可见文本", "warn");
    }
  }

  if (text.length < 50) {
    throw new Error("抓取到的正文过短，可能是动态渲染页面。请改用「直接粘贴正文」");
  }

  if (text.length > MAX_CONTENT) {
    log(`正文过长，截断到 ${MAX_CONTENT} 字`, "warn");
    text = text.slice(0, MAX_CONTENT);
  }

  log(`抓取完成，正文 ${text.length} 字`);
  return text;
}
