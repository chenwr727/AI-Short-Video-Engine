import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";

/**
 * 一条已折好的字幕。
 * lines 由后端用 libass 的折行规则算好后传进来，这里不再重排，
 * 否则两套折行算法永远对不齐。
 */
export type SubtitleLayerCue = {
  lines: string[];
  start: number;
  end: number;
  style: "Subtitle" | "Title";
};

export type SubtitleLayerProps = {
  cues: SubtitleLayerCue[];
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** 与 ASS 同名参数一一对应，单位都是脚本像素 */
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
  shadowColour: string;
};

/**
 * 背景必须透明，AbsoluteFill 默认是黑底，不改会盖住整条视频。
 * 样式一律写成内联对象字面量：显式标注 React.CSSProperties 会在 web 端编译时
 * 撞上根目录与 remotion/ 两套 csstype 版本（columnRuleStyle 不兼容）。
 */
const CLEAR = { backgroundColor: "transparent" } as const;

/**
 * libass 与 CSS 的 Fontsize 语义不同：ASS 的 72 号字，汉字墨迹只有 54px 宽（0.750 倍），
 * CSS 的 72px 则接近全角 72px。实测该比例在 40~128 号区间恒定，故直接线性换算。
 * 不换算的话整片字幕会宽出约 1.33 倍，直接溢出画面。
 */
const ASS_FONT_SCALE = 0.75;

/**
 * 行距基于 ASS 原始字号：libass 的基线步进约等于字号本身（实测两行块高 126px / 72 ≈ 1.75，
 * 减去单行墨迹后每行步进 ≈ 0.875 em）。这里把步进换算成相对 CSS 字号的倍数。
 */
const ASS_LINE_STEP_EM = 1.17;

type CueStyle = {
  /** 已换算成 CSS 像素的字号 */
  fontSize: number;
  /** 行高，相对 fontSize 的倍数 */
  lineHeight: number;
  outline: number;
  shadow: number;
};

function styleOf(cue: SubtitleLayerCue, p: SubtitleLayerProps): CueStyle {
  const size = cue.style === "Title" ? p.titleSize : p.subtitleSize;
  const scaled = size * ASS_FONT_SCALE;
  const common = { fontSize: scaled, lineHeight: (size * ASS_LINE_STEP_EM) / scaled };
  return cue.style === "Title"
    ? { ...common, outline: p.titleOutline, shadow: p.titleShadow }
    : { ...common, outline: p.subtitleOutline, shadow: p.subtitleShadow };
}

/**
 * 用 8 向 text-shadow 还原 ASS 的 Outline/Shadow。
 * 不能用 -webkit-text-stroke：它是居中描边，3px 会把 72px 字的细笔画从两侧各吃掉 3px，
 * 实测白色填充只剩 RGB 78。libass 的 Outline 是向字形外侧扩张的，所以这里用外扩阴影。
 */
function textStyle(s: CueStyle, fontName: string) {
  const stroke = Math.max(0, s.outline);
  const shadow = Math.max(0, s.shadow);
  const layers: string[] = [];

  if (stroke > 0) {
    // 主方向 + 对角，凑出近似圆形的外扩
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const;
    const diag = stroke * 0.707;
    for (const [dx, dy] of dirs) {
      const r = dx !== 0 && dy !== 0 ? diag : stroke;
      layers.push(`${(dx * r).toFixed(2)}px ${(dy * r).toFixed(2)}px 0 #000000`);
    }
  }

  // ASS 的 Shadow 是整体右下的实心投影
  if (shadow > 0) layers.push(`${shadow}px ${shadow}px 0 rgba(0, 0, 0, 0.5)`);

  return {
    fontFamily: `"${fontName}", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif`,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    fontWeight: 400,
    letterSpacing: "0.5px",
    color: "#ffffff",
    whiteSpace: "pre",
    textShadow: layers.length > 0 ? layers.join(", ") : "none",
  };
}

const Cue: React.FC<{ cue: SubtitleLayerCue; props: SubtitleLayerProps }> = ({ cue, props: p }) => {
  const s = styleOf(cue, p);
  const title = cue.style === "Title";

  // Alignment 2 = 底边居中，MarginV 是文字块底边到画面底边的距离
  // Alignment 5 = 顶边居中，MarginV 换成到顶边的距离
  const position = title ? { top: p.titleMarginV, bottom: undefined } : { bottom: p.subtitleMarginV, top: undefined };

  // 横向只用 MarginL/R 限制换行区宽度，文字块本身按整幅画面居中；
  // 若把 left/right 直接设成边距，文字会整体偏移，实测偏了 109px
  const available = p.width - p.marginL - p.marginR;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        width: p.width,
        display: "flex",
        justifyContent: "center",
        alignItems: title ? "flex-start" : "flex-end",
        ...position,
      }}
    >
      <div style={{ width: available, textAlign: "center", ...textStyle(s, p.fontName) }}>
        {cue.lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
};

/**
 * 整片字幕叠一层透明视频，合流时用 overlay 贴到成片上。
 * 每条 cue 独立成 Sequence，时间轴与 ASS 的 Dialogue 行等价。
 */
export const SubtitleLayer: React.FC<SubtitleLayerProps> = (p) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={CLEAR}>
      {p.cues.map((cue, index) => {
        const from = Math.max(0, Math.round(cue.start * fps));
        const to = Math.max(from + 1, Math.round(cue.end * fps));
        if (from >= p.durationInFrames) return null;
        return (
          <Sequence key={index} from={from} durationInFrames={Math.min(to - from, p.durationInFrames - from)}>
            <Cue cue={cue} props={p} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
