import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * 信息层共用的视觉与动画原语。
 *
 * 弹簧用低阻尼（damping: 8）拿到明显回弹，再把位移吸附到整像素。
 * 早先写的是 damping: 200 —— 那是把「防抖」和「动画」混为一谈，
 * 画面确实稳，但也只剩淡入，观感上等于没有动效。
 */

/** 把接近首尾的值吸附：避免停在 0.996 这种位置一直在做无意义的重绘 */
const settle = (v: number, eps = 5e-4): number => (v > 1 - eps ? 1 : v < eps ? 0 : v);

/** 位移吸附到整像素：文字停在 0.37px 会持续抖动 */
export const snapPx = (v: number): number => Math.round(v);

export type SpringStyle = "spring" | "float" | "linear";

/**
 * 带延迟的入场进度。
 *   spring —— 默认，回弹明显，适合绝大多数元素
 *   float  —— 更软、更慢，适合大面积面板
 *   linear —— 不回弹，适合不该抢戏的辅助元素
 */
export function springIn(frame: number, fps: number, delay = 0, style: SpringStyle = "spring"): number {
  const config =
    style === "linear"
      ? { damping: 200, stiffness: 100, mass: 1 }
      : style === "float"
        ? { damping: 15, stiffness: 60, mass: 1.2 }
        : { damping: 8, stiffness: 100, mass: 0.9 };
  return settle(spring({ frame: frame - delay, fps, config }));
}

/**
 * 元素沿 Y 轴上浮入场：位置取整，避免亚像素抖动。
 *
 * 不标注 React.CSSProperties —— 根目录与 remotion/ 各有一份 csstype，
 * 显式标注会让 web 端编译时撞上 columnRuleStyle 不兼容。
 */
export function riseIn(progress: number, distance = 40) {
  return {
    opacity: progress,
    transform: `translateY(${snapPx((1 - progress) * distance)}px)`,
  };
}

/** 从稍小尺寸弹出：用于头像、徽章这类有「砸下来」感的元素。同样不标注类型 */
export function popIn(progress: number, from = 0.7) {
  return {
    opacity: progress,
    transform: `scale(${(from + progress * (1 - from)).toFixed(4)})`,
  };
}

export type CardBackdropProps = {
  accent: string;
  /** 光晕中心位置，默认左上 */
  origin?: string;
};

/** 纯色卡片的基底：素材缺席时的完整背景 */
export const CardBackdrop: React.FC<CardBackdropProps> = ({ accent, origin = "24% 22%" }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  const scale = interpolate(frame, [0, durationInFrames], [1, 1.02], { extrapolateRight: "clamp" });
  const glow = interpolate(frame, [0, durationInFrames], [0.3, 0.8], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#080b12", transform: `scale(${scale})` }}>
      <AbsoluteFill style={{ background: "linear-gradient(150deg, #0a0f1a 0%, #141c2e 50%, #080b12 100%)" }} />
      <AbsoluteFill
        style={{ background: `radial-gradient(circle at ${origin}, ${accent}30 0%, transparent 54%)`, opacity: glow }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.05,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.55) 1px, transparent 1px)",
          backgroundSize: `100% ${Math.round(height * 0.06)}px`,
        }}
      />
      <AbsoluteFill
        style={{ boxShadow: `inset 0 0 ${Math.round(width * 0.3)}px ${Math.round(width * 0.12)}px rgba(0,0,0,0.82)` }}
      />
    </AbsoluteFill>
  );
};

/**
 * 叠在实拍素材上的信息层基座。
 *
 * 与 CardBackdrop 的区别：不铺满画面，而是在下半部放一块半透明玻璃板，
 * 让素材继续可见（它自带运镜，画面就是活的），信息集中在板上。
 *
 * 位置约束：字幕底边在 y≈1281 / 1920（compose 的 SUBTITLE_POSITION_RATIO=0.667
 * 是「字幕基线距顶部 2/3」，不是 1/3）。板子底边必须留在 1160 以上，否则字幕压上来。
 */
export type OverlayPlateProps = {
  accent: string;
  /** 入场进度：整块板随它浮起 */
  progress: number;
  width: number;
  height: number;
  children: React.ReactNode;
};

export const OverlayPlate: React.FC<OverlayPlateProps> = ({ accent, progress, width, height, children }) => {
  const pad = Math.round(width * 0.075);

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "stretch" }}>
      {/*
        自上而下压暗，但只压到板子上方就停。
        之前压到 62% 已经很暗，素材上半部直接黑掉，等于白搭一张底图。
      */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0) 34%, rgba(4,7,12,0.35) 52%, rgba(4,7,12,0.7) 100%)",
        }}
      />
      <div
        style={{
          position: "relative",
          /*
           * 板子底边必须留着字幕带，还要留出呼吸。
           * 字幕两行时顶边约在 y=1105，底边 y = height - marginBottom：
           * marginBottom=0.42 → 底边 1114，实测与字幕只隔 25px，挤在一起。
           * 改成 0.45 → 底边 y≈1056，间距拉到约 50px。
           */
          margin: `0 ${Math.round(pad * 0.5)}px ${Math.round(height * 0.45)}px`,
          padding: `${Math.round(width * 0.04)}px ${pad}px`,
          borderRadius: Math.round(width * 0.04),
          background: "linear-gradient(160deg, rgba(12,18,30,0.88) 0%, rgba(8,11,18,0.94) 100%)",
          border: `${Math.max(1, Math.round(width * 0.0022))}px solid ${accent}55`,
          boxShadow: `0 ${Math.round(width * 0.02)}px ${Math.round(width * 0.06)}px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)`,
          opacity: progress,
          transform: `translateY(${snapPx((1 - progress) * 56)}px)`,
          willChange: "transform, opacity",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** 版式卡共用的一条要点：文案 + 它该出现的秒数（相对本段） */
export type Beat = { text: string; at: number };

export type BeatListProps = {
  beats: Beat[];
  accent: string;
  /** 用来推算圆点与行距，传画幅宽 */
  width: number;
  size: number;
};

/**
 * 跟着旁白逐条出现的要点。
 *
 * 行位一直占着（未到时间的行只是 opacity 0），所以要点出现时板子不会长高 ——
 * 逐条出现最容易翻车的正是这里：来一条、整块信息重排一次，等于每句话抖一下。
 */
export const BeatList: React.FC<BeatListProps> = ({ beats, accent, width, size }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dot = Math.max(6, Math.round(size * 0.32));

  return (
    <div style={{ marginTop: Math.round(width * 0.028) }}>
      {beats.map((beat, i) => {
        const progress = springIn(frame, fps, Math.max(0, Math.round(beat.at * fps)));
        return (
          <div
            key={`${beat.text}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: Math.round(size * 0.5),
              marginTop: i === 0 ? 0 : Math.round(size * 0.44),
              opacity: progress,
              transform: `translateY(${snapPx((1 - progress) * 18)}px)`,
            }}
          >
            <div style={{ width: dot, height: dot, borderRadius: 99, backgroundColor: accent }} />
            <div
              style={{
                color: "rgba(245,247,255,0.94)",
                fontSize: size,
                fontWeight: 500,
                lineHeight: 1.35,
                whiteSpace: "nowrap",
              }}
            >
              {beat.text}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** 主色分隔线，信息卡统一用它做「这一块讲完了」的收尾 */ export const AccentRule: React.FC<{
  accent: string;
  width: number;
  grow: number;
  height?: number;
}> = ({ accent, width, grow, height = 4 }) => (
  <div
    style={{
      height: Math.max(3, height),
      width: width * grow,
      backgroundColor: accent,
      borderRadius: 99,
    }}
  />
);
