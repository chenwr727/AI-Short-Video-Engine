export interface SubtitleCue {
  text: string;
  start: number;
  end: number;
  style: "Subtitle" | "Title";
}

export interface AssOptions {
  width: number;
  height: number;
  fontName: string;
  subtitleSize: number;
  titleSize: number;
  subtitleMarginV: number;
  titleMarginV: number;
  marginL: number;
  marginR: number;
  subtitleOutline: number;
  titleOutline: number;
  subtitleShadow: number;
  titleShadow: number;
  /** AABBGGRR */
  shadowColour: string;
  maxChars: number;
}

export function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/** 替换 ASS 语法字符 */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "／")
    .replace(/\{/g, "（")
    .replace(/\}/g, "）")
    .replace(/\r?\n/g, " ")
    .trim();
}

const CJK = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

/** 汉字实测占宽约为字号的 0.76 倍 */
export const CJK_WIDTH_EM = 0.76;

/** 全角 1，半角 0.5 */
function charWidth(ch: string): number {
  return CJK.test(ch) ? 1 : 0.5;
}

export function charsPerLine(areaPx: number, fontSize: number): number {
  if (fontSize <= 0) return 0;
  return Math.max(4, Math.floor(areaPx / (fontSize * CJK_WIDTH_EM)));
}

/** 行首禁止出现的标点 */
const TAIL_PUNCT = /^[，。、；：！？）】」』…—,.;:!?)]$/;

/** 只能贴在前字之后的后附成分 */
const BAD_LINE_START = /^[的地得着了过们之其]$/;

/** 断在其后会产生悬空字 */
const BAD_LINE_END =
  /[的了着过地得是把被靠对向从为以之其个只次种件条位名句段张本台套份但更还也就都又才再然而并或因所如既虽可却将且于是若则]$/;

/** 环境不支持分词器时为 null */
const segmenter = (() => {
  try {
    return new Intl.Segmenter("zh-CN", { granularity: "word" });
  } catch {
    return null;
  }
})();

/** 断点等级：词内 0 / 词接缝 1 / 标点后 2 */
const Break = {
  Inside: 0,
  BetweenWords: 1,
  AfterPunct: 2,
} as const;

/** 标记每个位置前一位的断点等级 */
function breakLevels(text: string, size: number): Uint8Array {
  const levels = new Uint8Array(size + 1);

  if (!segmenter) {
    const chars = [...text];
    let index = 0;
    for (const ch of chars) {
      index += 1;
      if (TAIL_PUNCT.test(ch)) levels[index] = Break.AfterPunct;
    }
    return levels;
  }

  const parts = [...segmenter.segment(text)].map((part) => ({
    index: part.index,
    length: [...part.segment].length,
  }));

  for (let i = 1; i < parts.length; i++) {
    const next = parts[i];
    if (!next) continue;
    levels[next.index] = Break.BetweenWords;
  }

  const chars = [...text];
  for (let at = 0; at < chars.length; at++) {
    if (TAIL_PUNCT.test(chars[at] as string)) levels[at + 1] = Break.AfterPunct;
  }
  return levels;
}

const MID_WORD_COST = 300;
const WORD_SEAM_COST = 6;
const BAD_EDGE_COST = 120;
const HEAD_PUNCT_COST = 2000;

