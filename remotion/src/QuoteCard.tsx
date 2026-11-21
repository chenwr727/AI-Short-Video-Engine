import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { wrapTitle } from "./text";

export type QuoteCardProps = {
  quote: string;
  label?: string;
  accent?: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

/** 没有合适实拍素材时的兜底画面：一句核心观点 + 排版，不用错配的空镜 */
export const QuoteCard: React.FC<QuoteCardProps> = ({ quote, label = "观点", accent = "#ff5a3c" }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const fontSize = Math.round(width * 0.078);
  const available = width * 0.78;
  const lines = wrapTitle(quote, Math.max(6, Math.floor(available / (fontSize * 1.05))));
  const quoteSize = fontSize * (lines.length >= 4 ? 0.76 : lines.length === 3 ? 0.86 : 1);
  const lineHeight = 1.42;
  const quoteHeight = lines.length * quoteSize * lineHeight;

  const markIn = spring({ frame: frame - 2, fps, config: { damping: 200 }, durationInFrames: 20 });
  const labelIn = spring({ frame: frame - 8, fps, config: { damping: 200 }, durationInFrames: 16 });
  const lineGrow = spring({ frame: frame - 8 - lines.length * 4, fps, config: { damping: 200 }, durationInFrames: 18 });

  const scale = interpolate(frame, [0, durationInFrames], [1, 1.02], { extrapolateRight: "clamp" });
  const glow = interpolate(frame, [0, durationInFrames], [0.35, 0.85], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#080b12", fontFamily: FONT }}>
      <AbsoluteFill style={{ background: "linear-gradient(150deg, #0a0f1a 0%, #141c2e 50%, #080b12 100%)" }} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 28% 26%, ${accent}2e 0%, transparent 52%)`,
          opacity: glow,
        }}
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

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: `0 ${Math.round(width * 0.11)}px`,
          transform: `scale(${scale})`,
        }}
      >
        <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: Math.round(width * 0.16),
              lineHeight: 0.8,
              color: accent,
              opacity: markIn * 0.9,
              transform: `scale(${0.8 + markIn * 0.2})`,
              transformOrigin: "left bottom",
              marginBottom: Math.round(width * 0.014),
            }}
          >
            &ldquo;
          </div>

          <div style={{ height: quoteHeight }}>
            {lines.map((line, index) => {
              const enter = spring({
                frame: frame - 2 - index * 4,
                fps,
                config: { damping: 200, stiffness: 110 },
                durationInFrames: 24,
              });

              return (
                <div
                  key={`${line}-${index}`}
                  style={{
                    color: "#f5f7ff",
                    fontSize: quoteSize,
                    fontWeight: 600,
                    lineHeight,
                    letterSpacing: "0.01em",
                    whiteSpace: "nowrap",
                    opacity: enter,
                    transform: `translateY(${(1 - enter) * quoteSize * 0.35}px)`,
                  }}
                >
                  {line}
                </div>
              );
            })}
          </div>

          <div
            style={{
              height: Math.max(3, Math.round(width * 0.005)),
              width: Math.round(width * 0.12) * lineGrow,
              backgroundColor: accent,
              marginTop: Math.round(width * 0.05),
              borderRadius: 99,
            }}
          />

          <div
            style={{
              marginTop: Math.round(width * 0.03),
              color: "rgba(255,255,255,0.5)",
              fontSize: Math.round(width * 0.026),
              letterSpacing: "0.24em",
              opacity: labelIn,
            }}
          >
            {label}
          </div>
        </div>
      </AbsoluteFill>

      {/* 右侧竖排细线，给空白区域一个视觉锚点 */}
      <div
        style={{
          position: "absolute",
          right: Math.round(width * 0.1),
          top: Math.round(height * 0.3),
          width: 2,
          height: Math.round(height * 0.2),
          background: `linear-gradient(to bottom, transparent, ${accent}66, transparent)`,
          opacity: labelIn,
        }}
      />
    </AbsoluteFill>
  );
};
