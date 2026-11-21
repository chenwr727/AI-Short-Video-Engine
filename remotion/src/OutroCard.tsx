import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { wrapTitle } from "./text";

export type OutroCardProps = {
  title: string;
  handle?: string;
  subtitle?: string;
  label?: string;
  accent?: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

export const OutroCard: React.FC<OutroCardProps> = ({
  title,
  handle,
  subtitle,
  label = "下期见",
  accent = "#ff5a3c",
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const fontSize = Math.round(width * 0.1);
  const available = width * 0.82;
  const lines = wrapTitle(title, Math.max(5, Math.floor(available / (fontSize * 1.02))));
  const titleSize = fontSize * (lines.length >= 3 ? 0.78 : 1);
  const lineHeight = 1.22;
  const titleHeight = lines.length * titleSize * lineHeight;

  const accentDelay = 4 + lines.length * 4;
  const accentGrow = spring({ frame: frame - accentDelay, fps, config: { damping: 200 }, durationInFrames: 18 });
  const handleIn = spring({ frame: frame - accentDelay - 5, fps, config: { damping: 200 }, durationInFrames: 16 });
  const subtitleIn = spring({ frame: frame - accentDelay - 9, fps, config: { damping: 200 }, durationInFrames: 16 });

  // 缓慢放大，结尾停住而不是突然切黑
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.03], { extrapolateRight: "clamp" });
  const halo = interpolate(frame, [0, durationInFrames], [0.5, 1], { extrapolateRight: "clamp" });
  const arrow = interpolate(frame, [0, durationInFrames], [0, 24], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#080b12", fontFamily: FONT }}>
      <AbsoluteFill style={{ background: "linear-gradient(20deg, #101828 0%, #080b12 55%, #0b111d 100%)" }} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 62% 68%, ${accent}30 0%, transparent 55%)`,
          opacity: halo,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.045,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.55) 1px, transparent 1px)",
          backgroundSize: `100% ${Math.round(height * 0.058)}px`,
        }}
      />
      <AbsoluteFill
        style={{ boxShadow: `inset 0 0 ${Math.round(width * 0.3)}px ${Math.round(width * 0.12)}px rgba(0,0,0,0.82)` }}
      />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: `0 ${Math.round(width * 0.09)}px`,
          transform: `scale(${scale})`,
        }}
      >
        <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: Math.round(width * 0.016),
              marginBottom: Math.round(width * 0.042),
              opacity: spring({ frame: frame - 2, fps, config: { damping: 200 }, durationInFrames: 14 }),
            }}
          >
            <div
              style={{
                width: Math.round(width * 0.014),
                height: Math.round(width * 0.014),
                borderRadius: 99,
                backgroundColor: accent,
              }}
            />
            <span
              style={{
                color: "rgba(255,255,255,0.6)",
                fontSize: Math.round(width * 0.026),
                letterSpacing: "0.2em",
                fontWeight: 500,
              }}
            >
              {label}
            </span>
          </div>

          <div style={{ height: titleHeight }}>
            {lines.map((line, index) => {
              const enter = spring({
                frame: frame - 3 - index * 4,
                fps,
                config: { damping: 200, stiffness: 120 },
                durationInFrames: 24,
              });

              return (
                <div
                  key={`${line}-${index}`}
                  style={{
                    color: "#ffffff",
                    fontSize: titleSize,
                    fontWeight: 800,
                    lineHeight,
                    letterSpacing: "-0.02em",
                    whiteSpace: "nowrap",
                    opacity: enter,
                    transform: `translateY(${(1 - enter) * titleSize * 0.45}px)`,
                  }}
                >
                  {line}
                </div>
              );
            })}
          </div>

          <div
            style={{
              height: Math.max(3, Math.round(width * 0.006)),
              width: Math.round(width * 0.16) * accentGrow,
              backgroundColor: accent,
              marginTop: Math.round(width * 0.04),
              borderRadius: 99,
            }}
          />

          {handle ? (
            <div
              style={{
                marginTop: Math.round(width * 0.036),
                display: "flex",
                alignItems: "center",
                gap: Math.round(width * 0.016),
                opacity: handleIn,
                transform: `translateY(${(1 - handleIn) * 18}px)`,
              }}
            >
              <div
                style={{
                  border: `2px solid ${accent}`,
                  borderRadius: 999,
                  padding: `${Math.round(width * 0.014)}px ${Math.round(width * 0.032)}px`,
                  color: "#ffffff",
                  fontSize: Math.round(width * 0.034),
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                {handle}
              </div>
              <div
                style={{
                  width: Math.round(width * 0.05),
                  height: Math.round(width * 0.05),
                  borderRadius: 999,
                  backgroundColor: accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: `translateX(${arrow * 0.4}px)`,
                }}
              >
                <span style={{ color: "#080b12", fontSize: Math.round(width * 0.03), fontWeight: 800 }}>+</span>
              </div>
            </div>
          ) : null}

          {subtitle ? (
            <div
              style={{
                marginTop: Math.round(width * 0.032),
                color: "rgba(255,255,255,0.66)",
                fontSize: Math.round(width * 0.034),
                lineHeight: 1.55,
                opacity: subtitleIn,
                transform: `translateY(${(1 - subtitleIn) * 14}px)`,
                maxWidth: "92%",
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>

      {/* 右下角的呼吸光点，避免画面在下三分之一完全空白 */}
      <div
        style={{
          position: "absolute",
          right: Math.round(width * 0.1),
          bottom: Math.round(height * 0.11),
          width: Math.round(width * 0.02),
          height: Math.round(width * 0.02),
          borderRadius: 999,
          backgroundColor: accent,
          opacity: 0.55,
          transform: `scale(${1 + Math.sin(frame / 8) * 0.25})`,
        }}
      />
    </AbsoluteFill>
  );
};