/** 行数固定，让各行宽度尽量贴近均值 */
function optLines(chars: string[], width: number[], maxChars: number, levels: Uint8Array): number[] | null {
  const n = chars.length;
  const total = width[n] as number;
  const lineCount = Math.max(1, Math.ceil(total / maxChars));
  const target = total / lineCount;
  const span = (from: number, to: number): number => (width[to] as number) - (width[from] as number);

  // best[k][i]：k 行排完 chars[i..] 的最小代价；next[k][i]：首行结束位置
  const INF = Number.POSITIVE_INFINITY;
  const best: number[][] = Array.from({ length: lineCount + 1 }, () => new Array<number>(n + 1).fill(INF));
  const next: number[][] = Array.from({ length: lineCount + 1 }, () => new Array<number>(n + 1).fill(n));

  for (let k = 0; k <= lineCount; k++) best[k]![n] = 0;

  for (let k = 1; k <= lineCount; k++) {
    const bestHere = best[k] as number[];
    const bestRest = best[k - 1] as number[];
    const nextHere = next[k] as number[];

    for (let start = n - 1; start >= 0; start--) {
      for (let end = start + 1; end <= n; end++) {
        const lineWidth = span(start, end);
        if (lineWidth > maxChars) break;

        let cost = (target - lineWidth) ** 2;

        if (end < n) {
          const head = chars[end] as string;
          if (TAIL_PUNCT.test(head)) cost += HEAD_PUNCT_COST;
          else {
            const level = levels[end] as number;
            if (level === Break.Inside) cost += MID_WORD_COST;
            else if (level === Break.BetweenWords) cost += WORD_SEAM_COST;
          }
          if (BAD_LINE_START.test(head)) cost += BAD_EDGE_COST;
          if (BAD_LINE_END.test(chars[end - 1] as string)) cost += BAD_EDGE_COST;
        }

        const rest = bestRest[end] as number;
        if (rest === INF) continue;

        const totalCost = cost + rest;
        if (totalCost < (bestHere[start] as number)) {
          bestHere[start] = totalCost;
          nextHere[start] = end;
        }
      }
    }
  }

  if (best[lineCount]![0] === INF) return null;

  const cuts: number[] = [];
  let at = 0;
  for (let k = lineCount; k >= 1; k--) {
    const end = (next[k] as number[])[at] as number;
    // 断点必须前进，防止异常输入死循环
    const safeEnd = end > at ? Math.min(end, n) : (k === 1 ? n : at + 1);
    cuts.push(safeEnd);
    at = safeEnd;
  }
  return cuts;
}

/** 按可见宽度折行，行间用 \N */
export function wrapAssText(text: string, maxChars: number): string {
  if (maxChars < 4) return text;

  const chars = [...text];
  // width[i]：前 i 个字的累计可见宽度
  const width: number[] = [0];
  for (const ch of chars) width.push((width[width.length - 1] as number) + charWidth(ch));
  const total = width[width.length - 1] as number;
  const n = chars.length;
  if (total <= maxChars) return text;

  const levels = breakLevels(text, n);
  const cuts = optLines(chars, width, maxChars, levels);
  if (!cuts) return text;

  const lines: string[] = [];
  let at = 0;
  for (const cut of cuts) {
    lines.push(chars.slice(at, cut).join(""));
    at = cut;
  }

  return lines.join("\\N");
}

/** 转义后折行 */
export function layoutCueText(text: string, o: AssOptions): string {
  return wrapAssText(escapeAssText(text), o.maxChars);
}

export function buildAss(cues: SubtitleCue[], o: AssOptions): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${o.width}`,
    `PlayResY: ${o.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Subtitle,${o.fontName},${o.subtitleSize},&H00FFFFFF,&H00FFFFFF,&H00000000,${o.shadowColour},0,0,0,0,100,100,0.5,0,1,${o.subtitleOutline},${o.subtitleShadow},2,${o.marginL},${o.marginR},${o.subtitleMarginV},1`,
    `Style: Title,${o.fontName},${o.titleSize},&H00FFFFFF,&H00FFFFFF,&H00000000,${o.shadowColour},0,0,0,0,100,100,0.5,0,1,${o.titleOutline},${o.titleShadow},5,${o.marginL},${o.marginR},${o.titleMarginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${formatAssTime(cue.start)},${formatAssTime(cue.end)},${cue.style},,0,0,0,,${layoutCueText(
        cue.text,
        o,
      )}`,
  );

  return `${[...header, ...events].join("\n")}\n`;
}
