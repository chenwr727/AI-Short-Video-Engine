import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { wrapTitle } from "./text";

export type TitleCardProps = {
  title: string;
  subtitle?: string;
  label?: string;
  accent?: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

export const TitleCard: React.FC<TitleCardProps> = ({ title, subtitle, label, accent = "#ff5a3c" }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const fontSize = Math.round(width * 0.092);
  // 两侧各留 9% 边距，中文字宽约等于字号，按可用宽度算每行字数
  const available = width * 0.82;
  const lines = wrapTitle(title, Math.max(6, Math.floor(available / (fontSize * 1.02))));

  const titleSize = fontSize * (lines.length >= 4 ? 0.72 : lines.length === 3 ? 0.82 : 1);
  const lineHeight = 1.24;
  const titleHeight = lines.length * titleSize * lineHeight;

  const fadeIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  const accentDelay = 6 + lines.length * 4;
  const accentGrow = spring({ frame: frame - accentDelay, fps, config: { damping: 200 }, durationInFrames: 20 });
  const subtitleIn = spring({ frame: frame - accentDelay - 6, fps, config: { damping: 200 }, durationInFrames: 18 });

  // 整段轻微推近，避免画面"死"在最后一帧
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.025], { extrapolateRight: "clamp" });
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#080b12", fontFamily: FONT }}>
      <AbsoluteFill style={{ background: "linear-gradient(165deg, #080b12 0%, #101828 55%, #080b12 100%)" }} />
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 36%, ${accent}26 0%, transparent 58%)` }} />
      <AbsoluteFill
        style={{
          opacity: 0.05,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: `100% ${Math.round(height * 0.062)}px`,
        }}
      />
      <AbsoluteFill
        style={{ boxShadow: `inset 0 0 ${Math.round(width * 0.28)}px ${Math.round(width * 0.1)}px rgba(0,0,0,0.8)` }}
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
          {label ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: Math.round(width * 0.018),
                opacity: fadeIn,
                marginBottom: Math.round(width * 0.038),
              }}
            >
              <div
                style={{ width: Math.round(width * 0.012), height: Math.round(width * 0.012), backgroundColor: accent }}
              />
              <span
                style={{
                  color: "rgba(255,255,255,0.62)",
                  fontSize: Math.round(width * 0.026),
                  letterSpacing: "0.22em",
                  fontWeight: 500,
                }}
              >
                {label}
              </span>
            </div>
          ) : null}

          <div style={{ height: titleHeight }}>
            {lines.map((line, index) => {
              const enter = spring({
                frame: frame - 3 - index * 4,
                fps,
                config: { damping: 200, stiffness: 130 },
                durationInFrames: 22,
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
                    transform: `translateY(${(1 - enter) * titleSize * 0.42}px)`,
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
              width: Math.round(width * 0.14) * accentGrow,
              backgroundColor: accent,
              marginTop: Math.round(width * 0.038),
              borderRadius: 99,
            }}
          />

          {subtitle ? (
            <div
              style={{
                marginTop: Math.round(width * 0.034),
                color: "rgba(255,255,255,0.72)",
                fontSize: Math.round(width * 0.036),
                fontWeight: 400,
                lineHeight: 1.55,
                opacity: subtitleIn,
                transform: `translateY(${(1 - subtitleIn) * 16}px)`,
                maxWidth: "92%",
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>

      {/* 底部进度线，暗示"这只是开场" */}
      <div
        style={{
          position: "absolute",
          left: Math.round(width * 0.09),
          right: Math.round(width * 0.09),
          bottom: Math.round(height * 0.1),
          height: 2,
          backgroundColor: "rgba(255,255,255,0.12)",
        }}
      >
        <div style={{ width: `${progress * 100}%`, height: "100%", backgroundColor: accent, opacity: 0.9 }} />
      </div>
    </AbsoluteFill>
  );
};
