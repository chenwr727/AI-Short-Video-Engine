import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { wrapTitle } from "./text";
import type { TitleCardProps } from "./TitleCard";

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

/** 片头：居中大字 */
export const TitleHero: React.FC<TitleCardProps> = ({ title, subtitle, label, accent = "#ff5a3c" }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const fontSize = Math.round(width * 0.108);
  const available = width * 0.84;
  const lines = wrapTitle(title, Math.max(4, Math.floor(available / (fontSize * 1.02))));
  const titleSize = fontSize * (lines.length >= 4 ? 0.66 : lines.length === 3 ? 0.78 : 1);
  const lineHeight = 1.2;

  const labelIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 16 });
  const ringIn = spring({ frame: frame - 4, fps, config: { damping: 18, stiffness: 90 }, durationInFrames: 26 });
  const pushIn = interpolate(frame, [0, durationInFrames], [1.06, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#070a11", fontFamily: FONT }}>
      <AbsoluteFill style={{ background: "linear-gradient(200deg, #0d1421 0%, #06090f 62%, #04060a 100%)" }} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 120% 55% at 50% -10%, ${accent}55 0%, ${accent}12 42%, transparent 72%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.06,
          backgroundImage: `linear-gradient(${accent} 1px, transparent 1px)`,
          backgroundSize: `100% ${Math.round(height * 0.11)}px`,
        }}
      />
      <AbsoluteFill
        style={{ boxShadow: `inset 0 0 ${Math.round(width * 0.3)}px ${Math.round(width * 0.08)}px rgba(0,0,0,0.85)` }}
      />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: `0 ${Math.round(width * 0.08)}px`,
          textAlign: "center",
          transform: `scale(${pushIn})`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          {label ? (
            <div
              style={{
                padding: `${Math.round(width * 0.012)}px ${Math.round(width * 0.03)}px`,
                border: `1px solid ${accent}88`,
                borderRadius: 999,
                color: accent,
                fontSize: Math.round(width * 0.026),
                letterSpacing: "0.18em",
                opacity: labelIn,
                transform: `translateY(${(1 - labelIn) * 12}px)`,
                marginBottom: Math.round(width * 0.05),
              }}
            >
              {label}
            </div>
          ) : null}

          <div
            style={{
              width: Math.round(width * 0.1) * ringIn,
              height: Math.max(4, Math.round(width * 0.008)),
              borderRadius: 99,
              backgroundColor: accent,
              marginBottom: Math.round(width * 0.05),
            }}
          />

          {lines.map((line, index) => {
            const enter = spring({
              frame: frame - 2 - index * 5,
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
                  fontWeight: 900,
                  lineHeight,
                  letterSpacing: "-0.03em",
                  whiteSpace: "nowrap",
                  opacity: enter,
                  transform: `translateY(${(1 - enter) * titleSize * 0.34}px)`,
                  textShadow: `0 ${Math.round(width * 0.012)}px ${Math.round(width * 0.05)}px rgba(0,0,0,0.6)`,
                }}
              >
                {line}
              </div>
            );
          })}

          {subtitle ? (
            <div
              style={{
                marginTop: Math.round(width * 0.042),
                color: "rgba(255,255,255,0.66)",
                fontSize: Math.round(width * 0.033),
                letterSpacing: "0.06em",
                opacity: spring({ frame: frame - 12, fps, config: { damping: 200 }, durationInFrames: 20 }),
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: Math.round(height * 0.09),
          width: Math.round(width * 0.06),
          height: 2,
          marginLeft: -Math.round(width * 0.03),
          backgroundColor: "rgba(255,255,255,0.28)",
        }}
      />
    </AbsoluteFill>
  );
};
