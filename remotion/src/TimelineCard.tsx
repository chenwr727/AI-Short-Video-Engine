import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CardBackdrop, OverlayPlate, riseIn, snapPx, springIn } from "./card-kit";

/**
 * 事件时间线卡。
 *
 * 新闻评论常见的「先是…然后…最后…」结构，用一句话说不清，用时间线一眼就懂。
 * 节点按顺序点亮，和配音节奏一致。
 */
export type TimelineItem = {
  time: string;
  text: string;
};

export type TimelineCardProps = {
  /** 顶部标题 */
  title?: string;
  /** 2-4 个节点，多了排不下也没必要 */
  timeline?: TimelineItem[];
  label?: string;
  accent?: string;
  /** 底图（素材帧的 data URI）；传了就走「叠加」形态 */
  bgImage?: string;
  /** 只输出透明的信息层，不含背景，给 ffmpeg overlay 用 */
  transparent?: boolean;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

const MAX_ITEMS = 4;

export const TimelineCard: React.FC<TimelineCardProps> = ({
  title = "",
  timeline = [],
  label = "时间线",
  accent = "#ff5a3c",
  bgImage,
  transparent = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const overlay = Boolean(bgImage) || transparent;
  const pad = Math.round(width * (overlay ? 0.075 : 0.1));

  const list = timeline.slice(0, MAX_ITEMS);
  const titleIn = springIn(frame, fps, 0);
  const plateIn = springIn(frame, fps, 0, "float");

  // 节点均匀铺开，总时长扣掉入场，保证最后一个节点在片子结束前亮完
  const step = Math.max(6, Math.floor((durationInFrames - 30) / Math.max(1, list.length)));

  const timeSize = Math.round(width * (overlay ? 0.03 : 0.034));
  const textSize = Math.round(width * (overlay ? 0.038 : 0.044));
  const dotSize = Math.round(width * 0.018);
  const railX = Math.round(width * 0.006);
  const contentPadLeft = Math.round(width * 0.075);
  const gapY = Math.round(width * (overlay ? 0.05 : 0.075));

  const body = (
    <>
      {title ? (
        <div
          style={{
            color: "#f5f7ff",
            fontSize: Math.round(width * (overlay ? 0.044 : 0.05)),
            fontWeight: 700,
            marginBottom: Math.round(width * (overlay ? 0.045 : 0.075)),
            ...riseIn(titleIn, 16),
          }}
        >
          {title}
        </div>
      ) : null}

      <div style={{ position: "relative", paddingLeft: contentPadLeft }}>
        {/* 纵向导轨：暗轨打底，节点亮起时圆点覆盖其上 */}
        <div
          style={{
            position: "absolute",
            left: railX - Math.max(1, width * 0.0017),
            top: Math.round(textSize * 0.2),
            bottom: Math.round(textSize * 0.2),
            width: Math.max(2, Math.round(width * 0.0035)),
            backgroundColor: "rgba(255,255,255,0.1)",
            borderRadius: 99,
          }}
        />

        {list.map((item, i) => {
          const appear = springIn(frame, fps, 10 + i * step);
          const active = appear > 0.02;
          // 圆点额外做一次「点亮」放大，强化事件发生的瞬间
          const dotScale = 0.7 + appear * 0.3;

          return (
            <div
              key={`${item.time}-${i}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: Math.round(width * 0.045),
                marginBottom: i === list.length - 1 ? 0 : gapY,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: railX - contentPadLeft - dotSize / 2,
                  top: Math.round((timeSize * 1.2) / 2 - dotSize / 2),
                  width: dotSize,
                  height: dotSize,
                  borderRadius: "50%",
                  backgroundColor: active ? accent : "rgba(255,255,255,0.18)",
                  boxShadow: active ? `0 0 ${Math.round(dotSize * 1.1)}px ${accent}aa` : "none",
                  transform: `scale(${dotScale.toFixed(4)})`,
                }}
              />

              <div style={{ flexShrink: 0, minWidth: Math.round(width * 0.15) }}>
                <div
                  style={{
                    color: active ? accent : "rgba(255,255,255,0.3)",
                    fontSize: timeSize,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                  }}
                >
                  {item.time}
                </div>
              </div>

              <div
                style={{
                  color: active ? "#f5f7ff" : "rgba(245,247,255,0.28)",
                  fontSize: textSize,
                  fontWeight: 500,
                  lineHeight: 1.42,
                  opacity: 0.35 + appear * 0.65,
                  transform: `translateX(${snapPx((1 - appear) * 12)}px)`,
                }}
              >
                {item.text}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <AbsoluteFill style={{ fontFamily: FONT, backgroundColor: transparent ? "transparent" : undefined }}>
      {overlay ? (
        <>
          {/* transparent 优先于 bgImage：透明层不能自带底图，否则会盖掉素材 */}
          {bgImage && !transparent ? (
            <AbsoluteFill
              style={{
                backgroundImage: `url(${bgImage})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          ) : null}
          <OverlayPlate accent={accent} progress={plateIn} width={width} height={height}>
            {body}
          </OverlayPlate>
        </>
      ) : (
        <>
          <CardBackdrop accent={accent} origin="20% 70%" />
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              padding: `${Math.round(height * 0.2)}px ${pad}px ${Math.round(height * 0.26)}px`,
            }}
          >
            {body}
          </AbsoluteFill>
        </>
      )}

      <div
        style={{
          position: "absolute",
          left: pad,
          bottom: Math.round(height * (overlay ? 0.06 : 0.12)),
          color: "rgba(255,255,255,0.45)",
          fontSize: Math.round(width * 0.026),
          letterSpacing: "0.24em",
          opacity: interpolate(titleIn, [0, 1], [0, 1]),
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};
