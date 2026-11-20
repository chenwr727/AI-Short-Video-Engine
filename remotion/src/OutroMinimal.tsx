import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { wrapTitle } from "./text";
import type { OutroCardProps } from "./OutroCard";

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

/** 片尾：极简居中 */
export const OutroMinimal: React.FC<OutroCardProps> = ({
  title,
  handle,
  subtitle,
  label = "下期见",
  accent = "#ff5a3c",
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const fontSize = Math.round(width * 0.094);
  const lines = wrapTitle(title, Math.max(5, Math.floor((width * 0.8) / (fontSize * 1.02))));
  const titleSize = fontSize * (lines.length >= 3 ? 0.76 : 1);

  const ring = spring({ frame, fps, config: { damping: 26, stiffness: 60 }, durationInFrames: 34 });
  const titleIn = spring({ frame: frame - 8, fps, config: { damping: 200 }, durationInFrames: 22 });
  const handleIn = spring({ frame: frame - 16, fps, config: { damping: 200 }, durationInFrames: 20 });

  const breathe = interpolate(frame, [0, durationInFrames], [0.94, 1.06], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#06080d", fontFamily: FONT }}>
      <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 46%, #0f1826 0%, #06080d 68%)" }} />

      {/* 一圈随呼吸放大的描边，把视线收到中间 */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            position: "absolute",
            width: Math.round(width * 0.66) * ring * breathe,
            height: Math.round(width * 0.66) * ring * breathe,
            borderRadius: "50%",
            border: `1px solid ${accent}55`,
          }}
        />
        <div
          style={{
            position: "absolute",
            width: Math.round(width * 0.5) * ring,
            height: Math.round(width * 0.5) * ring,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${accent}22 0%, transparent 70%)`,
          }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: `0 ${Math.round(width * 0.1)}px`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: accent,
            fontSize: Math.round(width * 0.026),
            letterSpacing: "0.26em",
            opacity: titleIn,
            marginBottom: Math.round(width * 0.04),
          }}
        >
          {label}
        </div>

        {lines.map((line, index) => (
          <div
            key={`${line}-${index}`}
            style={{
              color: "#ffffff",
              fontSize: titleSize,
              fontWeight: 800,
              lineHeight: 1.22,
              letterSpacing: "-0.02em",
              whiteSpace: "nowrap",
              opacity: titleIn,
              transform: `translateY(${(1 - titleIn) * titleSize * 0.3}px)`,
            }}
          >
            {line}
          </div>
        ))}

        <div
          style={{
            width: Math.round(width * 0.07),
            height: 2,
            backgroundColor: `${accent}aa`,
            margin: `${Math.round(width * 0.05)}px 0`,
            opacity: handleIn,
          }}
        />

        {handle ? (
          <div
            style={{
              color: "rgba(255,255,255,0.78)",
              fontSize: Math.round(width * 0.034),
              letterSpacing: "0.04em",
              opacity: handleIn,
              transform: `translateY(${(1 - handleIn) * 10}px)`,
            }}
          >
            {handle}
          </div>
        ) : null}

        {subtitle ? (
          <div
            style={{
              marginTop: Math.round(width * 0.028),
              color: "rgba(255,255,255,0.5)",
              fontSize: Math.round(width * 0.028),
              opacity: handleIn,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          left: Math.round(width * 0.12),
          right: Math.round(width * 0.12),
          bottom: Math.round(height * 0.08),
          height: 1,
          backgroundColor: "rgba(255,255,255,0.1)",
        }}
      />
    </AbsoluteFill>
  );
};
