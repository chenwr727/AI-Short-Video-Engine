/**
 * ASS 字幕生成。排版参数对齐 Python 版：
 * 字幕宽度 = 画宽 × 0.8，字号 = 字幕宽度 / 17，垂直位置 = 画高 × 0.667。
 * 中文长句自己按可见宽度插 \N 换行：libass 的自动换行对无空格中文并不可靠，
 * 一行超宽会直接被画面裁掉（WrapStyle 0 仍保留作为兜底）。
 */
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
  /** 每行最多多少个「全角字宽」，由字幕区宽度 / 字号算出来 */
  maxChars: number;
}

export function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/** 花括号会被 ASS 当成绘图/标签语法，需要替换掉 */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "／")
    .replace(/\{/g, "（")
    .replace(/\}/g, "）")
    .replace(/\r?\n/g, " ")
    .trim();
}

const CJK = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

/** 全角字符算 1 个字宽，半角算 0.5 */
function charWidth(ch: string): number {
  return CJK.test(ch) ? 1 : 0.5;
}

/** 行首不能出现的标点：遇到就并回上一行 */
const TAIL_PUNCT = /^[，。、；：！？）】」』…—,.;:!?)]$/;

/**
 * 按可见宽度折行，行间用 ASS 的 \N。
 * 行数确定后把宽度均分，避免最后一行只剩一两个字。
 */
export function wrapAssText(text: string, maxChars: number): string {
  if (maxChars < 4) return text;

  const chars = [...text];
  const total = chars.reduce((sum, ch) => sum + charWidth(ch), 0);
  if (total <= maxChars) return text;

  const lineCount = Math.ceil(total / maxChars);
  const cap = Math.max(4, Math.ceil(total / lineCount));

  const lines: string[] = [];
  let current = "";
  let width = 0;

  for (const ch of chars) {
    const w = charWidth(ch);
    if (current && width + w > cap) {
      lines.push(current);
      current = "";
      width = 0;
      if (TAIL_PUNCT.test(ch)) {
        lines[lines.length - 1] += ch;
        continue;
      }
    }
    current += ch;
    width += w;
  }
  if (current) lines.push(current);
  return lines.join("\\N");
}

/** 一条字幕的最终文本：转义 + 按固定字号折行（字号永远不变，长了就多几行） */
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
    `Style: Subtitle,${o.fontName},${o.subtitleSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${o.subtitleOutline},0,2,${o.marginL},${o.marginR},${o.subtitleMarginV},1`,
    `Style: Title,${o.fontName},${o.titleSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${o.titleOutline},0,5,${o.marginL},${o.marginR},${o.titleMarginV},1`,
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
