import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { wrapTitle } from "./text";

export type ChapterCardProps = {
  title: string;
  index: number;
  total: number;
  label?: string;
  accent?: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

/** 段落之间的过场卡：大序号 + 这一段要讲什么 */
export const ChapterCard: React.FC<ChapterCardProps> = ({
  title,
  index,
  total,
  label = "PART",
  accent = "#ff5a3c",
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const number = String(index).padStart(2, "0");
  const titleSize = Math.round(width * 0.056);
  const lines = wrapTitle(title, Math.max(6, Math.floor((width * 0.78) / (titleSize * 1.05))));

  const labelIn = spring({ frame: frame - 2, fps, config: { damping: 200 }, durationInFrames: 16 });
  const numberIn = spring({ frame: frame - 4, fps, config: { damping: 200, stiffness: 110 }, durationInFrames: 24 });
  const lineIn = spring({ frame: frame - 10, fps, config: { damping: 200 }, durationInFrames: 18 });
  const titleIn = spring({ frame: frame - 12, fps, config: { damping: 200 }, durationInFrames: 20 });

  const scale = interpolate(frame, [0, durationInFrames], [1, 1.03], { extrapolateRight: "clamp" });
  const ghost = interpolate(frame, [0, durationInFrames], [0.05, 0.09], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#080b12", fontFamily: FONT }}>
      <AbsoluteFill style={{ background: "linear-gradient(135deg, #0a0f1a 0%, #131b2c 55%, #080b12 100%)" }} />
      <AbsoluteFill
        style={{ background: `radial-gradient(circle at 70% 30%, ${accent}26 0%, transparent 55%)` }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.05,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: `100% ${Math.round(height * 0.06)}px`,
        }}
      />
      <AbsoluteFill style={{ boxShadow: `inset 0 0 ${Math.round(width * 0.3)}px ${Math.round(width * 0.12)}px rgba(0,0,0,0.82)` }} />

      {/* 背景水印数字 */}
      <div
        style={{
          position: "absolute",
          right: `-${Math.round(width * 0.04)}px`,
          top: Math.round(height * 0.12),
          fontFamily: FONT,
          fontSize: Math.round(width * 0.62),
          fontWeight: 900,
          lineHeight: 0.85,
          color: "#ffffff",
          opacity: ghost,
          letterSpacing: "-0.06em",
        }}
      >
        {number}
      </div>

      <AbsoluteFill
        style={{
          alignItems: "flex-start",
          justifyContent: "center",
          padding: `0 ${Math.round(width * 0.1)}px`,
          transform: `scale(${scale})`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: Math.round(width * 0.016),
              opacity: labelIn,
              marginBottom: Math.round(width * 0.02),
            }}
          >
            <div
              style={{ width: Math.round(width * 0.012), height: Math.round(width * 0.012), backgroundColor: accent }}
            />
            <span
              style={{
                color: "rgba(255,255,255,0.58)",
                fontSize: Math.round(width * 0.026),
                letterSpacing: "0.26em",
                fontWeight: 500,
              }}
            >
              {label}
            </span>
            <span
              style={{
                color: "rgba(255,255,255,0.32)",
                fontSize: Math.round(width * 0.024),
                letterSpacing: "0.1em",
              }}
            >
              {index} / {total}
            </span>
          </div>

          <div
            style={{
              color: accent,
              fontSize: Math.round(width * 0.24),
              fontWeight: 900,
              lineHeight: 0.9,
              letterSpacing: "-0.05em",
              opacity: numberIn,
              transform: `translateY(${(1 - numberIn) * width * 0.05}px)`,
            }}
          >
            {number}
          </div>

          <div
            style={{
              height: Math.max(3, Math.round(width * 0.006)),
              width: Math.round(width * 0.16) * lineIn,
              backgroundColor: accent,
              marginTop: Math.round(width * 0.03),
              marginBottom: Math.round(width * 0.032),
              borderRadius: 99,
            }}
          />

          <div style={{ opacity: titleIn, transform: `translateY(${(1 - titleIn) * 18}px)` }}>
            {lines.map((line, i) => (
              <div
                key={`${line}-${i}`}
                style={{
                  color: "#ffffff",
                  fontSize: titleSize,
                  fontWeight: 700,
                  lineHeight: 1.4,
                  whiteSpace: "nowrap",
                  letterSpacing: "0.01em",
                  opacity: 0.92,
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      </AbsoluteFill>

      {/* 底部段落进度点 */}
      <div
        style={{
          position: "absolute",
          left: Math.round(width * 0.1),
          right: Math.round(width * 0.1),
          bottom: Math.round(height * 0.1),
          display: "flex",
          gap: Math.round(width * 0.014),
          opacity: labelIn,
        }}
      >
        {Array.from({ length: Math.min(total, 12) }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 3,
              flex: 1,
              borderRadius: 99,
              backgroundColor: i === index - 1 ? accent : "rgba(255,255,255,0.16)",
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
