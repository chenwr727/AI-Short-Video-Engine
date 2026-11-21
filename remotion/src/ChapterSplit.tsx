import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { wrapTitle } from "./text";
import type { ChapterCardProps } from "./ChapterCard";

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

/** 章节：左右分栏 */
export const ChapterSplit: React.FC<ChapterCardProps> = ({ title, index, total, label, accent = "#ff5a3c" }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const leftIn = spring({ frame, fps, config: { damping: 200, stiffness: 110 }, durationInFrames: 24 });
  const rightIn = spring({ frame: frame - 6, fps, config: { damping: 200, stiffness: 110 }, durationInFrames: 24 });

  const number = String(index).padStart(2, "0");
  const fontSize = Math.round(width * 0.085);
  const lines = wrapTitle(title, Math.max(5, Math.floor((width * 0.52) / (fontSize * 1.02))));
  const scale = interpolate(frame, [0, durationInFrames], [1.04, 1], { extrapolateRight: "clamp" });
  const progress = total > 0 ? Math.min(1, index / total) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#080b12", fontFamily: FONT }}>
      <AbsoluteFill style={{ background: "linear-gradient(115deg, #0a0f18 0%, #101a2b 48%, #070a10 100%)" }} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 50% at 12% 42%, ${accent}33 0%, transparent 68%)`,
        }}
      />

      <AbsoluteFill style={{ flexDirection: "row", transform: `scale(${scale})` }}>
        {/* 左侧：竖排序号 + 竖线 */}
        <div
          style={{
            width: "34%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: Math.round(width * 0.03),
            opacity: leftIn,
            transform: `translateX(${(1 - leftIn) * -Math.round(width * 0.12)}px)`,
          }}
        >
          <div
            style={{
              fontSize: Math.round(width * 0.2),
              fontWeight: 900,
              lineHeight: 0.86,
              color: "transparent",
              WebkitTextStroke: `2px ${accent}`,
              letterSpacing: "-0.05em",
            }}
          >
            {number}
          </div>
          <div style={{ width: 2, height: Math.round(height * 0.16), backgroundColor: `${accent}66` }} />
        </div>

        {/* 右侧：角标 + 标题 + 进度 */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingRight: Math.round(width * 0.08),
            gap: Math.round(width * 0.032),
            opacity: rightIn,
            transform: `translateX(${(1 - rightIn) * Math.round(width * 0.1)}px)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: Math.round(width * 0.014) }}>
            <div style={{ width: Math.round(width * 0.022), height: 3, backgroundColor: accent }} />
            <span
              style={{
                color: "rgba(255,255,255,0.58)",
                fontSize: Math.round(width * 0.025),
                letterSpacing: "0.24em",
              }}
            >
              {label || "PART"} {index} / {total}
            </span>
          </div>

          {lines.map((line, i) => (
            <div
              key={`${line}-${i}`}
              style={{
                color: "#ffffff",
                fontSize,
                fontWeight: 800,
                lineHeight: 1.18,
                letterSpacing: "-0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {line}
            </div>
          ))}

          <div style={{ display: "flex", gap: Math.round(width * 0.008), marginTop: Math.round(width * 0.022) }}>
            {Array.from({ length: Math.min(total, 8) }).map((_, dot) => (
              <div
                key={dot}
                style={{
                  width: dot + 1 === index ? Math.round(width * 0.05) : Math.round(width * 0.016),
                  height: 3,
                  borderRadius: 99,
                  backgroundColor: dot + 1 <= index ? accent : "rgba(255,255,255,0.2)",
                }}
              />
            ))}
          </div>

          <div
            style={{ marginTop: Math.round(width * 0.01), color: `${accent}cc`, fontSize: Math.round(width * 0.022) }}
          >
            {(progress * 100).toFixed(0)}%
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
